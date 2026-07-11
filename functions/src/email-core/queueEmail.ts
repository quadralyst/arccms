import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type {
  EmailCategory,
  EmailSource,
  EmailSkipReason,
  EmailSettings,
} from '../types.js';
import { computeEmailHash } from './unsubscribeToken.js';

/** Default max delivery attempts before an email is marked `failed`. */
export const DEFAULT_MAX_ATTEMPTS = 3;

/**
 * Map an email source to its feature toggle key under `Settings/email.features`.
 * Sources with no dedicated toggle (`event`, `test`) are always allowed when the
 * master switch is on.
 */
const SOURCE_FEATURE_KEY: Partial<Record<EmailSource, keyof NonNullable<EmailSettings['features']>>> = {
  waitlist: 'waitlistEmails',
  auth: 'authEmails',
  payment: 'paymentEmails',
  notification: 'notificationEmails',
  broadcast: 'broadcasts',
  drip: 'drips',
};

export interface QueueEmailParams {
  /** Which feature is producing this email (drives the feature-toggle gate). */
  source: EmailSource;
  /** transactional vs marketing (drives consent/suppression rules). */
  category: EmailCategory;
  /** Recipient. */
  toEmail: string;
  toName?: string;
  /** Sender identity (from the template). */
  senderEmail: string;
  senderName: string;
  /** Raw subject / template HTML, still containing ##TAG## tokens. */
  subject: string;
  template: string;
  /** Plain-text/preview fallback. */
  text?: string;
  /** Template type key (e.g. `waitlist_verify_otp_email`). */
  type: string;
  /** BCC address (admin copy). Resolved from settings when omitted. */
  bcc?: string;
  /**
   * Whether the caller's template is active. Pass `false` to have the send
   * skipped with `template_inactive`. Defaults to active.
   */
  templateIsActive?: boolean;
  /**
   * Marketing consent for this recipient (Phase 1: waitlist `isSubscribed`).
   * When `false` and category is marketing, the send is skipped `unsubscribed`.
   * Transactional emails ignore this.
   */
  isSubscribed?: boolean;
  /** Extra tag data merged onto the log (otp, currency, price, waitlistName…). */
  data?: Record<string, unknown>;
  /** Override default max delivery attempts. */
  maxAttempts?: number;
  /**
   * Pre-loaded `Settings/email` document (avoids a per-recipient read in hot
   * paths such as broadcasts). When omitted, it is read once here.
   */
  emailSettings?: EmailSettings;
}

export interface QueueEmailResult {
  id: string;
  status: 'pending' | 'skipped' | 'suppressed';
  skipReason?: EmailSkipReason;
}

/**
 * The ONLY sanctioned way to create an `EmailLogs` document.
 *
 * Runs the kill-switch → feature-toggle → template-active → consent →
 * suppression gates in order (spec §Phase-1). A blocked send is still written
 * to `EmailLogs` (status `skipped`/`suppressed` + `skipReason`) so every
 * decision is auditable — nothing is ever silently dropped.
 *
 * A `pending` doc fires `onEmailLogCreate` → `sendMail()`. Blocked docs are
 * ignored by that trigger.
 */
export async function queueEmail(params: QueueEmailParams): Promise<QueueEmailResult> {
  const settings = params.emailSettings ?? (await readEmailSettings());
  const emailHash = computeEmailHash(params.toEmail);

  const base = {
    senderEmail: params.senderEmail,
    senderName: params.senderName,
    toName: params.toName || params.toEmail.split('@')[0] || '',
    name: params.toName || params.toEmail.split('@')[0] || '',
    toEmail: params.toEmail,
    subject: params.subject,
    template: params.template,
    text: params.text || '',
    bcc: params.bcc ?? settings?.bccEmail ?? '',
    type: params.type,
    category: params.category,
    source: params.source,
    emailHash,
    attempts: 0,
    maxAttempts: params.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    createdAt: Timestamp.now(),
    ...(params.data || {}),
  };

  const blocked = (
    status: 'skipped' | 'suppressed',
    skipReason: EmailSkipReason,
  ): Promise<QueueEmailResult> =>
    writeLog({ ...base, status, skipReason }).then((id) => ({ id, status, skipReason }));

  // 1. Master kill-switch — email disabled (or no provider configured).
  if (!settings?.isEnabled || !settings?.activeProvider) {
    return blocked('skipped', 'email_disabled');
  }

  // 2. Feature toggle — a feature OFF disables only that feature.
  const featureKey = SOURCE_FEATURE_KEY[params.source];
  if (featureKey && settings.features?.[featureKey] === false) {
    return blocked('skipped', 'feature_disabled');
  }

  // 3. Template active check.
  if (params.templateIsActive === false) {
    return blocked('skipped', 'template_inactive');
  }

  // 4. Category / consent check (marketing only).
  if (params.category === 'marketing' && params.isSubscribed === false) {
    return blocked('skipped', 'unsubscribed');
  }

  // 5. Suppression check.
  //    marketing ⇒ any suppression reason blocks;
  //    transactional ⇒ only hard bounce/complaint block (protect reputation).
  const suppression = await getSuppression(emailHash);
  if (suppression) {
    const hardReason = suppression.reason === 'bounce' || suppression.reason === 'complaint';
    if (params.category === 'marketing' || hardReason) {
      return blocked('suppressed', 'suppressed');
    }
  }

  // 6. Passed all gates — enqueue for delivery.
  const id = await writeLog({ ...base, status: 'pending' });
  return { id, status: 'pending' };
}

async function writeLog(data: Record<string, unknown>): Promise<string> {
  const ref = await db.collection('EmailLogs').add(data);
  return ref.id;
}

async function readEmailSettings(): Promise<EmailSettings | undefined> {
  try {
    const snap = await db.collection('Settings').doc('email').get();
    return snap.data() as EmailSettings | undefined;
  } catch (err) {
    console.error('queueEmail: failed to read Settings/email', err);
    return undefined;
  }
}

async function getSuppression(
  emailHash: string,
): Promise<{ reason: string } | undefined> {
  try {
    const snap = await db.collection('Suppression').doc(emailHash).get();
    return snap.exists ? (snap.data() as { reason: string }) : undefined;
  } catch (err) {
    console.error('queueEmail: failed to read Suppression', err);
    return undefined;
  }
}
