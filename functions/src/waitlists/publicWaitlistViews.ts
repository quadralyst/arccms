import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';

/**
 * Public, unauthenticated read models for the waitlist pages.
 *
 * These exist to close a data exposure. `firestore.rules` carried
 * `allow read: if true` on `Waitlists/{id}/users` and `WaitlistedUsers` because the
 * leaderboard and user-detail pages queried member documents straight from the
 * browser. That made every signup's **raw email address** readable by anyone holding
 * the web API key — which ships in the frontend bundle, so effectively everyone. It
 * was verified exploitable with a plain unauthenticated REST call.
 *
 * Moving those reads here lets the rules deny client reads entirely. What the browser
 * gets back is an explicit allowlist, so a field added to a member document is never
 * exposed by accident — the previous code did the reverse, returning whole documents
 * minus a denylist of three fields.
 *
 * **Access model:** these pages are reached from a link in the person's own email, so
 * the id in the URL is the capability. That is unchanged; the difference is that a
 * caller can now only fetch the one member they hold an id for, instead of paging the
 * entire collection.
 */

/** Everything the leaderboard is allowed to reveal about *other* people. */
interface LeaderboardEntry {
  id: string;
  firstName: string;
  maskedEmail: string;
  totalReferrals: number;
  queuePosition: number;
  waitlistedUserId: string;
}

function maskEmail(email: string): string {
  const [local, domain] = String(email || '').split('@');
  if (!domain) return '';
  const head = local.slice(0, 2);
  return `${head}${'*'.repeat(Math.max(local.length - 2, 1))}@${domain}`;
}

function requireWaitlistId(data: unknown): string {
  const id = String((data as { waitlistId?: unknown })?.waitlistId || '').trim();
  if (!id) throw new HttpsError('invalid-argument', 'waitlistId is required.');
  return id;
}

/**
 * Callable: the public leaderboard for one form.
 *
 * Masked emails only — never the raw address, which is what the client-side query
 * used to hand out. Ordering matches the query it replaces, and the composite index
 * it needs (`users` group: isConfirmed ASC, totalReferrals DESC, signupTimestamp ASC)
 * is already deployed.
 */
export const getPublicLeaderboard = onCall(async (request) => {
  const waitlistId = requireWaitlistId(request.data);

  try {
    const members = db.collection('Waitlists').doc(waitlistId).collection('users');

    const [top, confirmed, unconfirmed] = await Promise.all([
      members
        .where('isConfirmed', '==', true)
        .orderBy('totalReferrals', 'desc')
        .orderBy('signupTimestamp', 'asc')
        .limit(50)
        .get(),
      members.where('isConfirmed', '==', true).count().get(),
      members.where('isConfirmed', '==', false).count().get(),
    ]);

    const leaderboard: LeaderboardEntry[] = top.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        firstName: (d['firstName'] as string) || '',
        maskedEmail: (d['maskedEmail'] as string) || maskEmail(d['email'] as string),
        totalReferrals: (d['totalReferrals'] as number) || 0,
        queuePosition: (d['queuePosition'] as number) || 0,
        // Falls back to the doc id so link-building still works for a member
        // that predates the field or was written without it.
        waitlistedUserId: (d['waitlistedUserId'] as string) || doc.id,
      };
    });

    return {
      leaderboard,
      totalUsers: confirmed.data().count,
      unverifiedUsers: unconfirmed.data().count,
      waitlistId,
    };
  } catch (err) {
    logger.error(`getPublicLeaderboard failed for ${waitlistId}`, err);
    throw new HttpsError('internal', 'Could not load the leaderboard.');
  }
});

/** The member's own record. Allowlisted — never spread the whole document. */
const MEMBER_FIELDS = [
  'email', 'firstName', 'maskedEmail', 'isConfirmed', 'emailVerified',
  'queuePosition', 'totalReferrals', 'referralCode', 'referralLink',
  'leaderboardLink', 'signupTimestamp', 'waitlistId', 'waitlistedUserId',
] as const;

/** Public-facing form config. The form doc also holds admin-only settings. */
const WAITLIST_FIELDS = [
  'name', 'slug', 'description', 'isActive', 'startingPoint', 'totalSignups',
  'uiConfig', 'gamificationEnabled', 'otpEnabled',
] as const;

function pick(source: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of keys) if (source[key] !== undefined) out[key] = source[key];
  return out;
}

/**
 * Callable: one member's own view — their record, their referral history, their stats.
 *
 * `memberRef` resolves **either** a member-doc id or a legacy `waitlistedUserId`.
 * That dual resolution is required, not a convenience: `leaderboardLink` embeds the
 * `WaitlistedUsers` doc id and those links are already out in sent emails, so they
 * have to keep working after U6 retires that collection.
 *
 * Referrals are read from the member's own subcollection (U6 moved them there) and
 * only masked recipient addresses are returned — a referrer should see that someone
 * joined, not harvest the address.
 */
export const getPublicMemberView = onCall(async (request) => {
  const waitlistId = requireWaitlistId(request.data);
  const memberRef = String((request.data as { memberRef?: unknown })?.memberRef || '').trim();
  if (!memberRef) throw new HttpsError('invalid-argument', 'memberRef is required.');

  try {
    const members = db.collection('Waitlists').doc(waitlistId).collection('users');

    // Try the member-doc id first, then the legacy back-reference.
    let memberDoc = await members.doc(memberRef).get();
    if (!memberDoc.exists) {
      const byLegacyId = await members.where('waitlistedUserId', '==', memberRef).limit(1).get();
      if (byLegacyId.empty) throw new HttpsError('not-found', 'No such member on this form.');
      memberDoc = byLegacyId.docs[0];
    }

    const [referrals, waitlistDoc] = await Promise.all([
      memberDoc.ref.collection('referrals').get(),
      db.collection('Waitlists').doc(waitlistId).get(),
    ]);

    const records = referrals.docs.map((doc) => {
      const d = doc.data();
      return {
        id: doc.id,
        referredName: (d['referredName'] as string) || '',
        referredMaskedEmail: (d['referredMaskedEmail'] as string) || maskEmail(d['referredEmail'] as string),
        status: d['status'],
        createdAt: d['createdAt'],
        completedAt: d['completedAt'],
      };
    });

    return {
      member: { id: memberDoc.id, ...pick(memberDoc.data()!, MEMBER_FIELDS) },
      referrals: records,
      stats: {
        successfulReferrals: records.filter((r) => r.status === 'completed').length,
        pendingReferrals: records.filter((r) => r.status === 'pending').length,
      },
      waitlist: waitlistDoc.exists
        ? { id: waitlistId, ...pick(waitlistDoc.data()!, WAITLIST_FIELDS) }
        : null,
    };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    logger.error(`getPublicMemberView failed for ${waitlistId}/${memberRef}`, err);
    throw new HttpsError('internal', 'Could not load your waitlist details.');
  }
});
