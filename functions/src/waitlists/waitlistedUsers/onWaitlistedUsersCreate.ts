import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getEmailTemplate, createOtpEmailLog } from '../../utils/emailTemplateHelper.js';
import { WaitlistUserData } from '../../types.js';

export const onWaitlistedUsersCreate = onDocumentCreated(
  'WaitlistedUsers/{WaitlistedUsersId}',
  async (event) => {
    const waitlistedUsersData = event.data?.data() as WaitlistUserData | undefined;
    if (!waitlistedUsersData) return;

    // Only send OTP if verification code exists and email is NOT yet verified
    const hasVerificationCode =
      waitlistedUsersData.verificationCode &&
      waitlistedUsersData.verificationCode !== '';

    if (hasVerificationCode && waitlistedUsersData.emailVerified === false) {
      try {
        const templateData = await getEmailTemplate(
          waitlistedUsersData.waitlistId,
          'waitlist_verify_otp_email'
        );
        await createOtpEmailLog(waitlistedUsersData, templateData);
      } catch (error) {
        console.error('Error sending OTP email on waitlisted user create:', error);
      }
    }
  }
);
