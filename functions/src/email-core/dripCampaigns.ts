import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { backfillEnrollments, exitCampaignEnrollments, type DripCampaignDoc } from './dripEnrollment.js';

function requireAdmin(request: { auth?: { token?: Record<string, unknown> } }): void {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }
}

async function loadCampaign(id: string): Promise<DripCampaignDoc | null> {
  const snap = await db.collection('DripCampaigns').doc(id).get();
  return snap.exists ? ({ id: snap.id, ...(snap.data() as Omit<DripCampaignDoc, 'id'>) }) : null;
}

/**
 * Admin: activate a drip campaign. When `enrollExistingOnActivate` is set, all
 * current list members are backfilled into the campaign (idempotent).
 */
export const activateDripCampaign = onCall(async (request) => {
  requireAdmin(request);
  const id = String(request.data?.campaignId || '');
  const campaign = await loadCampaign(id);
  if (!campaign) throw new HttpsError('not-found', 'Campaign not found.');
  if (!campaign.steps?.length) throw new HttpsError('failed-precondition', 'Add at least one step before activating.');

  await db.collection('DripCampaigns').doc(id).set({ status: 'active', updatedAt: Timestamp.now() }, { merge: true });

  let enrolled = 0;
  if (campaign.enrollExistingOnActivate) {
    enrolled = await backfillEnrollments({ ...campaign, status: 'active' });
  }
  logger.info(`activateDripCampaign: ${id} active, backfilled ${enrolled}.`);
  return { enrolled };
});

/**
 * Admin: archive a drip campaign — exits all its active enrollments so no
 * further steps send.
 */
export const archiveDripCampaign = onCall(async (request) => {
  requireAdmin(request);
  const id = String(request.data?.campaignId || '');
  const campaign = await loadCampaign(id);
  if (!campaign) throw new HttpsError('not-found', 'Campaign not found.');

  await db.collection('DripCampaigns').doc(id).set({ status: 'archived', updatedAt: Timestamp.now() }, { merge: true });
  await exitCampaignEnrollments(id, 'archived');
  logger.info(`archiveDripCampaign: ${id} archived.`);
  return { ok: true };
});
