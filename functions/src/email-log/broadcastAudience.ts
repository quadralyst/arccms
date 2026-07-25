import { Timestamp, FieldPath } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { BroadcastAudience, BroadcastEmailDoc, ProviderRateLimits } from '../types.js';
import { queueEmail } from '../email-core/queueEmail.js';
import { getDelayFromLimits, sleep } from './broadcastHelper.js';
import { waitlistListId } from '../email-core/contacts.js';

/**
 * Broadcasts v2 audience engine (Phase 6, §3.13).
 *
 * Recipients are resolved server-side at send time from `Contacts` — paged over
 * the list membership query rather than a frozen inline array — so consent and
 * membership are always current. Every recipient still passes through
 * `queueEmail`'s marketing gate; skips are counted for the summary.
 */

const PAGE_SIZE = 200;

export interface AudienceContact {
  id: string;
  email: string;
  name?: string;
  userId?: string;
  sources?: string[];
  /** Needed to evaluate `exclude` without extra reads (U4). */
  listIds?: string[];
  createdAt?: Timestamp;
  consent?: { marketing?: string };
}

/**
 * Every list a broadcast targets, newest shape first (U4).
 *
 * Normalises the legacy single-target shape (`kind`/`listId`/`waitlistId`) into
 * the same array as `include`, so docs written before U4 keep sending correctly.
 */
export function audienceListIds(audience: BroadcastAudience): string[] {
  const ids: string[] = [];
  if (Array.isArray(audience.include)) ids.push(...audience.include.filter(Boolean));
  // Legacy fields — a pre-U4 doc has these and no `include`.
  if (audience.kind === 'list' && audience.listId) ids.push(audience.listId);
  if (audience.kind === 'waitlist' && audience.waitlistId) ids.push(waitlistListId(audience.waitlistId));
  return [...new Set(ids)];
}

/** Lists whose members must be skipped even if an included list contains them. */
export function audienceExcludeListIds(audience: BroadcastAudience): string[] {
  return [...new Set((audience.exclude || []).filter(Boolean))];
}

/**
 * Back-compat shim: the single list a broadcast targets, or null.
 * Returns the first included list — callers that only need "which list is this
 * broadcast about" (labels, history filters) keep working.
 */
export function audienceListId(audience: BroadcastAudience): string | null {
  return audienceListIds(audience)[0] ?? null;
}

/**
 * True when the contact belongs to any excluded list.
 *
 * Evaluated from the contact's own `listIds`, so exclusion costs no extra reads
 * no matter how many lists are excluded.
 */
function isExcluded(contact: AudienceContact, excludeIds: string[]): boolean {
  if (!excludeIds.length) return false;
  const memberOf = contact.listIds || [];
  return excludeIds.some((id) => memberOf.includes(id));
}

/**
 * Send-once rule for multi-list audiences: a contact is handled by the **first**
 * included list it belongs to, and skipped by every later one.
 *
 * Deliberately stateless — derived from the contact's own `listIds` rather than a
 * set of already-sent ids. A Set would not survive the pause/resume boundary
 * (each chunk is a fresh invocation), so someone on two included lists could be
 * emailed twice. This rule gives the same answer in every chunk, and makes the
 * preview count and the send agree by construction.
 */
function claimedByEarlierList(
  contact: AudienceContact,
  listIds: string[],
  currentIndex: number,
): boolean {
  if (currentIndex <= 0) return false;
  const memberOf = contact.listIds || [];
  for (let i = 0; i < currentIndex; i++) {
    if (memberOf.includes(listIds[i])) return true;
  }
  return false;
}

/**
 * Resume cursor for a multi-list audience: `"<listIndex>|<contactId>"`.
 * A pre-U4 paused broadcast stored a bare contact id, which parses to list 0 —
 * the only list it could have had.
 */
function makeCursor(listIndex: number, contactId?: string): string | undefined {
  return contactId === undefined ? undefined : `${listIndex}|${contactId}`;
}

function parseCursor(raw: string | undefined, listCount: number): { index: number; contactId?: string } {
  if (!raw) return { index: 0 };
  const sep = raw.indexOf('|');
  if (sep === -1) return { index: 0, contactId: raw };
  const index = Number(raw.slice(0, sep));
  const contactId = raw.slice(sep + 1);
  if (!Number.isInteger(index) || index < 0 || index >= listCount) return { index: 0, contactId };
  return { index, contactId: contactId || undefined };
}

/** Fetch one page of contacts in a single list, ordered by doc id. */
async function fetchContactPage(
  listId: string,
  startAfterId: string | undefined,
  pageSize: number,
): Promise<{ contacts: AudienceContact[]; lastId?: string; done: boolean }> {
  let q = db
    .collection('Contacts')
    .where('listIds', 'array-contains', listId)
    .orderBy(FieldPath.documentId())
    .limit(pageSize) as FirebaseFirestore.Query;
  if (startAfterId) q = q.startAfter(startAfterId);

  const snap = await q.get();
  const contacts = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AudienceContact, 'id'>) }));
  return {
    contacts,
    lastId: contacts.length ? contacts[contacts.length - 1].id : undefined,
    done: snap.size < pageSize,
  };
}

/** In-memory filter (source / createdAfter). premiumType is resolved separately. */
function passesSimpleFilters(contact: AudienceContact, audience: BroadcastAudience): boolean {
  for (const f of audience.filters || []) {
    if (f.field === 'source') {
      if (!(contact.sources || []).includes(f.value)) return false;
    } else if (f.field === 'createdAfter') {
      const created = contact.createdAt?.toMillis?.() ?? 0;
      const cutoff = f.value instanceof Timestamp ? f.value.toMillis() : new Date(f.value).getTime();
      if (created < cutoff) return false;
    }
  }
  return true;
}

/** Resolve the premiumType filter (if any) by reading the linked user. */
async function passesPremiumFilter(contact: AudienceContact, audience: BroadcastAudience): Promise<boolean> {
  const f = (audience.filters || []).find((x) => x.field === 'premiumType');
  if (!f) return true;
  if (!contact.userId) return false;
  try {
    const snap = await db.collection('users').where('uid', '==', contact.userId).limit(1).get();
    if (snap.empty) return false;
    return snap.docs[0].data()['premiumType'] === f.value;
  } catch {
    return false;
  }
}

/**
 * Count eligible recipients for a preview (respecting consent). Bounded by
 * `maxScan` to keep the preview cheap on very large lists.
 */
export async function countEligible(audience: BroadcastAudience, maxScan = 5000): Promise<{ count: number; scanned: number; capped: boolean }> {
  const listIds = audienceListIds(audience);
  if (!listIds.length) return { count: 0, scanned: 0, capped: false };
  const excludeIds = audienceExcludeListIds(audience);

  let count = 0;
  let scanned = 0;

  for (let listIndex = 0; listIndex < listIds.length; listIndex++) {
    const listId = listIds[listIndex];
    let startAfter: string | undefined;
    while (scanned < maxScan) {
      const page = await fetchContactPage(listId, startAfter, PAGE_SIZE);
      for (const c of page.contacts) {
        scanned++;
        // Same send-once rule the send path uses, so preview == delivery.
        if (claimedByEarlierList(c, listIds, listIndex)) continue;
        if (isExcluded(c, excludeIds)) continue;
        // Mirror queueEmail's marketing gate exactly: only an explicitly
        // `subscribed` contact is mailable. Testing `!== 'unsubscribed'` used to
        // count `pending` members (U2) and legacy contacts carrying no consent
        // object as recipients, both of which queueEmail then skips — so the
        // preview promised reach the send could never deliver.
        if (c.consent?.marketing !== 'subscribed') continue;
        if (!passesSimpleFilters(c, audience)) continue;
        if (!(await passesPremiumFilter(c, audience))) continue;
        count++;
      }
      startAfter = page.lastId;
      if (page.done || !startAfter) break;
    }
    if (scanned >= maxScan) return { count, scanned, capped: true };
  }
  return { count, scanned, capped: false };
}

export interface AudienceChunkResult {
  lastContactId?: string;
  sentCount: number;
  skippedCount: number;
  failedCount: number;
  timedOut: boolean;
  quotaExhausted: boolean;
  done: boolean;
}

/**
 * Process one chunk of an audience broadcast: page contacts from `startAfterId`,
 * queueEmail each eligible one, honoring the time budget and quota. Returns
 * progress so the caller can pause + resume (reusing the _broadcast_continue engine).
 */
export async function processAudienceChunk(params: {
  broadcastData: BroadcastEmailDoc;
  broadcastId: string;
  providerLimits: ProviderRateLimits;
  timeBudgetMs: number;
  startAfterId?: string;
  initialSent: number;
  initialSkipped: number;
  initialFailed: number;
  quotaChecker?: () => Promise<boolean>;
}): Promise<AudienceChunkResult> {
  const { broadcastData, broadcastId, providerLimits, timeBudgetMs, quotaChecker } = params;
  const audience = broadcastData.audience!;
  const listIds = audienceListIds(audience);
  const excludeIds = audienceExcludeListIds(audience);
  const delayMs = getDelayFromLimits(providerLimits);

  let sentCount = params.initialSent;
  let skippedCount = params.initialSkipped;
  let failedCount = params.initialFailed;
  let processedInChunk = 0;
  const startTime = Date.now();

  const finish = (
    extra: { timedOut?: boolean; quotaExhausted?: boolean; done?: boolean },
    cursor?: string,
  ): AudienceChunkResult => ({
    sentCount,
    skippedCount,
    failedCount,
    timedOut: extra.timedOut ?? false,
    quotaExhausted: extra.quotaExhausted ?? false,
    done: extra.done ?? false,
    lastContactId: cursor,
  });

  if (!listIds.length) return finish({ done: true }, params.startAfterId);

  // Walk the included lists in order, resuming mid-list where we left off.
  const resume = parseCursor(params.startAfterId, listIds.length);
  let startAfter = resume.contactId;

  for (let listIndex = resume.index; listIndex < listIds.length; listIndex++) {
    const listId = listIds[listIndex];

    for (;;) {
      const page = await fetchContactPage(listId, startAfter, PAGE_SIZE);
      if (!page.contacts.length) break;

      for (const contact of page.contacts) {
        if (Date.now() - startTime > timeBudgetMs) {
          return finish({ timedOut: true }, makeCursor(listIndex, startAfter));
        }
        if (quotaChecker && processedInChunk > 0 && processedInChunk % 25 === 0) {
          const ok = await quotaChecker();
          if (!ok) {
            return finish({ quotaExhausted: true }, makeCursor(listIndex, startAfter));
          }
        }

        // Someone on several included lists is emailed once, by the first list.
        if (claimedByEarlierList(contact, listIds, listIndex) || isExcluded(contact, excludeIds)) {
          startAfter = contact.id;
          continue;
        }

        // Apply filters (cheap first, then the user lookup).
        if (!passesSimpleFilters(contact, audience) || !(await passesPremiumFilter(contact, audience))) {
          startAfter = contact.id;
          continue;
        }

        try {
          const res = await queueEmail({
            source: 'broadcast',
            category: 'marketing',
            toEmail: contact.email,
            toName: contact.name,
            senderEmail: broadcastData.senderEmail,
            senderName: broadcastData.senderName,
            subject: broadcastData.subject,
            template: broadcastData.template,
            text: broadcastData.previewText || '',
            type: 'broadcast',
            data: { broadcastId, waitlistId: broadcastData.waitlistId },
          });
          if (res.status === 'pending') sentCount++;
          else skippedCount++; // skipped / suppressed by the consent gate
        } catch (err) {
          failedCount++;
          console.error(`processAudienceChunk: queueEmail failed for ${contact.email}:`, err);
        }

        startAfter = contact.id;
        processedInChunk++;
        await sleep(delayMs);
      }

      if (page.done) break;
    }

    // Next list starts from its own beginning.
    startAfter = undefined;
  }

  return finish({ done: true }, makeCursor(listIds.length - 1, startAfter));
}

/**
 * Run one chunk of an audience broadcast and apply the resulting status
 * transition (completed / paused + continuation). Shared by processBroadcast
 * and continueBroadcast so the resume engine is identical for both.
 */
export async function runAudienceBroadcast(
  broadcastRef: FirebaseFirestore.DocumentReference,
  broadcastData: BroadcastEmailDoc,
  broadcastId: string,
  providerLimits: ProviderRateLimits,
  quotaChecker: (() => Promise<boolean>) | undefined,
  timeBudgetMs: number,
): Promise<void> {
  const result = await processAudienceChunk({
    broadcastData,
    broadcastId,
    providerLimits,
    timeBudgetMs,
    startAfterId: broadcastData.lastContactId,
    initialSent: broadcastData.sentCount || 0,
    initialSkipped: broadcastData.skippedCount || 0,
    initialFailed: broadcastData.failedCount || 0,
    quotaChecker,
  });

  const base: Record<string, unknown> = {
    sentCount: result.sentCount,
    skippedCount: result.skippedCount,
    failedCount: result.failedCount,
    lastContactId: result.lastContactId ?? null,
    chunkNumber: (broadcastData.chunkNumber || 0) + 1,
    updatedAt: Timestamp.now(),
  };

  if (result.quotaExhausted || result.timedOut) {
    await broadcastRef.update({
      ...base,
      status: 'paused',
      ...(result.quotaExhausted
        ? { errorMessage: 'Paused: daily/hourly email quota reached. Will resume when quota resets.' }
        : {}),
    });
    await db.collection('_broadcast_continue').add({ broadcastId, triggeredAt: Timestamp.now() });
    console.log(`runAudienceBroadcast: ${broadcastId} paused (${result.quotaExhausted ? 'quota' : 'time'}). sent=${result.sentCount} skipped=${result.skippedCount}`);
  } else {
    await broadcastRef.update({ ...base, status: 'completed' });
    console.log(`runAudienceBroadcast: ${broadcastId} completed. sent=${result.sentCount} skipped=${result.skippedCount} failed=${result.failedCount}`);
  }
}
