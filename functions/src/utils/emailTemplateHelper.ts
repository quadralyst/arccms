import { db } from '../init.js';
// constant import removed
import { EmailTemplateData, WaitlistUserData } from '../types.js';
import { queueEmail } from '../email-core/queueEmail.js';

/**
 * Fetches an email template, preferring the waitlist-specific one over the global config.
 */
export async function getEmailTemplate(
  waitlistId: string,
  templateType: 'waitlist_verify_otp_email' | 'waitlist_welcome_email'
): Promise<EmailTemplateData> {
  // 1. Try to find a waitlist-specific template
  const waitlistSnap = await db
    .collection('EmailTemplate')
    .where('waitlistId', '==', waitlistId)
    .where('type', '==', templateType)
    .limit(1)
    .get();

  if (!waitlistSnap.empty) {
    return waitlistSnap.docs[0].data() as EmailTemplateData;
  }

  // 2. Fallback to global config template
  const configSnap = await db
    .collection('EmailTemplate')
    .where('type', '==', templateType)
    .limit(1)
    .get();

  if (!configSnap.empty) {
    return configSnap.docs[0].data() as EmailTemplateData;
  }

  throw new Error(`No email template found for type: ${templateType}`);
}

/**
 * Creates an email log for OTP verification.
 * Transactional — routed through the queueEmail() chokepoint.
 */
export async function createOtpEmailLog(
  userData: WaitlistUserData,
  templateData: EmailTemplateData
): Promise<void> {
  const toName = userData.firstName || userData.name || userData.email.split('@')[0];
  await queueEmail({
    source: 'waitlist',
    category: 'transactional',
    toEmail: userData.email,
    toName,
    senderEmail: templateData.senderEmail,
    senderName: templateData.senderName,
    subject: templateData.subject,
    template: templateData.template,
    text: templateData.previewText || '',
    type: 'waitlist_verify_otp_email',
    templateIsActive: templateData.isActive !== false,
    data: { otp: userData.verificationCode },
  });
}

/**
 * Creates an email log for welcome email.
 * Marketing — respects the recipient's subscription state + suppression list.
 */
export async function createWelcomeEmailLog(
  userData: WaitlistUserData,
  templateData: EmailTemplateData,
  waitlistName: string = ''
): Promise<void> {
  const toName = userData.firstName || userData.name || userData.email.split('@')[0];
  await queueEmail({
    source: 'waitlist',
    category: 'marketing',
    toEmail: userData.email,
    toName,
    senderEmail: templateData.senderEmail,
    senderName: templateData.senderName,
    subject: templateData.subject,
    template: templateData.template,
    text: templateData.previewText || '',
    type: 'waitlist_welcome_email',
    templateIsActive: templateData.isActive !== false,
    isSubscribed: userData.isSubscribed !== false,
    data: {
      waitlistName,
      referralLink: userData.referralLink || '',
      leaderboardLink: userData.leaderboardLink || '',
      position: userData.queuePosition,
    },
  });
}
