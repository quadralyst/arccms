import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { queueEmail } from '../email-core/queueEmail.js';
import type { EmailTemplateData } from '../types.js';

/**
 * Welcome-on-signup (D9): when a user document is created, queue a
 * `signup_welcome_email`.
 *
 * Marketing category (deactivatable via the template's `isActive` flag, and
 * gated by the authEmails feature toggle + suppression through queueEmail).
 * Separate from `onUserCreated` (which maintains `email_lookup`) so email
 * delivery and lookup-maintenance fail independently.
 */
export const onUserCreateWelcomeEmail = onDocumentCreated('users/{docId}', async (event) => {
  const user = event.data?.data();
  if (!user?.['email']) return;

  try {
    const snap = await db
      .collection('EmailTemplate')
      .where('type', '==', 'signup_welcome_email')
      .limit(1)
      .get();
    if (snap.empty) {
      console.log('onUserCreateWelcomeEmail: no signup_welcome_email template; skipping.');
      return;
    }

    const template = snap.docs[0].data() as EmailTemplateData & { isActive?: boolean };
    const email: string = user['email'];
    const toName = user['name'] || user['firstName'] || email.split('@')[0];

    await queueEmail({
      source: 'auth',
      category: 'marketing',
      toEmail: email,
      toName,
      senderEmail: template.senderEmail,
      senderName: template.senderName,
      subject: template.subject,
      template: template.template,
      text: template.previewText || '',
      type: 'signup_welcome_email',
      templateIsActive: template.isActive !== false,
      isSubscribed: user['isSubscribed'] !== false,
    });
  } catch (err) {
    console.error('onUserCreateWelcomeEmail: failed to queue welcome email:', err);
  }
});
