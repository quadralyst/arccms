import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { backfillEnrollments, exitCampaignEnrollments, type DripCampaignDoc } from './dripEnrollment.js';
import { appListConditionsOf } from '../app-audience/appLists.js';
import { backfillAppCampaign } from '../app-audience/appDrips.js';
import { isArcAdmin } from '../users/claims.js';

function requireAdmin(request: { auth?: { token?: Record<string, unknown> } }): void {
  if (!isArcAdmin(request.auth?.token)) {
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
  let appUsersCapped = false;
  if (campaign.enrollExistingOnActivate) {
    // An App users (live) list has no stored members: enroll whoever matches now (CO6.5c).
    const list = await db.collection('Lists').doc(campaign.listId).get();
    const conditions = appListConditionsOf(list.exists ? list.data() : undefined);
    if (conditions) {
      const backfill = await backfillAppCampaign({ ...campaign, status: 'active' }, conditions);
      enrolled = backfill.enrolled;
      appUsersCapped = backfill.truncated;
    } else {
      enrolled = await backfillEnrollments({ ...campaign, status: 'active' });
    }
  }
  logger.info(`activateDripCampaign: ${id} active, backfilled ${enrolled}${appUsersCapped ? ' (first app users only)' : ''}.`);
  return { enrolled, appUsersCapped };
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
