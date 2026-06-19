import { Timestamp } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { EmailLogData, EmailTemplateData } from '../types.js';
import { PaymentEmailType } from './types.js';

/**
 * Enqueue a transactional payment email by writing an EmailLogs document.
 * The existing `onEmailLogCreate` trigger then sends it via the configured
 * provider, and `processEmailTemplate` fills the ##TAG## tokens.
 *
 * Payment email templates are global (not waitlist-scoped) and admin-toggleable:
 * if no template exists or it is not active, nothing is sent.
 *
 * Tag support (resolved by processEmailTemplate):
 *   ##NAME## / ##RECEIVER_NAME##  → toName
 *   ##PAYMENT_AMOUNT##            → `${currency} ${price}`
 *   ##CURRENCY##                  → currency
 *   ##PAYMENT_STATUS##            → paymentStatus
 *   ##SUBSCRIPTION_PLAN##         → subscriptionPlan
 *   ##RENEWAL_DATE##              → renewalDate
 *   ##TRIAL_ENDS_AT##             → trialEndsAt
 */
export async function sendPaymentEmail(
  type: PaymentEmailType,
  recipient: { email: string; name?: string },
  vars: {
    amount?: number;
    currency?: string;
    status?: string;
    plan?: string;
    renewalDate?: string;
    trialEndsAt?: string;
  },
): Promise<void> {
  if (!recipient.email) {
    logger.warn(`sendPaymentEmail(${type}) skipped — no recipient email`);
    return;
  }

  // Look up the global payment template for this type.
  const snap = await db.collection('EmailTemplate').where('type', '==', type).limit(1).get();
  if (snap.empty) {
    logger.info(`No payment email template configured for ${type}; skipping.`);
    return;
  }

  const template = snap.docs[0].data() as EmailTemplateData & { isActive?: boolean };
  if (template.isActive === false) {
    logger.info(`Payment email template ${type} is disabled; skipping.`);
    return;
  }

  // BCC from email settings (mirrors the waitlist email helpers).
  let bccEmail = '';
  try {
    const settingsDoc = await db.collection('Settings').doc('email').get();
    if (settingsDoc.exists) {
      bccEmail = settingsDoc.data()?.['bccEmail'] || '';
    }
  } catch (e) {
    logger.error('Error fetching email settings for BCC', e);
  }

  const toName = recipient.name || recipient.email.split('@')[0];

  const emailObj: EmailLogData = {
    senderEmail: template.senderEmail,
    senderName: template.senderName,
    toName,
    name: toName,
    toEmail: recipient.email,
    subject: template.subject,
    template: template.template,
    text: template.previewText || '',
    bcc: bccEmail,
    type,
    createdAt: Timestamp.now(),
    // Tag data
    currency: vars.currency || '',
    price: vars.amount !== undefined ? String(vars.amount) : '',
    paymentStatus: vars.status || '',
    subscriptionPlan: vars.plan || '',
    renewalDate: vars.renewalDate || '',
    trialEndsAt: vars.trialEndsAt || '',
  };

  await db.collection('EmailLogs').add(emailObj);
  logger.info(`Enqueued payment email ${type} to ${recipient.email}`);
}
