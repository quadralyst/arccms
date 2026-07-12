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
  createdAt?: Timestamp;
  consent?: { marketing?: string };
}

/** The `listIds` value a broadcast audience targets. */
export function audienceListId(audience: BroadcastAudience): string | null {
  if (audience.kind === 'list' && audience.listId) return audience.listId;
  if (audience.kind === 'waitlist' && audience.waitlistId) return waitlistListId(audience.waitlistId);
  return null;
}

/** Fetch one page of contacts in the audience's list, ordered by doc id. */
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
  const listId = audienceListId(audience);
  if (!listId) return { count: 0, scanned: 0, capped: false };

  let count = 0;
  let scanned = 0;
  let startAfter: string | undefined;

  while (scanned < maxScan) {
    const page = await fetchContactPage(listId, startAfter, PAGE_SIZE);
    for (const c of page.contacts) {
      scanned++;
      if (c.consent?.marketing === 'unsubscribed') continue;
      if (!passesSimpleFilters(c, audience)) continue;
      if (!(await passesPremiumFilter(c, audience))) continue;
      count++;
    }
    startAfter = page.lastId;
    if (page.done || !startAfter) return { count, scanned, capped: false };
  }
  return { count, scanned, capped: true };
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
  const listId = audienceListId(audience);
  const delayMs = getDelayFromLimits(providerLimits);

  let sentCount = params.initialSent;
  let skippedCount = params.initialSkipped;
  let failedCount = params.initialFailed;
  let startAfter = params.startAfterId;
  let processedInChunk = 0;
  const startTime = Date.now();

  if (!listId) return { sentCount, skippedCount, failedCount, timedOut: false, quotaExhausted: false, done: true, lastContactId: startAfter };

  for (;;) {
    const page = await fetchContactPage(listId, startAfter, PAGE_SIZE);
    if (!page.contacts.length) {
      return { sentCount, skippedCount, failedCount, timedOut: false, quotaExhausted: false, done: true, lastContactId: startAfter };
    }

    for (const contact of page.contacts) {
      if (Date.now() - startTime > timeBudgetMs) {
        return { sentCount, skippedCount, failedCount, timedOut: true, quotaExhausted: false, done: false, lastContactId: startAfter };
      }
      if (quotaChecker && processedInChunk > 0 && processedInChunk % 25 === 0) {
        const ok = await quotaChecker();
        if (!ok) {
          return { sentCount, skippedCount, failedCount, timedOut: false, quotaExhausted: true, done: false, lastContactId: startAfter };
        }
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

    if (page.done) {
      return { sentCount, skippedCount, failedCount, timedOut: false, quotaExhausted: false, done: true, lastContactId: startAfter };
    }
  }
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
