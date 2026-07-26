import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { waitlistTemplateDocId } from './defaultTemplates.js';

/**
 * Admin callable: turn each form's welcome email into a day-0 sequence step
 * (audience-unification spec U5, runbook step 7).
 *
 * The welcome becomes step 0 of a per-list drip campaign, so it lives in the same
 * place as every other automated email and an admin can extend it (day 3, day 7)
 * without new plumbing. The day-0 fast path sends it within seconds of
 * verification, matching the old direct trigger's timing.
 *
 * Sets `Waitlists/{id}.welcomeMigrated`, which makes the legacy direct trigger
 * no-op for that form — that flag is the only thing standing between "one welcome"
 * and "two welcomes", so it is written **after** the campaign exists.
 *
 * Idempotent: a campaign carrying `isWelcomeSequence` for the list is left alone.
 * Reversible: unset `welcomeMigrated` and the direct trigger resumes.
 */
export const migrateWelcomeToSequences = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const dryRun = request.data?.dryRun === true;

  try {
    const forms = await db.collection('Waitlists').get();

    let created = 0;
    let alreadyMigrated = 0;
    let noTemplate = 0;
    const details: Array<{ formId: string; listId: string; templateId: string }> = [];

    for (const form of forms.docs) {
      const formId = form.id;
      const listId = `waitlist-${formId}`;

      // Already has a welcome sequence? Leave it (and make sure the guard is on,
      // in case a previous run created the campaign but failed before flagging).
      const existing = await db
        .collection('DripCampaigns')
        .where('listId', '==', listId)
        .where('isWelcomeSequence', '==', true)
        .limit(1)
        .get();
      if (!existing.empty) {
        if (!dryRun && form.data()['welcomeMigrated'] !== true) {
          await form.ref.update({ welcomeMigrated: true });
        }
        alreadyMigrated++;
        continue;
      }

      // Prefer the form's own welcome template; fall back to the global default.
      const perForm = waitlistTemplateDocId(formId, 'waitlist_welcome_email');
      let templateId = '';
      if ((await db.collection('EmailTemplate').doc(perForm).get()).exists) {
        templateId = perForm;
      } else {
        const global = await db
          .collection('EmailTemplate')
          .where('type', '==', 'waitlist_welcome_email')
          .limit(1)
          .get();
        if (!global.empty) templateId = global.docs[0].id;
      }

      if (!templateId) {
        // No welcome content anywhere — migrating would create a campaign that
        // sends nothing, and would silence the direct trigger too. Skip loudly.
        noTemplate++;
        continue;
      }

      details.push({ formId, listId, templateId });
      if (dryRun) { created++; continue; }

      const now = Timestamp.now();
      const campaignRef = db.collection('DripCampaigns').doc();
      await campaignRef.set({
        id: campaignRef.id,
        name: 'Welcome sequence',
        listId,
        status: 'active',
        trigger: 'list_join',
        // Marks this as the migrated welcome, for idempotency and so the UI can
        // explain why the campaign exists.
        isWelcomeSequence: true,
        // Existing members already got their welcome from the direct trigger;
        // backfilling would email everyone a second time.
        enrollExistingOnActivate: false,
        steps: [{ id: 'welcome', templateId, delayHours: 0 }],
        exit: { onListLeave: true, onUnsubscribe: true },
        counts: { enrolled: 0, completed: 0, exited: 0 },
        createdAt: now,
        updatedAt: now,
      });

      // Only now silence the direct trigger.
      await form.ref.update({ welcomeMigrated: true });
      created++;
    }

    const result = { dryRun, forms: forms.size, created, alreadyMigrated, noTemplate, details };
    logger.info('migrateWelcomeToSequences complete', result);
    return result;
  } catch (err) {
    logger.error('migrateWelcomeToSequences failed', err);
    throw new HttpsError('internal', 'Welcome migration failed.');
  }
});
