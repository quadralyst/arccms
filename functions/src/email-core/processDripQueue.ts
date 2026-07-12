import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { EmailSettings, EmailTemplateData } from '../types.js';
import { queueEmail } from './queueEmail.js';
import type { DripCampaignDoc } from './dripEnrollment.js';

/** Max enrollments processed per run; leftovers are picked up next tick. */
const MAX_PER_RUN = 100;
/** Re-check delay when a send is held (feature/master off, template inactive). */
const HOLD_RETRY_MS = 15 * 60 * 1000;

/**
 * Drip scheduler (spec §Phase-7.3). Every 15 minutes, send the due step of each
 * active enrollment after re-verifying eligibility, then advance or complete.
 *
 * Kill-switch / drips-feature off ⇒ the step is HELD (never advanced or lost) so
 * it retries when re-enabled. Leaving the list / unsubscribing / suppression ⇒
 * the enrollment exits.
 */
export const processDripQueue = onSchedule({ schedule: 'every 15 minutes', timeZone: 'UTC' }, async () => {
  const now = Timestamp.now();
  let snap;
  try {
    snap = await db
      .collection('DripEnrollments')
      .where('status', '==', 'active')
      .where('nextSendAt', '<=', now)
      .limit(MAX_PER_RUN)
      .get();
  } catch (err) {
    logger.error('processDripQueue: query failed', err);
    return;
  }

  const settings = (await db.collection('Settings').doc('email').get()).data() as EmailSettings | undefined;
  const campaignCache = new Map<string, DripCampaignDoc | null>();
  let sent = 0;
  let held = 0;
  let exited = 0;
  let completed = 0;

  for (const doc of snap.docs) {
    const enr = doc.data();
    const campaign = await loadCampaign(enr['campaignId'], campaignCache);

    // Campaign gone or archived → exit; paused → hold untouched.
    if (!campaign || campaign.status === 'archived') { await exit(doc.ref, campaign?.id, 'archived'); exited++; continue; }
    if (campaign.status !== 'active') { held++; continue; }

    // Contact must still exist, still be on the list, and still be subscribed.
    const contactSnap = await db.collection('Contacts').doc(enr['contactId']).get();
    const contact = contactSnap.data();
    if (!contact) { await exit(doc.ref, campaign.id, 'left_list'); exited++; continue; }
    if (!((contact['listIds'] as string[]) || []).includes(campaign.listId)) { await exit(doc.ref, campaign.id, 'left_list'); exited++; continue; }
    if ((contact['consent'] as { marketing?: string })?.marketing === 'unsubscribed') { await exit(doc.ref, campaign.id, 'unsubscribed'); exited++; continue; }

    const stepIndex: number = enr['currentStep'] || 0;
    const step = campaign.steps?.[stepIndex];
    if (!step) { await complete(doc.ref, campaign.id); completed++; continue; }

    const template = await loadTemplate(step.templateId);
    if (!template) { await hold(doc.ref); held++; continue; }

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
      data: { title: campaign.name },
    });

    if (result.status === 'pending') {
      // Advance to the next step (or complete).
      const nextIndex = stepIndex + 1;
      if (nextIndex >= campaign.steps.length) {
        await complete(doc.ref, campaign.id);
        completed++;
      } else {
        const delayMs = Math.max(0, campaign.steps[nextIndex].delayHours) * 60 * 60 * 1000;
        await doc.ref.update({ currentStep: nextIndex, nextSendAt: Timestamp.fromMillis(Date.now() + delayMs), lastSentAt: now });
        sent++;
      }
    } else if (result.skipReason === 'unsubscribed' || result.skipReason === 'suppressed') {
      await exit(doc.ref, campaign.id, 'unsubscribed');
      exited++;
    } else {
      // Kill-switch / feature disabled / template inactive → hold, retry later.
      await hold(doc.ref);
      held++;
    }
  }

  logger.info(`processDripQueue: sent=${sent} completed=${completed} exited=${exited} held=${held} (${snap.size} due).`);
});

async function loadCampaign(id: string, cache: Map<string, DripCampaignDoc | null>): Promise<DripCampaignDoc | null> {
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

async function exit(ref: FirebaseFirestore.DocumentReference, campaignId: string | undefined, reason: string): Promise<void> {
  await ref.update({ status: 'exited', exitedReason: reason, exitedAt: Timestamp.now() });
  if (campaignId) await bump(campaignId, 'exited');
}

async function complete(ref: FirebaseFirestore.DocumentReference, campaignId: string): Promise<void> {
  await ref.update({ status: 'completed', completedAt: Timestamp.now() });
  await bump(campaignId, 'completed');
}

async function hold(ref: FirebaseFirestore.DocumentReference): Promise<void> {
  // Push nextSendAt out so we retry next cycle without advancing the step.
  await ref.update({ nextSendAt: Timestamp.fromMillis(Date.now() + HOLD_RETRY_MS) });
}

async function bump(campaignId: string, field: 'completed' | 'exited'): Promise<void> {
  try {
    const { FieldValue } = await import('firebase-admin/firestore');
    await db.collection('DripCampaigns').doc(campaignId).set({ counts: { [field]: FieldValue.increment(1) } }, { merge: true });
  } catch { /* best-effort */ }
}
