import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { constant } from '../../constant.js';
import { incrementReferralCounts } from '../../utils/referralHelper.js';

interface ReferralData {
  status?: string;
}

/**
 * Credit the member when a pending referral completes.
 *
 * Guarded on the pending → completed transition specifically, so an unrelated edit to a
 * completed record cannot double-credit. See onReferralCreate for why the ids now come
 * from the path rather than from fields on the record.
 */
export const onReferralUpdate = onDocumentUpdated(
  'Waitlists/{waitlistId}/users/{memberId}/referrals/{referralsId}',
  async (event) => {
    const before = event.data?.before.data() as ReferralData | undefined;
    const after = event.data?.after.data() as ReferralData | undefined;
    if (!before || !after) return;

    if (
      before.status === constant.REFERRAL_STATUS.PENDING
      && after.status === constant.REFERRAL_STATUS.COMPLETED
    ) {
      await incrementReferralCounts(event.params.waitlistId, event.params.memberId);
    }
  },
);
