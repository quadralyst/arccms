import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { EmailSettings, EmailTemplateData } from '../types.js';
import { queueEmail } from './queueEmail.js';
import { resolveListContext } from './dripContext.js';
import type { DripCampaignDoc } from './dripEnrollment.js';

/**
 * Sending one due drip enrollment — shared by the 15-minute scheduler and the
 * day-0 fast path (U5).
 *
 * Extracted so the two callers cannot drift: the eligibility re-checks here
 * (campaign active, still on the list, still subscribed, not suppressed) are the
 * whole safety story of a drip, and duplicating them for the fast path would
 * eventually mean two different sets of rules.
 */

/** Re-check delay when a send is held (feature/master off, template inactive). */
export const HOLD_RETRY_MS = 15 * 60 * 1000;

export type EnrollmentOutcome = 'sent' | 'completed' | 'exited' | 'held';

export interface SendEnrollmentDeps {
  settings?: EmailSettings;
  campaignCache?: Map<string, DripCampaignDoc | null>;
}

/**
 * Process a single active enrollment whose step is due.
 *
 * Idempotent by the enrollment doc: sending advances `currentStep`/`nextSendAt`,
 * so a second caller arriving afterwards finds nothing due. A held step is never
 * advanced or lost — it retries once the blocking condition clears.
 */
export async function sendDueEnrollment(
  ref: FirebaseFirestore.DocumentReference,
  enr: FirebaseFirestore.DocumentData,
  deps: SendEnrollmentDeps = {},
): Promise<EnrollmentOutcome> {
  const cache = deps.campaignCache ?? new Map<string, DripCampaignDoc | null>();
  const campaign = await loadCampaign(enr['campaignId'], cache);

  // Campaign gone or archived → exit; paused → hold untouched.
  if (!campaign || campaign.status === 'archived') {
    await exitEnrollment(ref, campaign?.id, 'archived');
    return 'exited';
  }
  if (campaign.status !== 'active') return 'held';

  // Contact must still exist, still be on the list, and still be subscribed.
  const contactSnap = await db.collection('Contacts').doc(enr['contactId']).get();
  const contact = contactSnap.data();
  if (!contact) { await exitEnrollment(ref, campaign.id, 'left_list'); return 'exited'; }
  if (!((contact['listIds'] as string[]) || []).includes(campaign.listId)) {
    await exitEnrollment(ref, campaign.id, 'left_list');
    return 'exited';
  }
  if ((contact['consent'] as { marketing?: string })?.marketing === 'unsubscribed') {
    await exitEnrollment(ref, campaign.id, 'unsubscribed');
    return 'exited';
  }

  const stepIndex: number = enr['currentStep'] || 0;
  const step = campaign.steps?.[stepIndex];
  if (!step) { await completeEnrollment(ref, campaign.id); return 'completed'; }

  const template = await loadTemplate(step.templateId);
  if (!template) { await holdEnrollment(ref); return 'held'; }

  const settings = deps.settings
    ?? ((await db.collection('Settings').doc('email').get()).data() as EmailSettings | undefined);

  // Per-list merge context (U5): a form-fed list resolves the member's queue
  // position, referral link etc. so a welcome sent as a drip step reads exactly
  // like the old direct welcome did.
  const listContext = await resolveListContext(campaign.listId, contact['email'] as string);

  const result = await queueEmail({
    source: 'drip',
    category: 'marketing',
    toEmail: contact['email'],
    toName: contact['name'],
    senderEmail: template.senderEmail,
    senderName: template.senderName,
    subject: template.subject,
    template: template.template,
    text: template.previewText || '',
    type: template.type || 'drip_step',
    templateIsActive: template.isActive !== false,
    emailSettings: settings,
    data: { title: campaign.name, ...listContext },
  });

  if (result.status === 'pending') {
    const nextIndex = stepIndex + 1;
    if (nextIndex >= campaign.steps.length) {
      await completeEnrollment(ref, campaign.id);
      return 'completed';
    }
    const delayMs = Math.max(0, campaign.steps[nextIndex].delayHours) * 60 * 60 * 1000;
    await ref.update({
      currentStep: nextIndex,
      nextSendAt: Timestamp.fromMillis(Date.now() + delayMs),
      lastSentAt: Timestamp.now(),
      heldReason: FieldValue.delete(),
    });
    return 'sent';
  }

  if (result.skipReason === 'suppressed') {
    await exitEnrollment(ref, campaign.id, 'unsubscribed');
    return 'exited';
  }

  if (result.skipReason === 'unsubscribed') {
    // queueEmail reports an unconfirmed (`pending`) address and a real opt-out
    // with the same skipReason. The genuine opt-out already exited above from the
    // contact's own consent, so a skip reaching here is a U2 pending contact:
    // hold the step rather than exiting, or signing up would enroll them in a
    // list's drip and then drop them before they ever verified.
    if ((contact['consent'] as { marketing?: string })?.marketing === 'pending') {
      // Record WHY it was held. `holdEnrollment` pushes nextSendAt 15 minutes out,
      // which would otherwise hide this enrollment from the promotion flush — the
      // exact moment it becomes sendable. The marker lets that flush find it.
      await holdEnrollment(ref, 'pending_consent');
      return 'held';
    }
    await exitEnrollment(ref, campaign.id, 'unsubscribed');
    return 'exited';
  }

  // Kill-switch / feature disabled / template inactive → hold, retry later.
  await holdEnrollment(ref);
  return 'held';
}

/**
 * Send any of one contact's enrollments that are due right now (U5 fast path).
 *
 * Called at the two moments a day-0 step becomes sendable: joining a list, and
 * being promoted to `subscribed` on verification. The second matters more than it
 * looks — at signup a contact is `pending`, so the day-0 step is held; without a
 * flush at verification it would wait for the next 15-minute tick, and a "you're
 * in!" email arriving a quarter of an hour late reads as broken.
 */
export async function flushDueEnrollments(contactId: string): Promise<EnrollmentOutcome[]> {
  const now = Timestamp.now();
  const seen = new Map<string, FirebaseFirestore.QueryDocumentSnapshot>();

  const collect = async (q: FirebaseFirestore.Query): Promise<void> => {
    try {
      const snap = await q.get();
      snap.docs.forEach((d) => seen.set(d.id, d));
    } catch (err) {
      // A missing composite index used to fail silently here and quietly downgrade
      // the whole feature to the 15-minute scheduler. Log loudly; the scheduler is
      // still the safety net, so this costs latency rather than delivery.
      const { logger } = await import('firebase-functions/v2');
      logger.error('flushDueEnrollments: query failed (missing index?)', err);
    }
  };

  const base = db.collection('DripEnrollments')
    .where('contactId', '==', contactId)
    .where('status', '==', 'active');

  // Steps that are simply due.
  await collect(base.where('nextSendAt', '<=', now));
  // Steps held only because the contact had not verified yet — this call IS the
  // verification, so their nextSendAt (pushed 15 min out by the hold) is stale.
  await collect(base.where('heldReason', '==', 'pending_consent'));

  const outcomes: EnrollmentOutcome[] = [];
  const cache = new Map<string, DripCampaignDoc | null>();
  for (const doc of seen.values()) {
    outcomes.push(await sendDueEnrollment(doc.ref, doc.data(), { campaignCache: cache }));
  }
  return outcomes;
}

export async function loadCampaign(
  id: string,
  cache: Map<string, DripCampaignDoc | null>,
): Promise<DripCampaignDoc | null> {
  if (cache.has(id)) return cache.get(id)!;
  const snap = await db.collection('DripCampaigns').doc(id).get();
  const c = snap.exists ? ({ id: snap.id, ...(snap.data() as Omit<DripCampaignDoc, 'id'>) }) : null;
  cache.set(id, c);
  return c;
}

async function loadTemplate(templateId: string): Promise<(EmailTemplateData & { isActive?: boolean }) | null> {
  const snap = await db.collection('EmailTemplate').doc(templateId).get();
  return snap.exists ? (snap.data() as EmailTemplateData & { isActive?: boolean }) : null;
}

export async function exitEnrollment(
  ref: FirebaseFirestore.DocumentReference,
  campaignId: string | undefined,
  reason: string,
): Promise<void> {
  await ref.update({ status: 'exited', exitedReason: reason, exitedAt: Timestamp.now() });
  if (campaignId) await bump(campaignId, 'exited');
}

export async function completeEnrollment(
  ref: FirebaseFirestore.DocumentReference,
  campaignId: string,
): Promise<void> {
  await ref.update({ status: 'completed', completedAt: Timestamp.now() });
  await bump(campaignId, 'completed');
}

/**
 * Push nextSendAt out so we retry next cycle without advancing the step.
 *
 * `reason` records why, which matters for `pending_consent`: that hold clears the
 * instant the contact verifies, and the promotion flush needs to find the
 * enrollment even though its nextSendAt now sits in the future.
 */
export async function holdEnrollment(
  ref: FirebaseFirestore.DocumentReference,
  reason?: 'pending_consent',
): Promise<void> {
  await ref.update({
    nextSendAt: Timestamp.fromMillis(Date.now() + HOLD_RETRY_MS),
    heldReason: reason ?? FieldValue.delete(),
  });
}

async function bump(campaignId: string, field: 'completed' | 'exited'): Promise<void> {
  try {
    const { FieldValue } = await import('firebase-admin/firestore');
    await db.collection('DripCampaigns').doc(campaignId).set(
      { counts: { [field]: FieldValue.increment(1) } },
      { merge: true },
    );
  } catch { /* best-effort */ }
}
