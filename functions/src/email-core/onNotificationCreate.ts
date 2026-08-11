import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import type { EmailSettings, EmailTemplateData } from '../types.js';
import { getNotificationTypeConfig } from './notifications.js';
import { computeEmailHash } from './unsubscribeToken.js';
import { ensureDefaultTemplates } from './defaultTemplates.js';
import { queueEmail } from './queueEmail.js';

const GENERIC_TEMPLATE_TYPE = 'notification_generic_email';

/**
 * Decide whether a newly-created notification is also delivered by email, and
 * record the outcome (spec §Phase-5.1).
 *
 * Email is sent only when ALL hold: the type's email channel is on, the user's
 * per-type preference allows it (when configurable), the notificationEmails
 * feature is on, and the master switch is on (enforced by queueEmail). Every
 * "no" is recorded in `emailDelivery.skippedReason` — never silent.
 */
export const onNotificationCreate = onDocumentCreated('Notifications/{id}', async (event) => {
  const notif = event.data?.data();
  const id = event.params.id;
  if (!notif?.['userId'] || !notif?.['type']) return;

  const ref = db.collection('Notifications').doc(id);
  const type: string = notif['type'];

  const record = (requested: boolean, extra: Record<string, unknown> = {}) =>
    ref.update({ emailDelivery: { requested, ...extra } });

  try {
    // Per-notification override (e.g. an announcement sent with email off).
    if (notif['suppressEmail'] === true) return record(false, { skippedReason: 'suppressed_by_sender' });

    const config = await getNotificationTypeConfig(type);
    // Unknown type: keep the in-app notification, but don't surprise-email.
    if (!config) return record(false, { skippedReason: 'unknown_type' });

    // 1. Type-level email channel.
    if (!config.defaultChannels?.email) return record(false, { skippedReason: 'type_channel_off' });

    // 2. Resolve the recipient user + email.
    const userSnap = await db.collection('users').where('uid', '==', notif['userId']).limit(1).get();
    const email: string | undefined = userSnap.empty ? undefined : userSnap.docs[0].data()['email'];
    if (!email) return record(false, { skippedReason: 'no_email' });

    // 3. Per-user preference (only when the type is user-configurable).
    if (config.userConfigurable) {
      const contact = await db.collection('Contacts').doc(computeEmailHash(email)).get();
      const prefs = contact.data()?.['notificationPrefs'] as Record<string, { email?: boolean }> | undefined;
      if (prefs?.[type]?.email === false) return record(false, { skippedReason: 'user_pref_off' });
    }

    // 4. Feature toggle.
    const settings = (await db.collection('Settings').doc('email').get()).data() as EmailSettings | undefined;
    if (settings?.features?.notificationEmails === false) {
      return record(false, { skippedReason: 'feature_disabled' });
    }

    // 5. Resolve the template (seed defaults if needed).
    const templateType = config.emailTemplateType || GENERIC_TEMPLATE_TYPE;
    let template = await loadTemplate(templateType);
    if (!template && templateType === GENERIC_TEMPLATE_TYPE) {
      await ensureDefaultTemplates();
      template = await loadTemplate(templateType);
    }
    if (!template) return record(false, { skippedReason: 'no_template' });

    // 6. Queue — queueEmail enforces the master switch + suppression. A blocked
    //    send (e.g. master off) comes back non-pending; record why.
    const result = await queueEmail({
      source: 'notification',
      category: config.category,
      toEmail: email,
      senderEmail: template.senderEmail,
      senderName: template.senderName,
      subject: template.subject,
      template: template.template,
      text: template.previewText || '',
      type: templateType,
      templateIsActive: template.isActive !== false,
      isSubscribed: true, // marketing consent still checked against Contacts inside queueEmail
      emailSettings: settings,
      data: { title: notif['title'], body: notif['body'], link: notif['link'] || '' },
    });

    if (result.status === 'pending') {
      return record(true, { emailLogId: result.id });
    }
    return record(true, { emailLogId: result.id, skippedReason: result.skipReason });
  } catch (err) {
    logger.error(`onNotificationCreate: failed for ${id}`, err);
  }
  return undefined;
});

async function loadTemplate(
  templateType: string,
): Promise<(EmailTemplateData & { isActive?: boolean }) | null> {
  const snap = await db.collection('EmailTemplate').where('type', '==', templateType).limit(1).get();
  return snap.empty ? null : (snap.docs[0].data() as EmailTemplateData & { isActive?: boolean });
}
