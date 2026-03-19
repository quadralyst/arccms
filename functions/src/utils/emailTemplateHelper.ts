import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
// constant import removed
import { EmailTemplateData, WaitlistUserData, EmailLogData } from '../types.js';

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
 */
export async function createOtpEmailLog(
  userData: WaitlistUserData,
  templateData: EmailTemplateData
): Promise<void> {
  // Fetch settings for BCC
  let bccEmail = '';
  try {
    const settingsDoc = await db.collection('Settings').doc('email').get();
    if (settingsDoc.exists) {
      bccEmail = settingsDoc.data()?.bccEmail || '';
    }
  } catch (e) { console.error('Error fetching settings', e); }

  const emailObj: EmailLogData = {
    senderEmail: templateData.senderEmail,
    senderName: templateData.senderName,
    toName: userData.firstName || userData.name || userData.email.split('@')[0],
    name: userData.firstName || userData.name || userData.email.split('@')[0],
    toEmail: userData.email,
    subject: templateData.subject,
    template: templateData.template,
    text: templateData.previewText || '',
    bcc: bccEmail,
    type: 'waitlist_verify_otp_email',
    createdAt: Timestamp.now(),
    otp: userData.verificationCode,
  };

  await db.collection('EmailLogs').add(emailObj);
}

/**
 * Creates an email log for welcome email.
 */
export async function createWelcomeEmailLog(
  userData: WaitlistUserData,
  templateData: EmailTemplateData,
  waitlistName: string = ''
): Promise<void> {
  // Fetch settings for BCC
  let bccEmail = '';
  try {
    const settingsDoc = await db.collection('Settings').doc('email').get();
    if (settingsDoc.exists) {
      bccEmail = settingsDoc.data()?.bccEmail || '';
    }
  } catch (e) { console.error('Error fetching settings', e); }

  const emailObj: EmailLogData = {
    senderEmail: templateData.senderEmail,
    senderName: templateData.senderName,
    toName: userData.firstName || userData.name || userData.email.split('@')[0],
    name: userData.firstName || userData.name || userData.email.split('@')[0],
    toEmail: userData.email,
    subject: templateData.subject,
    template: templateData.template,
    text: templateData.previewText || '',
    bcc: bccEmail,
    type: 'waitlist_welcome_email',
    createdAt: Timestamp.now(),
    waitlistName: waitlistName,
    referralLink: userData.referralLink || '',
    leaderboardLink: userData.leaderboardLink || '',
    position: userData.queuePosition,
  };

  await db.collection('EmailLogs').add(emailObj);
}
