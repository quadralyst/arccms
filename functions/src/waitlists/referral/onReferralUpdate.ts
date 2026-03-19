import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { constant } from '../../constant.js';
import { incrementReferralCounts } from '../../utils/referralHelper.js';

interface ReferralData {
  status?: string;
  referredBy?: string;
  waitlistId?: string;
}

export const onReferralUpdate = onDocumentUpdated(
  'WaitlistedUsers/{WaitlistedUsersId}/referrals/{referralsId}',
  async (event) => {
    const oldValue = event.data?.before.data() as ReferralData | undefined;
    const newValue = event.data?.after.data() as ReferralData | undefined;

    if (!oldValue || !newValue) return;

    const waitlistedUserId = event.params.WaitlistedUsersId;

    // Only process when status changes from pending to completed
    if (
      oldValue.status === constant.REFERRAL_STATUS.PENDING &&
      newValue.status === constant.REFERRAL_STATUS.COMPLETED &&
      newValue.referredBy &&
      newValue.waitlistId
    ) {
      await incrementReferralCounts(
        newValue.referredBy,
        newValue.waitlistId,
        waitlistedUserId
      );
    }
  }
);
