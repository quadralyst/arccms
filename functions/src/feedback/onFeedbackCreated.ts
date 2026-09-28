/**
 * Feedback from the feedback button (docs/feedback.md).
 *
 * The browser writes `Feedback/{id}` itself (the rules check it is the sender's
 * own, and new). This trigger then:
 *   - adds `sender` (name, email, phone) from the sender's record, so the inbox
 *     shows who sent it without trusting what the browser said,
 *   - tells the admins, with a bell notification, for up to
 *     FEEDBACK_ALERTS_PER_HOUR items an hour from one sender (review F): past
 *     that the feedback is still saved, but a script sending thousands of items
 *     cannot flood every admin's bell and inbox.
 */
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { arcDocument } from '../arc-config.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';
import { consumeRateLimit } from '../auth/accounts.js';

export const FEEDBACK = 'Feedback';
export const FEEDBACK_ALERTS_PER_HOUR = 10;

/** The notification's one line: the start of the message, or that it is a voice note. */
export function feedbackSummary(who: string, message: unknown, hasVoice: boolean): string {
    const text = typeof message === 'string' ? message.trim().replace(/\s+/g, ' ') : '';
    const excerpt = text.length > 80 ? `${text.slice(0, 80)}...` : text;
    if (excerpt) return `${who}: ${excerpt}`;
    return hasVoice ? `${who} sent a voice note.` : `${who} sent feedback.`;
}

export const onFeedbackCreated = onDocumentCreated(arcDocument(`${FEEDBACK}/{id}`), async (event) => {
    const snap = event.data;
    const data = snap?.data();
    if (!snap || !data) return;

    const userDocId = typeof data['userDocId'] === 'string' ? data['userDocId'] : '';
    const record = userDocId ? (await db.collection('users').doc(userDocId).get()).data() : undefined;
    const sender = {
        name: typeof record?.['name'] === 'string' ? record['name'] : '',
        email: typeof record?.['email'] === 'string' ? record['email'] : '',
        phone: typeof record?.['phone'] === 'string' ? record['phone'] : '',
    };
    await snap.ref.set({ sender }, { merge: true });

    try {
        await consumeRateLimit(`feedback-alerts-${userDocId || 'unknown'}`, FEEDBACK_ALERTS_PER_HOUR, 60 * 60 * 1000, 'Too many');
    } catch {
        console.warn(`onFeedbackCreated: ${userDocId} sent more than ${FEEDBACK_ALERTS_PER_HOUR} items this hour; saved ${snap.id} without telling the admins.`);
        return;
    }

    const who = sender.name || sender.email || sender.phone || 'Someone';
    await notifyAdmins('admin_new_feedback', {
        title: 'New feedback',
        body: feedbackSummary(who, data['message'], typeof data['voicePath'] === 'string'),
        link: '/admin/feedback',
    });
});
