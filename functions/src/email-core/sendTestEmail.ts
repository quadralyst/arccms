import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import type { EmailSettings } from '../types.js';
import { queueEmail } from './queueEmail.js';

/**
 * Admin callable: send a test email of composed content (Phase 4 "Send test").
 *
 * Routes through queueEmail with source `test` (no feature gate) and category
 * `transactional` (bypasses consent) so admins can preview real delivery. Still
 * respects the master kill-switch and hard-bounce suppression.
 */
export const sendTestEmail = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const toEmail = String(request.data?.toEmail || '').trim().toLowerCase();
  const subject = String(request.data?.subject || 'Test email');
  const html = String(request.data?.html || '');
  if (!toEmail.includes('@')) throw new HttpsError('invalid-argument', 'A valid recipient email is required.');
  if (!html) throw new HttpsError('invalid-argument', 'Nothing to send.');

  let settings: EmailSettings | undefined;
  try {
    settings = (await db.collection('Settings').doc('email').get()).data() as EmailSettings | undefined;
  } catch {
    /* queueEmail will re-read / gate */
  }

  const result = await queueEmail({
    source: 'test',
    category: 'transactional',
    toEmail,
    senderEmail: settings?.senderEmail || '',
    senderName: settings?.senderName || 'Arc CMS',
    subject: `[TEST] ${subject}`,
    template: html,
    type: 'test',
    emailSettings: settings,
  });

  logger.info(`sendTestEmail: queued test to ${toEmail} (status=${result.status}).`);
  return { status: result.status };
});
