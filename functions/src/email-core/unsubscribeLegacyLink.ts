import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { computeEmailHash } from './unsubscribeToken.js';
import { queueEmail } from './queueEmail.js';
import { readEmailBrand, wrapInEmailLayout } from './emailLayout.js';
import { callerKey, consumeRateLimits } from '../auth/accounts.js';

/**
 * Callable behind the legacy `/unsubscribe/:waitlistId/:userId` pages.
 *
 * No email has carried those links since 2026-07-26, but older emails still do.
 * They hold a document id, not the signed token `handleUnsubscribe` needs, and an
 * id proves nothing: anyone who learned one could unsubscribe someone else. So the
 * page asks for the address, and this callable emails that address the signed
 * one-click link (##UNSUBSCRIBE_LINK##, the same one every email footer carries).
 * The person unsubscribes by clicking it, through the same routine as any other
 * unsubscribe. Nothing is ever unsubscribed from an id here.
 *
 * The link goes only to an address this site has emailed or keeps as a contact, or
 * that the old link's member record holds, and not to one already suppressed. The
 * answer is the same whatever happened, so it reveals nothing about the list, and
 * so is the time it takes: every request makes the same reads, and none answers
 * sooner than MIN_REPLY_MS after it came in, so a send cannot be told from no send.
 * Limited per caller and per address, so it cannot be used to flood an inbox.
 *
 * The email goes as an account email (source `auth`), not a form email: it is the
 * person's way out, so turning the forms' emails off must not hold it back.
 */

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
/** Requests per caller IP an hour, and per address a day. */
const LIMIT_PER_IP = 10;
const LIMIT_PER_ADDRESS = 3;
/** No answer sooner than this after the request: longer than queueing the email takes. */
export const MIN_REPLY_MS = 2000;
/** The floor in use; tests lower it. */
export const replyTiming = { minMs: MIN_REPLY_MS };

function optionalId(value: unknown): string {
  const id = typeof value === 'string' ? value.trim() : '';
  return id && id.length <= 200 && !id.includes('/') && id !== '.' && id !== '..' ? id : '';
}

function waitUntil(time: number): Promise<void> {
  const left = time - Date.now();
  return left > 0 ? new Promise((resolve) => setTimeout(resolve, left)) : Promise.resolve();
}

export const unsubscribeLegacyLink = onCall(async (request) => {
  const started = Date.now();
  const raw: unknown = request.data?.email;
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
  if (!email || !email.includes('@') || email.length > 254) {
    throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  }
  const userId = optionalId(request.data?.userId);
  const waitlistId = optionalId(request.data?.waitlistId);
  const emailHash = computeEmailHash(email);

  await consumeRateLimits([
    { key: `legacy-unsub-ip-${callerKey(request)}`, max: LIMIT_PER_IP, windowMs: HOUR, message: 'Too many attempts. Please try again later.' },
    { key: `legacy-unsub-${emailHash}`, max: LIMIT_PER_ADDRESS, windowMs: DAY, message: 'Too many attempts. Please try again later.' },
  ]);

  try {
    // Every read, whatever the first ones find.
    const [known, suppressed] = await Promise.all([
      knownRecipient(email, emailHash, userId, waitlistId),
      alreadySuppressed(emailHash),
    ]);
    if (known && !suppressed) {
      await sendUnsubscribeLink(email);
      logger.info('unsubscribeLegacyLink: sent a one-click unsubscribe link.');
    }
  } catch (err) {
    // Logged, never told: the answer must not differ.
    logger.error('unsubscribeLegacyLink: could not send the link', err);
  }
  await waitUntil(started + replyTiming.minMs);
  return { ok: true };
});

type Snap = { exists: boolean; data: () => Record<string, unknown> | undefined } | null;

/** This site has emailed the address, keeps it as a contact, or the old link's record holds it. */
async function knownRecipient(email: string, emailHash: string, userId: string, waitlistId: string): Promise<boolean> {
  // All at once, so a known address takes no fewer reads than an unknown one.
  const [logs, contact, registry, member] = await Promise.all([
    db.collection('EmailLogs').where('emailHash', '==', emailHash).limit(1).get(),
    db.collection('Contacts').doc(emailHash).get(),
    userId ? db.collection('WaitlistedUsers').doc(userId).get() as Promise<Snap> : Promise.resolve(null),
    userId && waitlistId ? db.collection('Waitlists').doc(waitlistId).collection('users').doc(userId).get() as Promise<Snap> : Promise.resolve(null),
  ]);
  const holds = (snap: Snap) => !!snap?.exists && String(snap.data()?.['email'] ?? '').trim().toLowerCase() === email;
  return !logs.empty || contact.exists || holds(registry) || holds(member);
}

/** Already unsubscribed, bounced or complained: nothing to send. */
async function alreadySuppressed(emailHash: string): Promise<boolean> {
  return (await db.collection('Suppression').doc(emailHash).get()).exists;
}

async function sendUnsubscribeLink(email: string): Promise<void> {
  const inner = [
    '<h2 style="margin:0 0 16px;font-size:20px;">Unsubscribe</h2>',
    '<p>Someone asked to stop emails to this address. If it was you, use this link. One click is all it takes.</p>',
    '<p style="margin:24px 0;"><a href="##UNSUBSCRIBE_LINK##" style="font-weight:600;">Unsubscribe</a></p>',
    '<p>If it was not you, ignore this email. Nothing changes.</p>',
  ].join('\n');
  await queueEmail({
    // For a link in an old form email. An account email, so switching the forms' emails
    // off does not hold it back, and transactional, so marketing consent does not either.
    source: 'auth',
    category: 'transactional',
    toEmail: email,
    // Filled from Settings, Email when it is sent.
    senderEmail: '',
    senderName: '',
    subject: 'Your unsubscribe link',
    template: wrapInEmailLayout(inner, await readEmailBrand()),
    text: 'Use the link in this email to stop emails to this address.',
    type: 'unsubscribe_link_email',
  });
}
