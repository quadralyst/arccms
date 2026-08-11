import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * Referral counters, keyed on the form-member (funnel) doc.
 *
 * Referrals used to live at `WaitlistedUsers/{uid}/referrals/{id}` and the counter was
 * written twice — once on the global registry doc and once on the form member — kept in
 * step by a batch. U6 retires the registry, and referral records now live under the
 * member that earned them:
 *
 *   Waitlists/{waitlistId}/users/{memberId}/referrals/{referralId}
 *
 * That removes the lookups these helpers used to need. The old code had to resolve the
 * member from a `waitlistedUserId` field with a `where(...).limit(1)` query, so a
 * referral silently scored nothing if that query missed; now the member is the record's
 * own parent, taken straight from the trigger path.
 *
 * `totalReferrals` on the member doc is what the leaderboard orders by, and the
 * composite index for it is already deployed.
 */

/** Credit one completed referral to the member who earned it. */
export async function incrementReferralCounts(
  waitlistId: string,
  memberId: string,
): Promise<void> {
  await db
    .collection('Waitlists').doc(waitlistId)
    .collection('users').doc(memberId)
    .update({ totalReferrals: FieldValue.increment(1) });
}

/**
 * Reverse a referral when the referred person is deleted.
 *
 * The referrer is found by their referral code *within the same form* — codes are
 * per-member, and scoping the lookup to the form keeps it unambiguous now that the
 * global registry is gone.
 */
export async function decrementReferralCounts(
  referrerCode: string,
  waitlistId: string,
  deletedUserIds: string | string[],
): Promise<void> {
  const members = db.collection('Waitlists').doc(waitlistId).collection('users');

  const referrer = await members.where('referralCode', '==', referrerCode).limit(1).get();
  if (referrer.empty) return;

  const referrerRef = referrer.docs[0].ref;
  const batch = db.batch();

  batch.update(referrerRef, { totalReferrals: FieldValue.increment(-1) });

  // Drop the referral record(s) for the deleted person. Deleting the referred member's
  // own doc does not remove these — they hang off the *referrer*.
  //
  // Matched against several candidate ids because records written before U6 identify the
  // referred person by their `WaitlistedUsers` id, while records written after identify
  // them by their member-doc id. Missing one would leave a stale record behind and the
  // counter out of step with it.
  const candidates = [...new Set((Array.isArray(deletedUserIds) ? deletedUserIds : [deletedUserIds]).filter(Boolean))];
  if (candidates.length) {
    const records = await referrerRef
      .collection('referrals')
      .where('referredUserId', 'in', candidates.slice(0, 10))
      .get();
    records.docs.forEach((doc) => batch.delete(doc.ref));
  }

  await batch.commit();
}
