import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { Timestamp } from 'firebase-admin/firestore';
import {
  ensureWaitlistTemplates,
  formTemplateExists,
  isUntouchedSystemTemplate,
  SUPERSEDED_WELCOME_SUBJECTS,
  WELCOME_SUBJECT_DEFAULT,
} from './defaultTemplates.js';

/**
 * Admin callable: give every existing signup form its default OTP + welcome
 * templates (audience-unification spec U5.5).
 *
 * Correctness does not depend on this — `getEmailTemplate` seeds a form's defaults
 * the first moment one is needed. This exists so an upgraded install looks right
 * *before* that happens: without it, the admin Templates page shows empty tabs for
 * every form created before the seeding trigger existed, which reads as broken.
 *
 * Idempotent, and never overwrites an existing template, so admin edits survive
 * repeated runs. `dryRun` reports what would be created without writing.
 */
export const backfillWaitlistTemplates = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const dryRun = request.data?.dryRun === true;

  try {
    const forms = await db.collection('Waitlists').get();

    let formsSeeded = 0;
    let formsAlreadyComplete = 0;
    let templatesCreated = 0;
    let subjectsUpgraded = 0;
    const details: { formId: string; created: string[] }[] = [];
    const upgraded: { formId: string; from: string; to: string }[] = [];

    /**
     * Bring an already-seeded welcome template up to the current default subject.
     *
     * The ensure never overwrites, so without this an upgraded install keeps
     * sending the literal subject "Waitlist welcome email" forever — the whole
     * point of the change would land only on forms created afterwards. Restricted
     * to a superseded subject on a template no human has edited, so a custom
     * subject is never clobbered.
     */
    async function upgradeWelcomeSubject(formId: string): Promise<void> {
      // Resolve by (waitlistId, type) rather than by doc id — an older form's
      // welcome may live under a legacy or auto-generated id, and it is exactly
      // those forms that still carry the superseded subject.
      const found = await db
        .collection('EmailTemplate')
        .where('waitlistId', '==', formId)
        .where('type', '==', 'waitlist_welcome_email')
        .limit(1)
        .get();
      if (found.empty) return;

      const ref = found.docs[0].ref;
      const data = found.docs[0].data() || {};
      const current = String(data['subject'] || '');
      const target = WELCOME_SUBJECT_DEFAULT;
      if (current === target) return;
      if (!SUPERSEDED_WELCOME_SUBJECTS.includes(current)) return;
      if (!isUntouchedSystemTemplate(data)) return;

      subjectsUpgraded++;
      upgraded.push({ formId, from: current, to: target });
      if (!dryRun) await ref.update({ subject: target, modifiedAt: Timestamp.now() });
    }

    for (const form of forms.docs) {
      if (dryRun) {
        // Report only — mirror the ensure's own existence check rather than
        // writing anything.
        // Same presence check as the real run, so the dry run cannot under- or
        // over-report. Checking the canonical doc id here would have claimed every
        // older form was missing both templates when it had customised ones under a
        // legacy or auto-generated id.
        const missing: string[] = [];
        for (const type of ['waitlist_welcome_email', 'waitlist_verify_otp_email']) {
          if (!(await formTemplateExists(form.id, type))) missing.push(type);
        }
        if (missing.length) {
          formsSeeded++;
          templatesCreated += missing.length;
          details.push({ formId: form.id, created: missing });
        } else {
          formsAlreadyComplete++;
        }
        await upgradeWelcomeSubject(form.id);
        continue;
      }

      const { created } = await ensureWaitlistTemplates(form.id);
      if (created.length) {
        formsSeeded++;
        templatesCreated += created.length;
        details.push({ formId: form.id, created });
      } else {
        formsAlreadyComplete++;
      }
      await upgradeWelcomeSubject(form.id);
    }

    logger.info(
      `backfillWaitlistTemplates${dryRun ? ' (dry run)' : ''}: `
      + `${templatesCreated} template(s) across ${formsSeeded} form(s); `
      + `${formsAlreadyComplete} already complete; `
      + `${subjectsUpgraded} welcome subject(s) upgraded.`,
    );

    return {
      success: true,
      dryRun,
      formsScanned: forms.size,
      formsSeeded,
      formsAlreadyComplete,
      templatesCreated,
      subjectsUpgraded,
      details,
      upgraded,
    };
  } catch (err) {
    logger.error('backfillWaitlistTemplates failed', err);
    throw new HttpsError('internal', 'Could not backfill the form templates.');
  }
});
