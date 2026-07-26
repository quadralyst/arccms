import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { constant } from '../../constant.js';
import { incrementReferralCounts } from '../../utils/referralHelper.js';

interface ReferralData {
  status?: string;
}

/**
 * A referral record created already-completed credits its member immediately.
 *
 * U6 moved referrals under the member that earned them, so `waitlistId` and the
 * referrer's member id come straight from the path. The old trigger sat on
 * `WaitlistedUsers/{uid}/referrals/{id}` and had to trust `referredBy` and
 * `waitlistId` *fields* on the record, resolving the member with a query that
 * silently credited nobody when it missed.
 */
export const onReferralCreate = onDocumentCreated(
  'Waitlists/{waitlistId}/users/{memberId}/referrals/{referralsId}',
  async (event) => {
    const referral = event.data?.data() as ReferralData | undefined;
    if (referral?.status !== constant.REFERRAL_STATUS.COMPLETED) return;

    await incrementReferralCounts(event.params.waitlistId, event.params.memberId);
  },
);
