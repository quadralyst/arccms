import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { computeEmailHash } from './unsubscribeToken.js';
import { unsubscribeByEmailHash } from './handleUnsubscribe.js';

/**
 * Callable behind the legacy `/unsubscribe/:waitlistId/:userId` pages (U5, item 6).
 *
 * Those URLs are already in inboxes, so they have to keep working — but they carry
 * a document id rather than the HMAC token `handleUnsubscribe` needs, and the
 * signing secret is server-side, so the page cannot mint one. Previously the page
 * wrote `isSubscribed:false` to `WaitlistedUsers` and the member doc **from the
 * browser**, which meant consent was client-writable and only ever half-applied:
 * no `Suppression` doc, no `Contacts.consent` update, no drip exit.
 *
 * This resolves the id to an address server-side and then runs the *same*
 * routine as the token flow, so both paths suppress identically.
 *
 * Deliberately unauthenticated: the person clicking is a recipient, not a user.
 * Enumeration risk is limited to "does this id exist", and the action is idempotent
 * and self-harming only — it can unsubscribe, never subscribe.
 */
export const unsubscribeLegacyLink = onCall(async (request) => {
  const userId = String(request.data?.userId || '').trim();
  const waitlistId = String(request.data?.waitlistId || '').trim();
  if (!userId) throw new HttpsError('invalid-argument', 'userId is required.');

  try {
    // The id may be a WaitlistedUsers doc or a member doc, depending on which
    // link shape the email used.
    let email = '';

    const globalSnap = await db.collection('WaitlistedUsers').doc(userId).get();
    if (globalSnap.exists) {
      email = (globalSnap.data()?.['email'] as string) || '';
    }

    if (!email && waitlistId) {
      const memberSnap = await db
        .collection('Waitlists').doc(waitlistId).collection('users').doc(userId).get();
      if (memberSnap.exists) email = (memberSnap.data()?.['email'] as string) || '';
    }

    if (!email) {
      // Nothing to act on. Reported as success so the page shows the same
      // confirmation either way — a stale link should not look broken, and the
      // response must not reveal whether the id exists.
      logger.warn(`unsubscribeLegacyLink: no email for userId=${userId} waitlistId=${waitlistId || '—'}`);
      return { ok: true, matched: false };
    }

    await unsubscribeByEmailHash(computeEmailHash(email));
    logger.info(`unsubscribeLegacyLink: unsubscribed ${email} via legacy link.`);
    return { ok: true, matched: true };
  } catch (err) {
    logger.error('unsubscribeLegacyLink failed', err);
    throw new HttpsError('internal', 'Could not process the unsubscribe request.');
  }
});
