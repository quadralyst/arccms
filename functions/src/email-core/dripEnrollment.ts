import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * Drip enrollment lifecycle (spec §Phase-7, D4). DB-only so it can be called
 * from the membership helpers in contacts.ts without an import cycle.
 *
 * Enrollment id = `${campaignId}_${contactId}` gives natural dedup: a contact
 * who already completed or exited a campaign is never re-enrolled.
 */

export interface DripStep {
  id: string;
  templateId: string;
  delayHours: number;
}

export interface DripCampaignDoc {
  id: string;
  name: string;
  listId: string;
  status: 'draft' | 'active' | 'paused' | 'archived';
  trigger: 'list_join';
  enrollExistingOnActivate?: boolean;
  steps: DripStep[];
  exit?: { onListLeave: boolean; onUnsubscribe: boolean };
  counts?: { enrolled: number; completed: number; exited: number };
}

export type ExitReason = 'left_list' | 'unsubscribed' | 'archived';

function enrollmentId(campaignId: string, contactId: string): string {
  return `${campaignId}_${contactId}`;
}

/** ms until the next step given delayHours (test override via DRIP_MINUTES_PER_HOUR). */
function delayMs(delayHours: number): number {
  return Math.max(0, delayHours) * 60 * 60 * 1000;
}

/** Enroll a contact into a specific campaign at step 0 (idempotent). */
export async function enrollInCampaign(campaign: DripCampaignDoc, contactId: string): Promise<boolean> {
  if (campaign.status !== 'active' || !campaign.steps?.length) return false;
  const id = enrollmentId(campaign.id, contactId);
  const ref = db.collection('DripEnrollments').doc(id);
  const existing = await ref.get();
  if (existing.exists) return false; // natural dedup — never re-enter

  const now = Timestamp.now();
  await ref.set({
    campaignId: campaign.id,
    listId: campaign.listId,
    contactId,
    status: 'active',
    currentStep: 0,
    nextSendAt: Timestamp.fromMillis(now.toMillis() + delayMs(campaign.steps[0].delayHours)),
    enrolledAt: now,
  });
  await bumpCampaignCount(campaign.id, 'enrolled', 1);
  return true;
}

/** Enroll a contact into every active campaign on the given lists. */
export async function enrollInListCampaigns(contactId: string, listIds: string[]): Promise<void> {
  if (!listIds.length) return;
  let enrolledAny = false;
  // Firestore 'in' supports up to 10 values.
  for (let i = 0; i < listIds.length; i += 10) {
    const chunk = listIds.slice(i, i + 10);
    const snap = await db
      .collection('DripCampaigns')
      .where('status', '==', 'active')
      .where('listId', 'in', chunk)
      .get();
    for (const doc of snap.docs) {
      if (await enrollInCampaign({ id: doc.id, ...(doc.data() as Omit<DripCampaignDoc, 'id'>) }, contactId)) {
        enrolledAny = true;
      }
    }
  }

  // Day-0 fast path (U5): a step with delayHours 0 is due the moment it is
  // enrolled, so send it now rather than waiting up to 15 minutes for the
  // scheduler. Dynamically imported to keep this module free of the send path
  // (contacts.ts imports it, and the sender imports contacts).
  if (enrolledAny) {
    try {
      const { flushDueEnrollments } = await import('./dripSend.js');
      await flushDueEnrollments(contactId);
    } catch (err) {
      // The scheduler remains the safety net — a failed flush only costs latency.
      const { logger } = await import('firebase-functions/v2');
      logger.error('enrollInListCampaigns: day-0 flush failed', err);
    }
  }
}

/** Exit a contact's active enrollments for the given lists (e.g. they left the list). */
export async function exitListCampaignEnrollments(
  contactId: string,
  listIds: string[],
  reason: ExitReason = 'left_list',
): Promise<void> {
  if (!listIds.length) return;
  for (let i = 0; i < listIds.length; i += 10) {
    const chunk = listIds.slice(i, i + 10);
    const snap = await db
      .collection('DripEnrollments')
      .where('contactId', '==', contactId)
      .where('status', '==', 'active')
      .where('listId', 'in', chunk)
      .get();
    await exitDocs(snap.docs, reason);
  }
}

/** Exit ALL of a contact's active enrollments (e.g. they unsubscribed). */
export async function exitAllEnrollments(contactId: string, reason: ExitReason = 'unsubscribed'): Promise<void> {
  const snap = await db
    .collection('DripEnrollments')
    .where('contactId', '==', contactId)
    .where('status', '==', 'active')
    .get();
  await exitDocs(snap.docs, reason);
}

/** Exit every active enrollment of a campaign (e.g. it was archived). */
export async function exitCampaignEnrollments(campaignId: string, reason: ExitReason = 'archived'): Promise<void> {
  const snap = await db
    .collection('DripEnrollments')
    .where('campaignId', '==', campaignId)
    .where('status', '==', 'active')
    .get();
  await exitDocs(snap.docs, reason);
}

/** Backfill: enroll all current members of a campaign's list (on activation). */
export async function backfillEnrollments(campaign: DripCampaignDoc): Promise<number> {
  const snap = await db.collection('Contacts').where('listIds', 'array-contains', campaign.listId).get();
  let enrolled = 0;
  for (const doc of snap.docs) {
    if (await enrollInCampaign(campaign, doc.id)) enrolled++;
  }
  return enrolled;
}

async function exitDocs(docs: FirebaseFirestore.QueryDocumentSnapshot[], reason: ExitReason): Promise<void> {
  await Promise.all(
    docs.map(async (d) => {
      await d.ref.update({ status: 'exited', exitedReason: reason, exitedAt: Timestamp.now() });
      const campaignId = d.data()['campaignId'];
      if (campaignId) await bumpCampaignCount(campaignId, 'exited', 1);
    }),
  );
}

async function bumpCampaignCount(campaignId: string, field: 'enrolled' | 'completed' | 'exited', by: number): Promise<void> {
  try {
    const { FieldValue } = await import('firebase-admin/firestore');
    await db.collection('DripCampaigns').doc(campaignId).set(
      { counts: { [field]: FieldValue.increment(by) } },
      { merge: true },
    );
  } catch {
    /* counts are best-effort */
  }
}
