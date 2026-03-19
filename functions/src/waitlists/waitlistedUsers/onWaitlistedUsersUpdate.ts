import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { getEmailTemplate, createOtpEmailLog } from '../../utils/emailTemplateHelper.js';
import { WaitlistUserData } from '../../types.js';

export const onWaitlistedUserUpdate = onDocumentUpdated(
  'WaitlistedUsers/{WaitlistedUsersId}',
  async (event) => {
    const oldValue = event.data?.before.data() as WaitlistUserData | undefined;
    const newValue = event.data?.after.data() as WaitlistUserData | undefined;

    if (!oldValue || !newValue) return;

    // Send OTP email if verification code changed OR if the same code was
    // resent (expiry reset).  The resend flow reuses the existing code when it
    // hasn't expired yet, so only verificationExpires changes.  We still need
    // to re-send the email in that case.
    const hasVerificationCode =
      newValue.verificationCode && newValue.verificationCode !== '';

    const verificationCodeChanged =
      oldValue.verificationCode !== newValue.verificationCode;

    const verificationExpiresChanged =
      oldValue.verificationExpires?.toMillis?.() !==
      newValue.verificationExpires?.toMillis?.();

    const shouldSendOtp =
      hasVerificationCode &&
      (verificationCodeChanged || verificationExpiresChanged);

    if (shouldSendOtp) {
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
