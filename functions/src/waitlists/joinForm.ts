import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { db } from '../init.js';
import { isBlank } from '../shared/blank.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { callerKey, consumeRateLimits } from '../auth/accounts.js';
import {
  HOUR, readEmail, readFormData, readFormId, readShortText, requireActiveForm, trimSignupMetadata,
} from './formInput.js';
import { issueFormTicket } from './formTicket.js';

/**
 * Server-authoritative "join this form": find-or-create the member record.
 *
 * This exists so the browser no longer needs to read member documents. The client used
 * to query `where('email','==',…)` on `Waitlists/{id}/users` to avoid creating a
 * duplicate, and that query is why `firestore.rules` had to allow public reads on a
 * collection holding raw email addresses. No rule can permit that query without also
 * permitting "list everyone" (rules cannot scope a query to the caller's own address
 * without auth), so the read had to move here.
 *
 * **Find-or-create rather than a lookup, deliberately.** A `doesThisEmailExist`
 * endpoint would be an email-enumeration oracle: anyone could test addresses against
 * the list. Here the response is the same shape whether the member already existed or
 * was just created, so a caller learns nothing by probing.
 *
 * It also makes deduplication atomic. The client-side check was a read-then-write
 * race: two submits of the same address could both see "not found" and both create.
 *
 * Returns only what the form needs to continue: a sealed, short-lived ticket
 * (formTicket.ts), never the member id. Anyone can type someone else's address
 * here, so the reply must not name that member. The ticket is what the later steps
 * take. It does not report whether the person was already known, and does not send
 * the code: the caller asks for that separately via `requestFormOtp`.
 *
 * Public, so it is limited per caller and per address, the form must be open, and
 * what is stored is capped (formInput.ts). A filled hidden field (HONEYPOT_FIELD, the
 * same trap the contact form has) gets a ticket like any join, and nothing is stored.
 *
 * Signup forms are plain (specs/form-gamification-spec.md): no referral code, links,
 * queue position or masked address is written. Members from before keep theirs, unread.
 */

interface JoinResult {
  ticket: string;
}

/**
 * Joins per caller IP an hour, and per address an hour. The IP limit allows for
 * many people signing up from one office or school network.
 */
const JOIN_LIMIT_PER_IP = 60;
const JOIN_LIMIT_PER_ADDRESS = 10;

/**
 * The hidden field published sign-up forms carry (arc-site.js adds it): people never
 * see or fill it, a bot filling every input does.
 */
export const HONEYPOT_FIELD = 'arc_website';

/** Whether a bot sent it: the hidden field has something in it. */
export function filledHoneypot(data: unknown): boolean {
  const value = data && typeof data === 'object' ? (data as Record<string, unknown>)[HONEYPOT_FIELD] : undefined;
  return typeof value === 'string' && value.trim() !== '';
}

export const joinForm = onCall(async (request): Promise<JoinResult> => {
  const waitlistId = readFormId(request.data?.waitlistId);
  const email = readEmail(request.data?.email);
  // A bot is answered as a person is, with a ticket, but nothing is stored or counted:
  // the ticket names a member that does not exist, so the later steps go nowhere.
  if (filledHoneypot(request.data)) {
    logger.info(`joinForm: dropped a bot signup on ${waitlistId} (hidden field filled).`);
    return { ticket: await issueFormTicket(waitlistId, randomBytes(15).toString('base64url')) };
  }
  const firstName = readShortText(request.data?.firstName, 'Please use a shorter name.');
  const source = readShortText(request.data?.source, 'This form sent too much. Please shorten your answers and try again.');
  const formData = readFormData(request.data?.formData);
  const signupMetadata = trimSignupMetadata(request.data?.signupMetadata);

  await consumeRateLimits([
    { key: `form-join-ip-${callerKey(request)}`, max: JOIN_LIMIT_PER_IP, windowMs: HOUR, message: 'Too many attempts. Please try again later.' },
    { key: `form-join-${computeEmailHash(email)}`, max: JOIN_LIMIT_PER_ADDRESS, windowMs: HOUR, message: 'Too many attempts for this address. Please try again later.' },
  ]);

  const formSnap = await requireActiveForm(waitlistId);
  const members = db.collection('Waitlists').doc(waitlistId).collection('users');
  // readEmail refuses an empty address already; kept here so a lookup never runs on ''
  // (members without an email store '', and '' must match nobody).
  if (isBlank(email)) throw new HttpsError('invalid-argument', 'A valid email is required.');

  try {
    // ── Already a member of this form? ────────────────────────────────────────
    const existing = await members.where('email', '==', email).limit(1).get();
    if (!existing.empty) {
      const doc = existing.docs[0];
      const d = doc.data();

      // Refresh the name only while they are still unconfirmed: once confirmed, the
      // name they verified with wins over whatever a later form fill says.
      if (d['isConfirmed'] !== true && firstName && d['firstName'] !== firstName) {
        await doc.ref.update({ firstName });
      }

      return { ticket: await issueFormTicket(waitlistId, doc.id) };
    }

    // ── New member ────────────────────────────────────────────────────────────
    // U6: no `WaitlistedUsers` record is created; the member doc is the record.
    const memberRef = members.doc();
    const now = Timestamp.now();
    await memberRef.set({
      email,
      firstName,
      source,
      formData,
      signupMetadata,
      signupTimestamp: now,
      createdAt: now,
      emailVerified: false,
      isConfirmed: false,
      isSubscribed: true,
      ipAddress: '',
      waitlistId,
    });

    // The form's default tag, applied here rather than by the client: `tags` is not a
    // field an unauthenticated caller should be able to choose.
    const defaultTagId = formSnap.data()?.['defaultTagId'] as string | undefined;
    if (defaultTagId) {
      try {
        await memberRef.update({ tags: [defaultTagId] });
      } catch (err) {
        logger.warn(`joinForm: could not apply the default tag on ${waitlistId}`, err);
      }
    }

    logger.info(`joinForm: created member ${memberRef.id} on ${waitlistId}.`);
    return { ticket: await issueFormTicket(waitlistId, memberRef.id) };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error(`joinForm failed for ${waitlistId}`, err);
    throw new HttpsError('internal', 'Could not join the waitlist.');
  }
});
