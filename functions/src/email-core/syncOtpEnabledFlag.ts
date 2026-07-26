import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';

/**
 * Keeps `Waitlists/{id}.otpEnabled` in step with the form's OTP template.
 *
 * Two switches meant the same thing and could disagree:
 *  - `EmailTemplate/{formId}_waitlist_verify_otp_email.isActive`, which the server
 *    reads when deciding whether a signup needs verifying, and which `queueEmail`
 *    gates the send on; and
 *  - `Waitlists/{formId}.otpEnabled`, which the **public form** reads to decide
 *    whether to show the code step at all.
 *
 * Only one UI path wrote the second one (the admin Templates page, on save), so any
 * other route to `isActive` — seeding a default, an import, a direct edit — left the
 * public form showing or hiding the OTP step against the server's actual behaviour.
 * A form could ask a visitor for a code that would never be sent, or skip the step
 * while the server still demanded one.
 *
 * `isActive` on the template is authoritative; this mirrors it. Writing to
 * `Waitlists` (never `EmailTemplate`) means it cannot retrigger itself.
 */
export const syncOtpEnabledFlag = onDocumentWritten('EmailTemplate/{templateId}', async (event) => {
  const after = event.data?.after;
  if (!after?.exists) return; // deletion: the default is recreated on demand

  const data = after.data() || {};
  if (data['type'] !== 'waitlist_verify_otp_email') return;

  const formId = data['waitlistId'] as string | undefined;
  if (!formId) return; // a global template governs no single form

  const isActive = data['isActive'] !== false;

  // Skip the write when nothing changed, so an unrelated template edit does not
  // churn the form doc (and its own update triggers).
  const before = event.data?.before?.exists ? event.data.before.data() : undefined;
  if (before && (before['isActive'] !== false) === isActive) return;

  try {
    const formRef = db.collection('Waitlists').doc(formId);
    if (!(await formRef.get()).exists) return;
    await formRef.update({ otpEnabled: isActive });
    logger.info(`syncOtpEnabledFlag: ${formId}.otpEnabled = ${isActive}.`);
  } catch (err) {
    logger.error(`syncOtpEnabledFlag: could not mirror onto Waitlists/${formId}`, err);
  }
});
