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

  if (!dedupeKey) {
    await db.collection('EmailLogs').add(emailObj);
    logger.info(`Enqueued payment email ${type} to ${recipient.email}`);
    return;
  }

  // create() fails with ALREADY_EXISTS if this email was already enqueued for
  // this event — the idempotent no-op we want when the trigger retries.
  try {
    await db.collection('EmailLogs').doc(emailLogId(type, dedupeKey)).create(emailObj);
    logger.info(`Enqueued payment email ${type} to ${recipient.email}`);
  } catch (error) {
    if (isAlreadyExists(error)) {
      logger.info(`Payment email ${type} for ${dedupeKey} already enqueued; skipping.`);
      return;
    }
    throw error;
  }
}

/** Deterministic EmailLogs doc id. `/` is illegal in a doc id; keys may contain it. */
function emailLogId(type: PaymentEmailType, dedupeKey: string): string {
  return `${type}__${dedupeKey}`.replace(/\//g, '_').slice(0, 1500);
}

/** True for a Firestore ALREADY_EXISTS error (gRPC status 6). */
function isAlreadyExists(error: unknown): boolean {
  const code = (error as { code?: unknown })?.code;
  return code === 6 || code === 'already-exists';
}
