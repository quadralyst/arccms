/**
 * A message from a contact form on the site (specs/site-sections-spec.md, SS5):
 * <form data-arc-contact-form>, sent by arc-site.js. Anyone may call it, so it
 * guards itself: a hidden honeypot input and a minimum time on the page quietly
 * drop what a bot sends (the bot is told it worked), five messages an hour per
 * sender address and per email, and caps on every field. A message with many
 * links is kept but marked spam, so it raises no alert.
 *
 * Arc CMS sends nothing to the sender: a stranger cannot make the site email an
 * address they typed. Admins reply from their own email client.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { db } from '../init.js';
import { callerKey, consumeRateLimit } from '../auth/accounts.js';

export const CONTACT_MESSAGES = 'ContactMessages';

/** The fields a form may send, and the most each may hold. */
export const CONTACT_FIELDS = { name: 100, email: 254, phone: 40, subject: 200, message: 5000 } as const;
type ContactField = keyof typeof CONTACT_FIELDS;

/** Below this many milliseconds between the page loading and the form being sent, it was not a person. */
export const MIN_FILL_MS = 3000;
export const MESSAGES_PER_HOUR = 5;
/** More links than this and the message is kept as Possible spam. */
export const MAX_LINKS = 3;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HOUR = 60 * 60 * 1000;

export type ContactStatus = 'new' | 'done' | 'spam';

export interface ContactMessage {
    name: string;
    email: string;
    phone: string;
    subject: string;
    message: string;
    page: string;
    lang: string;
    status: ContactStatus;
}

const text = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** How many web addresses a text holds. */
export function countLinks(value: string): number {
    return (value.match(/https?:\/\/|www\./gi) || []).length;
}

/**
 * The message as it is stored, or the reason it cannot be. Pure, for the tests.
 * `page` keeps only a path on this site.
 */
export function readContactMessage(data: Record<string, unknown>): ContactMessage {
    const fields = {} as Record<ContactField, string>;
    for (const [key, max] of Object.entries(CONTACT_FIELDS) as [ContactField, number][]) {
        const value = text(data[key]);
        if (value.length > max) throw new HttpsError('invalid-argument', `The ${key} is too long.`, { field: key });
        fields[key] = value;
    }
    fields.email = fields.email.toLowerCase();
    if (!EMAIL.test(fields.email)) throw new HttpsError('invalid-argument', 'Please enter a valid email address.', { field: 'email' });
    if (!fields.message) throw new HttpsError('invalid-argument', 'Please write a message.', { field: 'message' });

    const path = text(data['page']).slice(0, 500);
    const page = path.startsWith('/') && !path.startsWith('//') ? path : '';
    const lang = /^[a-z]{2,3}(-[A-Za-z]{2,4})?$/.test(text(data['lang'])) ? text(data['lang']) : '';
    const links = countLinks(`${fields.subject} ${fields.message}`);
    return { ...fields, page, lang, status: links > MAX_LINKS ? 'spam' : 'new' };
}

/** Whether a bot sent it: the hidden field was filled, or the form was sent too soon after the page loaded. */
export function looksAutomated(data: Record<string, unknown>): boolean {
    if (text(data['website'])) return true;
    const elapsed = Number(data['elapsedMs']);
    return Number.isFinite(elapsed) && elapsed < MIN_FILL_MS;
}

export const submitContactMessage = onCall(async (request): Promise<{ ok: true }> => {
    const data = (request.data && typeof request.data === 'object' ? request.data : {}) as Record<string, unknown>;
    if (looksAutomated(data)) return { ok: true };

    const message = readContactMessage(data);
    const tooMany = 'Too many messages. Please try again later.';
    await consumeRateLimit(`contact-ip-${callerKey(request)}`, MESSAGES_PER_HOUR, HOUR, tooMany);
    const emailKey = createHash('sha256').update(message.email).digest('hex').slice(0, 32);
    await consumeRateLimit(`contact-email-${emailKey}`, MESSAGES_PER_HOUR, HOUR, tooMany);

    await db.collection(CONTACT_MESSAGES).add({ ...message, createdAt: Timestamp.now() });
    return { ok: true };
});
