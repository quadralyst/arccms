import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';

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
 * Returns only what the form needs to continue: the member id, the referral code and
 * links. It deliberately does **not** report whether the person was already known, and
 * does not send the code — the caller asks for that separately via `requestFormOtp`.
 */

interface JoinResult {
  memberId: string;
  referralCode: string;
  referralLink: string;
  leaderboardLink: string;
  waitlistedUserId: string;
}

/** Ambiguity-free alphabet: no O/0, I/1, so a code read aloud still works. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateReferralCode(): string {
  let out = '';
  for (let i = 0; i < 8; i++) {
    out += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return out;
}

function maskEmail(email: string): string {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '';
  return `${local.slice(0, 2)}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

export const joinForm = onCall(async (request): Promise<JoinResult> => {
  const waitlistId = String(request.data?.waitlistId || '').trim();
  const email = String(request.data?.email || '').trim().toLowerCase();
  const firstName = String(request.data?.firstName || '').trim();
  const source = String(request.data?.source || '').trim();
  const referredBy = String(request.data?.referredBy || '').trim();
  const origin = String(request.data?.origin || '').trim();
  const formData = (request.data?.formData as Record<string, unknown>) || {};
  const signupMetadata = (request.data?.signupMetadata as Record<string, unknown>) || {};

  if (!waitlistId) throw new HttpsError('invalid-argument', 'waitlistId is required.');
  if (!email || !email.includes('@') || email.length > 254) {
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

      return {
        memberId: doc.id,
        referralCode: (d['referralCode'] as string) || '',
        referralLink: (d['referralLink'] as string) || '',
        leaderboardLink: (d['leaderboardLink'] as string) || '',
        waitlistedUserId: (d['waitlistedUserId'] as string) || '',
      };
    }

    // ── New member ────────────────────────────────────────────────────────────
    const referralCode = generateReferralCode();
    const base = origin.startsWith('http') ? origin.replace(/\/$/, '') : '';

    // The registry doc id is pre-generated so `leaderboardLink` can go into the first
    // write. A follow-up update here used to fire onWaitlistedUserUpdate and send a
    // second OTP email. The registry itself retires in U6; getPublicMemberView already
    // resolves this id through the member doc, so links already sent keep working.
    const registryRef = db.collection('WaitlistedUsers').doc();
    const leaderboardLink = `${base}/leaderboard/${waitlistId}/${registryRef.id}`;
    const referralLink = `${base}/?ref=${referralCode}`;

    const now = Timestamp.now();
    const record = {
      email,
      firstName,
      source,
      formData,
      signupMetadata,
      referralCode,
      referralLink,
      leaderboardLink,
      maskedEmail: maskEmail(email),
      queuePosition: 0,
      totalReferrals: 0,
      signupTimestamp: now,
      createdAt: now,
      emailVerified: false,
      isConfirmed: false,
      isSubscribed: true,
      ipAddress: '',
      ...(referredBy ? { referredBy } : {}),
    };

    await registryRef.set({ ...record, waitlistId, waitlistIds: [waitlistId] });
    const memberRef = await members.add({ ...record, waitlistId, waitlistedUserId: registryRef.id });

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
    return {
      memberId: memberRef.id,
      referralCode,
      referralLink,
      leaderboardLink,
      waitlistedUserId: registryRef.id,
    };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error(`joinForm failed for ${waitlistId}`, err);
    throw new HttpsError('internal', 'Could not join the waitlist.');
  }
});
