import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * Admin callable: move historical referral records off the retiring
 * `WaitlistedUsers` registry (audience-unification spec U6, step 3).
 *
 * U6 re-homed referrals under the member that earned them:
 *
 *   WaitlistedUsers/{uid}/referrals/{id}
 *     → Waitlists/{waitlistId}/users/{memberId}/referrals/{id}
 *
 * New referrals already write to the new path. This copies the ones written before
 * that, which are otherwise invisible — the per-member referral history on the user
 * detail page reads the new location.
 *
 * **What this deliberately does not do: touch `totalReferrals`.** The old helper
 * dual-wrote that counter onto the member doc at the time each referral completed, so
 * the aggregates are already correct. Re-counting here would double them. Each copied
 * record is stamped `migratedAt`, and `onReferralCreate` skips records carrying it —
 * without that the copy itself would fire the crediting trigger once per historical
 * referral.
 *
 * Idempotent: the destination keeps the source doc id, and an existing destination is
 * left untouched. `dryRun` reports what would move without writing.
 */

interface MigrationResult {
  success: boolean;
  dryRun: boolean;
  registryDocsScanned: number;
  referralsFound: number;
  referralsCopied: number;
  referralsAlreadyPresent: number;
  unresolved: { uid: string; referralId: string; reason: string }[];
}

export const migrateWaitlistedUsers = onCall(async (request): Promise<MigrationResult> => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const dryRun = request.data?.dryRun === true;

  try {
    const registry = await db.collection('WaitlistedUsers').get();

    let referralsFound = 0;
    let referralsCopied = 0;
    let referralsAlreadyPresent = 0;
    const unresolved: { uid: string; referralId: string; reason: string }[] = [];

    /**
     * The referrer's member doc for a given form.
     *
     * Matched on `waitlistedUserId`, the back-reference the signup flow stamped onto
     * every member doc — that is the only link between a registry doc and its member.
     */
    const memberCache = new Map<string, string | null>();
    async function findMemberId(waitlistId: string, uid: string): Promise<string | null> {
      const key = `${waitlistId}|${uid}`;
      if (memberCache.has(key)) return memberCache.get(key)!;

      const snap = await db
        .collection('Waitlists').doc(waitlistId).collection('users')
        .where('waitlistedUserId', '==', uid)
        .limit(1)
        .get();
      const id = snap.empty ? null : snap.docs[0].id;
      memberCache.set(key, id);
      return id;
    }

    for (const registryDoc of registry.docs) {
      const uid = registryDoc.id;
      const referrals = await registryDoc.ref.collection('referrals').get();

      for (const referral of referrals.docs) {
        referralsFound++;
        const data = referral.data();
        const waitlistId = data['waitlistId'] as string | undefined;

        if (!waitlistId) {
          // Nothing identifies which form this belonged to, so there is no member to
          // attach it to. Reported rather than guessed at.
          unresolved.push({ uid, referralId: referral.id, reason: 'no waitlistId on the record' });
          continue;
        }

        const memberId = await findMemberId(waitlistId, uid);
        if (!memberId) {
          unresolved.push({
            uid,
            referralId: referral.id,
            reason: `no member in ${waitlistId} back-references this registry doc`,
          });
          continue;
        }

        const target = db
          .collection('Waitlists').doc(waitlistId)
          .collection('users').doc(memberId)
          .collection('referrals').doc(referral.id);

        if ((await target.get()).exists) {
          referralsAlreadyPresent++;
          continue;
        }

        referralsCopied++;
        if (!dryRun) {
          await target.set({
            ...data,
            // Marks this as already-counted so onReferralCreate ignores the copy.
            migratedAt: Timestamp.now(),
            migratedFrom: `WaitlistedUsers/${uid}/referrals/${referral.id}`,
          });
        }
      }
    }

    logger.info(
      `migrateWaitlistedUsers${dryRun ? ' (dry run)' : ''}: `
      + `${referralsCopied} of ${referralsFound} referral(s) moved across `
      + `${registry.size} registry doc(s); ${referralsAlreadyPresent} already present; `
      + `${unresolved.length} unresolved.`,
    );

    return {
      success: true,
      dryRun,
      registryDocsScanned: registry.size,
      referralsFound,
      referralsCopied,
      referralsAlreadyPresent,
      unresolved,
    };
  } catch (err) {
    logger.error('migrateWaitlistedUsers failed', err);
    throw new HttpsError('internal', 'Could not migrate the referral records.');
  }
});
