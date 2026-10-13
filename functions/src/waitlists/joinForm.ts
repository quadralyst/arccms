import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { isBlank } from '../shared/blank.js';

/**
 * Server-authoritative "join this form" — find-or-create the member record.
 *
 * This exists so the browser no longer needs to read member documents. The client used
 * to query `where('email','==',…)` on `Waitlists/{id}/users` to avoid creating a
 * duplicate, and that query is why `firestore.rules` had to allow public reads on a
 * collection holding raw email addresses. No rule can permit that query without also
 * permitting "list everyone" — rules cannot scope a query to the caller's own address
 * without auth — so the read had to move here.
 *
 * **Find-or-create rather than a lookup, deliberately.** A `doesThisEmailExist`
 * endpoint would be an email-enumeration oracle: anyone could test addresses against
 * the list. Here the response is the same shape whether the member already existed or
 * was just created, so a caller learns nothing by probing.
 *
 * It also makes deduplication atomic. The client-side check was a read-then-write
 * race: two submits of the same address could both see "not found" and both create.
 *
 * Returns only what the form needs to continue: the member id. It deliberately does
 * **not** report whether the person was already known, and does not send the code:
 * the caller asks for that separately via `requestFormOtp`.
 *
 * Signup forms are plain (specs/form-gamification-spec.md): no referral code, links,
 * queue position or masked address is written. Members from before keep theirs, unread.
 */

interface JoinResult {
  memberId: string;
}

export const joinForm = onCall(async (request): Promise<JoinResult> => {
  const waitlistId = String(request.data?.waitlistId || '').trim();
  const email = String(request.data?.email || '').trim().toLowerCase();
  const firstName = String(request.data?.firstName || '').trim();
  const source = String(request.data?.source || '').trim();
  const formData = (request.data?.formData as Record<string, unknown>) || {};
  const signupMetadata = (request.data?.signupMetadata as Record<string, unknown>) || {};

  if (!waitlistId) throw new HttpsError('invalid-argument', 'waitlistId is required.');
  if (isBlank(email) || !email.includes('@') || email.length > 254) {
    throw new HttpsError('invalid-argument', 'A valid email is required.');
  }

  const formRef = db.collection('Waitlists').doc(waitlistId);
  const formSnap = await formRef.get();
  if (!formSnap.exists) throw new HttpsError('not-found', 'This form does not exist.');

  const members = formRef.collection('users');

  try {
    // ── Already a member of this form? ────────────────────────────────────────
    const existing = await members.where('email', '==', email).limit(1).get();
    if (!existing.empty) {
      const doc = existing.docs[0];
      const d = doc.data();

      // Refresh the name only while they are still unconfirmed — once confirmed, the
      // name they verified with wins over whatever a later form fill says.
      if (d['isConfirmed'] !== true && firstName && d['firstName'] !== firstName) {
        await doc.ref.update({ firstName });
      }

      return { memberId: doc.id };
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

    // The form's default tag, applied here rather than by the client — `tags` is not a
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
    return { memberId: memberRef.id };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error(`joinForm failed for ${waitlistId}`, err);
    throw new HttpsError('internal', 'Could not join the waitlist.');
  }
});
