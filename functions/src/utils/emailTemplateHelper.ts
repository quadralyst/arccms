import { db } from '../init.js';
// constant import removed
import { EmailTemplateData, WaitlistUserData } from '../types.js';
import { queueEmail } from '../email-core/queueEmail.js';
import { ensureWaitlistTemplates, waitlistDisplayName } from '../email-core/defaultTemplates.js';

/**
 * Fetches an email template, preferring the waitlist-specific one over the global config.
 */
export async function getEmailTemplate(
  waitlistId: string,
  templateType: 'waitlist_verify_otp_email' | 'waitlist_welcome_email',
  options: { ensure?: boolean } = {},
): Promise<EmailTemplateData> {
  const lookupForm = async () => {
    const snap = await db
      .collection('EmailTemplate')
      .where('waitlistId', '==', waitlistId)
      .where('type', '==', templateType)
      .limit(1)
      .get();
    return snap.empty ? null : (snap.docs[0].data() as EmailTemplateData);
  };

  // 1. The form's own template.
  const own = await lookupForm();
  if (own) return own;

  // 2. Missing — create this form's defaults and look again. Unconditional by
  //    design: a deleted template is indistinguishable from a never-seeded one,
  //    and `isActive: false` is the documented off switch. Opt-out via
  //    `ensure: false` for callers that only want to *read* current state.
  if (options.ensure !== false) {
    await ensureWaitlistTemplates(waitlistId);
    const seeded = await lookupForm();
    if (seeded) return seeded;
  }

  // 3. Last resort: a genuinely global template.
  //
  //    This step used to be `where('type','==',templateType).limit(1)` with no
  //    scope filter. Per-form docs carry the same `type`, so a form with no
  //    template of its own silently borrowed whichever form sorted first by doc
  //    id — serving Form A's customised content, and Form A's branding, to Form
  //    B's subscribers. Restricting to `scope == 'global'` cannot match a
  //    per-form doc (they are written with `scope: 'form'`, and older ones have
  //    no `scope` field at all, which never matches an equality filter).
  const globalSnap = await db
    .collection('EmailTemplate')
    .where('type', '==', templateType)
    .where('scope', '==', 'global')
    .limit(1)
    .get();

  if (!globalSnap.empty) {
    return globalSnap.docs[0].data() as EmailTemplateData;
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
      // Never blank: the default subject is `Welcome to ##WAITLIST##`, and an
      // unmapped tag resolves to '' — which would send "Welcome to ".
      waitlistName: waitlistDisplayName(waitlistName),
      referralLink: userData.referralLink || '',
      leaderboardLink: userData.leaderboardLink || '',
      position: userData.queuePosition,
    },
  });
}
