import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { constant } from '../../constant.js';
import { incrementReferralCounts } from '../../utils/referralHelper.js';

interface ReferralData {
  status?: string;
  referredBy?: string;
  waitlistId?: string;
}

export const onReferralCreate = onDocumentCreated(
  'WaitlistedUsers/{WaitlistedUsersId}/referrals/{referralsId}',
  async (event) => {
    const referralData = event.data?.data() as ReferralData | undefined;
    if (!referralData) return;

    const waitlistedUserId = event.params.WaitlistedUsersId;

    // Only process completed referrals with a valid referrer
    if (
      referralData.status === constant.REFERRAL_STATUS.COMPLETED &&
      referralData.referredBy &&
      referralData.waitlistId
    ) {
      await incrementReferralCounts(
        referralData.referredBy,
        referralData.waitlistId,
        waitlistedUserId
      );
    }
  }
);
