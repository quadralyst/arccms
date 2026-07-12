import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import type { EmailSettings, EmailTemplateData } from '../types.js';
import { queueEmail } from './queueEmail.js';
import { ensureDefaultTemplates } from './defaultTemplates.js';

/**
 * Daily admin digest (spec §Phase-5.5). Runs hourly and fires only in the
 * configured `adminDigest.hourUtc` hour (default 08:00), when enabled. Emails
 * every admin a 24h summary: new signups, succeeded payments, failed emails.
 */
export const sendAdminDigest = onSchedule({ schedule: 'every 1 hours', timeZone: 'UTC' }, async () => {
  const settings = (await db.collection('Settings').doc('email').get()).data() as EmailSettings | undefined;
  const digest = settings?.adminDigest;
  if (!digest?.enabled) return;

  const hourUtc = typeof digest.hourUtc === 'number' ? digest.hourUtc : 8;
  if (new Date().getUTCHours() !== hourUtc) return;

  const cutoff = Timestamp.fromMillis(Date.now() - 24 * 60 * 60 * 1000);

  const [signups, payments, failedEmails] = await Promise.all([
    countSince('users', 'createdAt', cutoff),
    countTransactions(cutoff),
    countFailedEmails(cutoff),
  ]);

  const summary = `<ul>
    <li><strong>${signups}</strong> new signup(s)</li>
    <li><strong>${payments}</strong> successful payment(s)</li>
    <li><strong>${failedEmails}</strong> failed email(s)</li>
  </ul>`;

  let template = await loadTemplate('admin_digest_email');
  if (!template) {
    await ensureDefaultTemplates();
    template = await loadTemplate('admin_digest_email');
  }
  if (!template) {
    logger.warn('sendAdminDigest: no admin_digest_email template');
    return;
  }

  const admins = await db.collection('users').where('role', '==', 'admin').get();
  let sent = 0;
  for (const a of admins.docs) {
    const email = a.data()['email'];
    if (!email) continue;
    await queueEmail({
      source: 'notification',
      category: 'transactional',
      toEmail: email,
      senderEmail: template.senderEmail,
      senderName: template.senderName,
      subject: template.subject,
      template: template.template,
      text: template.previewText || '',
      type: 'admin_digest_email',
      templateIsActive: template.isActive !== false,
      emailSettings: settings,
      data: { body: summary, title: 'Daily summary' },
    });
    sent++;
  }

  logger.info(`sendAdminDigest: sent to ${sent} admin(s). signups=${signups} payments=${payments} failedEmails=${failedEmails}`);
});

async function countSince(collection: string, field: string, cutoff: Timestamp): Promise<number> {
  try {
    const snap = await db.collection(collection).where(field, '>=', cutoff).get();
    return snap.size;
  } catch {
    return 0;
  }
}

async function countTransactions(cutoff: Timestamp): Promise<number> {
  try {
    const snap = await db.collection('Transactions').where('createdAt', '>=', cutoff).where('status', '==', 'succeeded').get();
    return snap.size;
  } catch {
    return 0;
  }
}

async function countFailedEmails(cutoff: Timestamp): Promise<number> {
  try {
    const snap = await db.collection('EmailLogs').where('createdAt', '>=', cutoff).where('status', '==', 'failed').get();
    return snap.size;
  } catch {
    return 0;
  }
}

async function loadTemplate(type: string): Promise<(EmailTemplateData & { isActive?: boolean }) | null> {
  const snap = await db.collection('EmailTemplate').where('type', '==', type).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as EmailTemplateData & { isActive?: boolean });
}
