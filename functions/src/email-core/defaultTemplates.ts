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
    type: 'notification_generic_email',
    category: 'transactional',
    subject: '##TITLE##',
    title: 'Generic Notification',
    previewText: 'You have a new notification',
    body: shell(`
      <h1 style="font-size:20px;color:#111827;margin:0 0 16px;">##TITLE##</h1>
      <p style="margin:0 0 20px;">##BODY##</p>
      <p style="margin:0;"><a href="##LINK##" style="color:#3b82f6;">View details</a></p>`),
  },
  {
    type: 'admin_digest_email',
    category: 'transactional',
    subject: 'Your daily summary',
    title: 'Admin Daily Digest',
    previewText: 'Your last 24 hours at a glance',
    body: shell(`
      <h1 style="font-size:20px;color:#111827;margin:0 0 16px;">Daily summary</h1>
      <p style="margin:0 0 20px;">Here's what happened in the last 24 hours:</p>
      <div style="margin:0 0 20px;">##BODY##</div>`),
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

/* ------------------------------------------------------------------ *
 * Per-form (waitlist) templates
 *
 * Seeded per signup form by `onWaitlistsCreate`, not globally: each form owns
 * its double-opt-in (OTP) and welcome email so admins can give every form its
 * own content and layout (audience-unification spec U-D5). The bodies live here
 * so the functions side has ONE default-template source.
 * ------------------------------------------------------------------ */

export const WAITLIST_TEMPLATE_TYPES = ['waitlist_welcome_email', 'waitlist_verify_otp_email'] as const;
export type WaitlistTemplateType = (typeof WAITLIST_TEMPLATE_TYPES)[number];

/**
 * Canonical per-form template doc id.
 *
 * `${formId}_${type}` — the scheme the admin templates page already writes.
 * Before U1 the create trigger used `${type}_${formId}`, so the same logical
 * template could exist twice; `normalizeWaitlistTemplateIds` merges those onto
 * this id.
 */
export function waitlistTemplateDocId(formId: string, type: string): string {
  return `${formId}_${type}`;
}

export interface WaitlistTemplateDef {
  type: WaitlistTemplateType;
  category: EmailCategory;
  subject: string;
  title: string;
  previewText: string;
  body: string;
}

/** Default per-form template set. Built per call so the footer year is current. */
export function buildWaitlistTemplateDefs(): WaitlistTemplateDef[] {
  const currentYear = new Date().getFullYear();

  return [
    {
      type: 'waitlist_welcome_email',
      category: 'marketing',
      subject: 'Waitlist welcome email',
      title: 'Waitlist welcome email',
      previewText: '',
      body: `<div class="container" style="width: 100%; max-width: 600px; margin: 0 auto; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.05);">
  <div class="header" style="background-color: #2c3e50; color: #ffffff; text-align: center; padding: 40px 20px;">
    <h1 style="margin: 0; font-size: 28px; font-weight: 700;">
      You're on the ##WAITLIST## Waitlist!
    </h1>
  </div>
  <div class="content" style="padding: 40px; text-align: center; color: #34495e; line-height: 1.6;">
    <p style="margin: 0 0 20px; font-size: 16px;">
      Hello,
    </p>
    <p style="margin: 0 0 20px; font-size: 16px;">
      Thank you for joining our waitlist! We're excited to have you. You can check your progress and see your rank on the leaderboard by clicking the links below.
    </p>
    <a href=##REFERRAL_LINK## style="display: inline-block; text-decoration: none; color: #ffffff; font-weight: 600; font-size: 16px; padding: 12px 24px; border-radius: 8px; margin: 10px; background-color: #3498db;">
      Your Referral Link
    </a>
    <a href=##LEADERBOARD_LINK## style="display: inline-block; text-decoration: none; color: #ffffff; font-weight: 600; font-size: 16px; padding: 12px 24px; border-radius: 8px; margin: 10px; background-color: #3498db;">
      Waitlist Leaderboard
    </a>
    <p style="margin: 0 0 20px; font-size: 16px; margin-top: 32px;">
      We'll notify you as soon as your spot is ready.
    </p>
    <p style="margin: 0 0 20px; font-size: 16px;">
      Best regards,
      <br>
      The Team
    </p>
<br>
---
<br>
<span style="font-size: 10px; color: #777777;">
  You are receiving this email because you signed up.
  <br>
  If you no longer wish to receive these emails, please
  <a href="##UNSUBSCRIBE_LINK##" style="color: #777777;">
    unsubscribe here
  </a>
  .
</span>
  </div>
  <div class="footer" style="text-align: center; padding: 20px; font-size: 12px; color: #9baec8; border-top: 1px solid #e2e8f0;">
    <p style="margin: 0; font-size: 12px; color: #9baec8;">
      © ${currentYear}. All rights reserved.
    </p>
  </div>
</div>
`,
    },
    {
      type: 'waitlist_verify_otp_email',
      category: 'transactional',
      subject: 'Verify Your Email to Join the Waitlist',
      title: 'Waitlist verify OTP Email',
      previewText: '',
      body: `<div class="container" style="max-width: 600px; margin: 20px auto; background-color: #ffffff; border-radius: 12px; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1); overflow: hidden; padding: 40px; box-sizing: border-box;">
  <div class="header" style="text-align: center; padding-bottom: 20px; border-bottom: 1px solid #e5e7eb;">
    <h1 style="font-size: 24px; font-weight: 600; color: #1f2937; margin: 0;">
      Verification Code
    </h1>
  </div>
  <div class="content" style="padding: 30px 0; text-align: center;">
    <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 20px;">
      Hello,
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 20px;">
      You have requested to join our waitlist. Please use the following One-Time Password (OTP) to verify your email address. This code is valid for 15 minutes.
    </p>
    <div class="otp-code" style="display: inline-block; background-color: #e0f2fe; color: #0369a1; font-size: 32px; font-weight: 600; letter-spacing: 4px; padding: 15px 30px; border-radius: 8px; margin-bottom: 20px; border: 2px dashed #93c5fd;">##OTP##

    </div>
    <p class="otp-note" style="font-size: 14px; color: #6b7280; margin-bottom: 30px;">
      If you did not request this, please ignore this email.
    </p>
    <p style="font-size: 16px; line-height: 1.6; color: #4b5563; margin: 0 0 20px;">
      Thank you!</p>
  </div>
  <div class="footer" style="text-align: center; padding-top: 20px; border-top: 1px solid #e5e7eb;">
    <p style="font-size: 12px; color: #9ca3af; margin: 0;">
      © ${currentYear} Arc CMS. All rights reserved.</p>
  </div>
</div>
`,
    },
  ];
}

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
