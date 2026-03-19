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
        const templateData = await getEmailTemplate(
          newValue.waitlistId,
          'waitlist_welcome_email'
        );

        // Get waitlist name for template
        const waitlistDoc = await db.collection('Waitlists').doc(newValue.waitlistId).get();
        const waitlistName = waitlistDoc.exists ? waitlistDoc.data()?.name || '' : '';

        await createWelcomeEmailLog(newValue, templateData, waitlistName);
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
