import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { db } from '../../init.js';
import {
  getEmailTemplate,
  createWelcomeEmailLog,
  createOtpEmailLog,
} from '../../utils/emailTemplateHelper.js';
import { WaitlistUserData } from '../../types.js';

export const onWaitlistUserUpdate = onDocumentUpdated(
  'Waitlists/{WaitlistsId}/users/{usersId}',
  async (event) => {
    const oldValue = event.data?.before.data() as WaitlistUserData | undefined;
    const newValue = event.data?.after.data() as WaitlistUserData | undefined;

    if (!oldValue || !newValue) return;

    // Send welcome email if email just became verified
    if (oldValue.emailVerified !== newValue.emailVerified && newValue.emailVerified === true) {
      try {
        // Get waitlist name for template (and the U5 migration guard).
        const waitlistDoc = await db.collection('Waitlists').doc(newValue.waitlistId).get();
        const waitlistName = waitlistDoc.exists ? waitlistDoc.data()?.name || '' : '';

        // U5: once this form's welcome is a day-0 sequence step, the sequence owns
        // it — sending here too would deliver two welcomes. Deleted entirely in U7;
        // kept as a guarded no-op so unsetting the flag restores the old behaviour.
        if (waitlistDoc.data()?.['welcomeMigrated'] === true) {
          console.log(`onWaitlistUserUpdate: welcome for ${newValue.waitlistId} is sequence-owned; skipping direct send.`);
        } else {
          const templateData = await getEmailTemplate(
            newValue.waitlistId,
            'waitlist_welcome_email'
          );
          await createWelcomeEmailLog(newValue, templateData, waitlistName);
        }
      } catch (error) {
        console.error('Error sending welcome email:', error);
      }
    }

    // Send OTP email when a returning verified user re-enters their email.
    // This lets them verify and navigate directly to the leaderboard page.
    const verificationCodeChanged =
      oldValue.verificationCode !== newValue.verificationCode &&
      newValue.verificationCode &&
      newValue.verificationCode !== '';

    if (verificationCodeChanged && newValue.emailVerified) {
      try {
        const templateData = await getEmailTemplate(
          newValue.waitlistId,
          'waitlist_verify_otp_email'
        );
        await createOtpEmailLog(newValue, templateData);
      } catch (error) {
        console.error('Error sending OTP email on waitlisted user update:', error);
      }
    }
  }
);
