import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { EmailTemplateData } from '../types.js';
import { queueEmail } from '../email-core/queueEmail.js';
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
  type: PaymentEmailType | 'updates_ending_email',
  recipient: { email: string; name?: string },
  vars: {
    amount?: number;
    currency?: string;
    status?: string;
    plan?: string;
    renewalDate?: string;
    trialEndsAt?: string;
    /** ##UPDATES_END_DATE## — used by the updates-ending reminder (E2). */
    updatesEndDate?: string;
  },
  /**
   * Stable per-event key. When given, the EmailLogs document id is derived from
   * it so re-processing the same webhook (the trigger now retries on failure)
   * can never enqueue a second copy of the same email. Omit for one-shot sends.
   */
  dedupeKey?: string,
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

  const toName = recipient.name || recipient.email.split('@')[0];

  // Route through the queueEmail() chokepoint — it enforces the kill-switch,
  // the paymentEmails feature toggle, template-active state, and suppression,
  // and resolves BCC from settings. Payment email is transactional.
  await queueEmail({
    source: 'payment',
    category: 'transactional',
    toEmail: recipient.email,
    toName,
    senderEmail: template.senderEmail,
    senderName: template.senderName,
    subject: template.subject,
    template: template.template,
    text: template.previewText || '',
    type,
    templateIsActive: template.isActive !== false,
    data: {
      currency: vars.currency || '',
      price: vars.amount !== undefined ? String(vars.amount) : '',
      paymentStatus: vars.status || '',
      subscriptionPlan: vars.plan || '',
      renewalDate: vars.renewalDate || '',
      trialEndsAt: vars.trialEndsAt || '',
      updatesEndDate: vars.updatesEndDate || '',
    },
  });
  logger.info(`Enqueued payment email ${type} to ${recipient.email}`);
}
