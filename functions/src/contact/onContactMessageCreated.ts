/**
 * Tells the admins about a new contact form message (specs/site-sections-spec.md,
 * SS5): a bell notification and, by the type's default, an email, linking to the
 * Messages inbox. Possible spam raises nothing, and past CONTACT_ALERTS_PER_HOUR
 * alerts an hour messages are still saved without one, so a flood cannot flood
 * every admin's inbox too.
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { arcDocument } from '../arc-config.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';
import { consumeRateLimit } from '../auth/accounts.js';
import { CONTACT_MESSAGES } from './submitContactMessage.js';

export const CONTACT_ALERTS_PER_HOUR = 10;

/** The notification's one line: who wrote, and the start of what they asked. */
export function contactSummary(data: Record<string, unknown>): string {
    const str = (value: unknown) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '');
    const who = str(data['name']) || str(data['email']) || 'Someone';
    const text = str(data['subject']) || str(data['message']);
    const excerpt = text.length > 80 ? `${text.slice(0, 80)}...` : text;
    return excerpt ? `${who}: ${excerpt}` : `${who} sent a message.`;
}

export const onContactMessageCreated = onDocumentCreated(arcDocument(`${CONTACT_MESSAGES}/{id}`), async (event) => {
    const data = event.data?.data();
    if (!data || data['status'] === 'spam') return;

    try {
        await consumeRateLimit('contact-alerts', CONTACT_ALERTS_PER_HOUR, 60 * 60 * 1000, 'Too many');
    } catch {
        console.warn(`onContactMessageCreated: more than ${CONTACT_ALERTS_PER_HOUR} messages this hour; saved ${event.data?.id} without telling the admins.`);
        return;
    }

    await notifyAdmins('admin_contact_message', {
        title: 'New message',
        body: contactSummary(data),
        link: '/admin/messages',
    });
});
