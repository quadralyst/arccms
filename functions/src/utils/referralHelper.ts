import { FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * Shared helper to increment referral counts when a referral is completed.
 * Uses a batched write so both the WaitlistedUsers document and the
 * Waitlists/users subcollection are updated atomically.
 */
export async function incrementReferralCounts(
  referredByUserId: string,
  waitlistId: string,
  waitlistedUserId: string
): Promise<void> {
  const batch = db.batch();

  // 1. Increment referral count on WaitlistedUsers document
  const waitlistedUserRef = db.collection('WaitlistedUsers').doc(referredByUserId);
  batch.update(waitlistedUserRef, {
    totalReferrals: FieldValue.increment(1),
  });

  // 2. Find the corresponding user in Waitlists/{waitlistId}/users
  const waitlistRef = db.collection('Waitlists').doc(waitlistId);
  const usersSnapshot = await waitlistRef
    .collection('users')
    .where('waitlistedUserId', '==', waitlistedUserId)
    .limit(1)
    .get();

  if (!usersSnapshot.empty) {
    const userDoc = usersSnapshot.docs[0];
    batch.update(userDoc.ref, {
      totalReferrals: FieldValue.increment(1),
    });
  }

  await batch.commit();
}

/**
 * Shared helper to decrement referral counts when a referred user is deleted.
 * Finds the referrer by their referral code, decrements counts in both
 * WaitlistedUsers and Waitlists/users, and deletes the referral record.
 */
export async function decrementReferralCounts(
  referrerCode: string,
  waitlistId: string,
  deletedUserId: string
): Promise<void> {
  // Find the referrer by their referral code
  const referrerSnapshot = await db
    .collection('WaitlistedUsers')
    .where('referralCode', '==', referrerCode)
    .limit(1)
    .get();

  if (referrerSnapshot.empty) return;

  const referrerDoc = referrerSnapshot.docs[0];
  const referrerId = referrerDoc.id;
  const batch = db.batch();

  // 1. Decrement referral count on the referrer's WaitlistedUsers document
  batch.update(referrerDoc.ref, {
    totalReferrals: FieldValue.increment(-1),
  });

  // 2. Decrement referral count on the referrer's Waitlists/{waitlistId}/users entry
  const referrerWaitlistSnapshot = await db
    .collection('Waitlists')
    .doc(waitlistId)
    .collection('users')
    .where('waitlistedUserId', '==', referrerId)
    .limit(1)
    .get();

  if (!referrerWaitlistSnapshot.empty) {
    batch.update(referrerWaitlistSnapshot.docs[0].ref, {
      totalReferrals: FieldValue.increment(-1),
    });
  }

  // 3. Delete the referral record from the referrer's referrals subcollection
  const referralSnapshot = await db
    .collection('WaitlistedUsers')
    .doc(referrerId)
    .collection('referrals')
    .where('referredUserId', '==', deletedUserId)
    .get();

  referralSnapshot.docs.forEach((referralDoc) => {
    batch.delete(referralDoc.ref);
  });

  await batch.commit();
}
