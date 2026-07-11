import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { EmailCategory, EmailSettings } from '../types.js';

/**
 * Phase 2 default transactional/marketing templates.
 *
 * Seeded idempotently by {@link ensureDefaultTemplates}. Each type gets a
 * deterministic doc id (= the type key) so re-seeding never duplicates and the
 * `where('type','==',…)` lookups used by senders resolve unambiguously.
 *
 * Templates are intentionally simple HTML with ##TAG## merge fields; Phase 4
 * (brand kit + block editor) re-authors them as block designs.
 */

export interface DefaultTemplateDef {
  type: string;
  category: EmailCategory;
  subject: string;
  title: string;
  previewText: string;
  /** Builder so sender identity from settings is baked in at seed time. */
  body: string;
}

/** Minimal branded shell shared by all default templates. */
function shell(inner: string, opts: { marketing?: boolean } = {}): string {
  const unsubscribe = opts.marketing
    ? `<p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">
         You are receiving this email because you signed up.
         <a href="##UNSUBSCRIBE_LINK##" style="color:#9ca3af;">Unsubscribe</a>.
       </p>`
    : '';
  return `<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.05);font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
  <div style="padding:40px;color:#374151;line-height:1.6;">
    ${inner}
    ${unsubscribe}
  </div>
  <div style="text-align:center;padding:20px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;">
    © ${new Date().getFullYear()} ##COMPANY_NAME##. All rights reserved.
  </div>
</div>`;
}

/** The canonical default template set. */
export const DEFAULT_TEMPLATES: DefaultTemplateDef[] = [
  {
    type: 'signup_otp_email',
    category: 'transactional',
    subject: 'Your verification code',
    title: 'Signup OTP Email',
    previewText: 'Your one-time verification code',
    body: shell(`
      <h1 style="font-size:22px;color:#111827;margin:0 0 20px;">Verify your email</h1>
      <p style="margin:0 0 20px;">Hello ##NAME##,</p>
      <p style="margin:0 0 20px;">Use this one-time code to verify your email address. It is valid for 10 minutes.</p>
      <div style="text-align:center;margin:0 0 20px;">
        <span style="display:inline-block;background:#e0f2fe;color:#0369a1;font-size:32px;font-weight:700;letter-spacing:6px;padding:14px 28px;border-radius:8px;border:2px dashed #93c5fd;">##OTP##</span>
      </div>
      <p style="margin:0;font-size:14px;color:#6b7280;">If you didn't request this, you can safely ignore this email.</p>`),
  },
  {
    type: 'signup_welcome_email',
    category: 'marketing',
    subject: 'Welcome aboard!',
    title: 'Signup Welcome Email',
    previewText: 'Welcome — your account is ready',
    body: shell(`
      <h1 style="font-size:22px;color:#111827;margin:0 0 20px;">Welcome, ##NAME##!</h1>
      <p style="margin:0 0 20px;">Your account is ready. We're glad to have you with us.</p>
      <p style="margin:0 0 20px;">If you have any questions, just reply to this email — we're happy to help.</p>`, { marketing: true }),
  },
  {
    type: 'updates_ending_email',
    category: 'transactional',
    subject: 'Your free updates are ending soon',
    title: 'Updates Ending Reminder',
    previewText: 'Your included updates window is ending soon',
    body: shell(`
      <h1 style="font-size:22px;color:#111827;margin:0 0 20px;">Your updates window is ending</h1>
      <p style="margin:0 0 20px;">Hello ##NAME##,</p>
      <p style="margin:0 0 20px;">Your included free updates end on <strong>##UPDATES_END_DATE##</strong>. After that date you'll keep everything you have today, but won't receive new updates unless you renew.</p>
      <p style="margin:0;">Thank you for your support!</p>`),
  },
  {
    type: 'payment_succeeded_email',
    category: 'transactional',
    subject: 'Payment received — thank you',
    title: 'Payment Succeeded',
    previewText: 'We received your payment',
    body: shell(`
      <h1 style="font-size:22px;color:#111827;margin:0 0 20px;">Payment received</h1>
      <p style="margin:0 0 20px;">Hello ##NAME##,</p>
      <p style="margin:0 0 20px;">Thank you! We've received your payment of <strong>##PAYMENT_AMOUNT##</strong> for <strong>##SUBSCRIPTION_PLAN##</strong>.</p>
      <p style="margin:0;">Your next renewal date is <strong>##RENEWAL_DATE##</strong>.</p>`),
  },
  {
    type: 'payment_failed_email',
    category: 'transactional',
    subject: 'Your payment could not be processed',
    title: 'Payment Failed',
    previewText: 'Action needed: payment failed',
    body: shell(`
      <h1 style="font-size:22px;color:#111827;margin:0 0 20px;">Payment failed</h1>
      <p style="margin:0 0 20px;">Hello ##NAME##,</p>
      <p style="margin:0 0 20px;">We were unable to process your payment of <strong>##PAYMENT_AMOUNT##</strong> for <strong>##SUBSCRIPTION_PLAN##</strong>.</p>
      <p style="margin:0;">Please update your payment method to keep your access active.</p>`),
  },
  {
    type: 'subscription_lifecycle_email',
    category: 'transactional',
    subject: 'An update about your subscription',
    title: 'Subscription Update',
    previewText: 'Your subscription status changed',
    body: shell(`
      <h1 style="font-size:22px;color:#111827;margin:0 0 20px;">Subscription update</h1>
      <p style="margin:0 0 20px;">Hello ##NAME##,</p>
      <p style="margin:0 0 20px;">The status of your <strong>##SUBSCRIPTION_PLAN##</strong> subscription is now: <strong>##PAYMENT_STATUS##</strong>.</p>
      <p style="margin:0;">If you have any questions about this change, just reply to this email.</p>`),
  },
  {
    type: 'trial_ending_email',
    category: 'transactional',
    subject: 'Your free trial ends soon',
    title: 'Trial Ending',
    previewText: 'Your trial is ending soon',
    body: shell(`
      <h1 style="font-size:22px;color:#111827;margin:0 0 20px;">Your trial is ending</h1>
      <p style="margin:0 0 20px;">Hello ##NAME##,</p>
      <p style="margin:0 0 20px;">Your free trial of <strong>##SUBSCRIPTION_PLAN##</strong> ends on <strong>##TRIAL_ENDS_AT##</strong>.</p>
      <p style="margin:0;">Upgrade now to keep uninterrupted access.</p>`),
  },
];

export interface SeedResult {
  created: string[];
  skipped: string[];
}

/**
 * Idempotently ensure a default template exists for every type.
 *
 * A type is considered present if ANY EmailTemplate doc already has that `type`
 * (so admin-created or previously-seeded docs are never duplicated). Missing
 * types are created with a deterministic doc id (= the type) and marked active.
 */
export async function ensureDefaultTemplates(): Promise<SeedResult> {
  let settings: EmailSettings | undefined;
  try {
    const snap = await db.collection('Settings').doc('email').get();
    settings = snap.data() as EmailSettings | undefined;
  } catch {
    /* fall back to blank sender identity */
  }

  const senderName = settings?.senderName || 'Arc CMS';
  const senderEmail = settings?.senderEmail || '';

  const created: string[] = [];
  const skipped: string[] = [];

  for (const def of DEFAULT_TEMPLATES) {
    const existing = await db
      .collection('EmailTemplate')
      .where('type', '==', def.type)
      .limit(1)
      .get();

    if (!existing.empty) {
      skipped.push(def.type);
      continue;
    }

    const now = Timestamp.now();
    await db.collection('EmailTemplate').doc(def.type).set({
      id: def.type,
      type: def.type,
      category: def.category,
      subject: def.subject,
      title: def.title,
      previewText: def.previewText,
      template: def.body,
      senderName,
      senderEmail,
      isActive: true,
      editorVersion: 'html',
      scope: 'global',
      createdBy: 'system',
      createdAt: now,
      modifiedBy: 'system',
      modifiedAt: now,
    });
    created.push(def.type);
  }

  return { created, skipped };
}
