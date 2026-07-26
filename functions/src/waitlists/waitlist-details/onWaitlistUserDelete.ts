import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { decrementReferralCounts } from '../../utils/referralHelper.js';

interface WaitlistUserData {
  referredBy?: string;
  waitlistId?: string;
  waitlistedUserId?: string;
  email?: string;
}

/**
 * Trigger: fires when a user document is deleted from Waitlists/{waitlistId}/users.
 * If the deleted user was referred by someone, decrements the referrer's
 * totalReferrals count and removes the referral record.
 */
export const onWaitlistUserDelete = onDocumentDeleted(
  'Waitlists/{WaitlistsId}/users/{usersId}',
  async (event) => {
    const deletedData = event.data?.data() as WaitlistUserData | undefined;
    if (!deletedData) return;

    const waitlistId = event.params.WaitlistsId;

    // If this user was referred by someone, decrement the referrer's counts
    if (deletedData.referredBy) {
      try {
        await decrementReferralCounts(
          deletedData.referredBy,
          waitlistId,
          // Both ids: pre-U6 referral records name the referred person by their
          // WaitlistedUsers id, post-U6 records by their member-doc id.
          [deletedData.waitlistedUserId || '', event.params.usersId],
        );
        console.log(
          `Decremented referral count for referrer code ${deletedData.referredBy} after deleting user ${deletedData.email || event.params.usersId}`
        );
      } catch (error) {
        console.error('Error decrementing referral counts on user delete:', error);
      }
    }
  }
);
