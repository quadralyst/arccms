import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';
import { HttpsError } from 'firebase-functions/v2/https';
import type { DocumentReference, DocumentData } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { getUnsubscribeSecret } from '../email-core/unsubscribeSecret.js';

/**
 * The form ticket: what `joinForm` hands the page instead of the member id, and
 * what every later form step (`requestFormOtp`, `verifyFormOtp`,
 * `finalizeFormSignup`) takes to find the member.
 *
 * `joinForm` answers for any address, an existing member's included, so a raw id
 * in its reply would let anyone who typed someone else's address name that
 * member. The ticket is sealed (AES-256-GCM): the member id inside cannot be read,
 * and the form id it was issued for and its expiry cannot be changed, because the
 * authentication tag (checked in constant time) covers all three.
 *
 * The key comes from the site's unsubscribe secret (`_system`, closed to every
 * client), keyed for this one use, so a ticket can never stand in for an
 * unsubscribe token and an unsubscribe token can never open as a ticket.
 */

/** How long a ticket works: the form's code lasts 15 minutes, so an hour is plenty. */
export const FORM_TICKET_TTL_MS = 60 * 60 * 1000;

const VERSION = 'ft1';
const PURPOSE = 'arc-form-ticket';
/** The GCM authentication tag's length, in bytes. */
const TAG_BYTES = 16;

/** The message for a ticket that is missing, damaged, for another form, or too old. */
export const TICKET_REFUSED = 'This signup has expired. Please fill in the form again.';

async function ticketKey(): Promise<Buffer> {
  const secret = await getUnsubscribeSecret();
  if (!secret) throw new HttpsError('unavailable', 'Signups are not available right now. Please try again later.');
  return createHmac('sha256', secret).update(PURPOSE).digest();
}

function aad(waitlistId: string): Buffer {
  return Buffer.from(`${PURPOSE}:${waitlistId}`, 'utf8');
}

/** A ticket for this member of this form, working for FORM_TICKET_TTL_MS from `now`. */
export async function issueFormTicket(waitlistId: string, memberId: string, now = Date.now()): Promise<string> {
  const key = await ticketKey();
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad(waitlistId));
  const body = JSON.stringify({ m: memberId, x: now + FORM_TICKET_TTL_MS });
  const text = Buffer.concat([cipher.update(body, 'utf8'), cipher.final()]);
  return [VERSION, iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), text.toString('base64url')].join('.');
}

/** The member id in `ticket`, or null when it is missing, damaged, for another form, or expired. */
export async function openFormTicket(ticket: unknown, waitlistId: string, now = Date.now()): Promise<string | null> {
  if (typeof ticket !== 'string' || ticket.length > 1000) return null;
  const [version, iv, tag, text] = ticket.split('.');
  if (version !== VERSION || !iv || !tag || !text) return null;
  try {
    // The full 16-byte tag only: a shorter one would be easier to forge.
    const authTag = Buffer.from(tag, 'base64url');
    if (authTag.length !== TAG_BYTES) return null;
    const decipher = createDecipheriv('aes-256-gcm', await ticketKey(), Buffer.from(iv, 'base64url'), { authTagLength: TAG_BYTES });
    decipher.setAAD(aad(waitlistId));
    decipher.setAuthTag(authTag);
    const body = JSON.parse(Buffer.concat([decipher.update(Buffer.from(text, 'base64url')), decipher.final()]).toString('utf8'));
    const memberId = body?.m;
    const expires = Number(body?.x);
    if (typeof memberId !== 'string' || !memberId || memberId.includes('/')) return null;
    if (!Number.isFinite(expires) || expires <= now) return null;
    return memberId;
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    return null;
  }
}

export interface TicketMember {
  id: string;
  ref: DocumentReference<DocumentData>;
  data: DocumentData;
  email: string;
}

/**
 * The member a form step acts on, from its ticket. Refused alike whether the
 * ticket is bad or the member has gone, so the answer says nothing about either.
 */
export async function memberFromTicket(waitlistId: string, ticket: unknown): Promise<TicketMember> {
  const memberId = await openFormTicket(ticket, waitlistId);
  if (!memberId) throw new HttpsError('permission-denied', TICKET_REFUSED);
  const ref = db.collection('Waitlists').doc(waitlistId).collection('users').doc(memberId);
  const snap = await ref.get();
  const data = snap.exists ? snap.data() : undefined;
  const email = String(data?.['email'] || '').trim().toLowerCase();
  if (!data || !email) throw new HttpsError('permission-denied', TICKET_REFUSED);
  return { id: memberId, ref, data, email };
}
