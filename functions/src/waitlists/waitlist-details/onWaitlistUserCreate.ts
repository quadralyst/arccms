import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getEmailTemplate, createWelcomeEmailLog } from '../../utils/emailTemplateHelper.js';
import { WaitlistUserData } from '../../types.js';
import { db } from '../../init.js';

export const onWaitlistUserCreate = onDocumentCreated(
  'Waitlists/{WaitlistsId}/users/{usersId}',
  async (event) => {
    const waitlistedUsersData = event.data?.data() as WaitlistUserData | undefined;
    if (!waitlistedUsersData) return;

    // The OTP email is sent by requestFormOtp, which the signup flow calls directly
    // (U5). It used to ride on a registry-collection trigger; that trigger is gone.
    // This function only handles the welcome email for direct-joined (already-verified) users.

    if (waitlistedUsersData?.isDirectJoined && waitlistedUsersData.emailVerified === true) {
      try {
        // Get waitlist name for template (and the U5 migration guard).
        const waitlistDoc = await db.collection('Waitlists').doc(waitlistedUsersData.waitlistId).get();
        const waitlistName = waitlistDoc.exists ? waitlistDoc.data()?.name || '' : '';

        // U5: the day-0 sequence owns the welcome once migrated. A direct-join
        // signup is created already verified, so its contact starts `subscribed`
        // and the fast path sends the step at enrollment — no second send here.
        if (waitlistDoc.data()?.['welcomeMigrated'] === true) {
          console.log(`onWaitlistUserCreate: welcome for ${waitlistedUsersData.waitlistId} is sequence-owned; skipping direct send.`);
        } else {
          const templateData = await getEmailTemplate(
            waitlistedUsersData.waitlistId,
            'waitlist_welcome_email'
          );
          await createWelcomeEmailLog(waitlistedUsersData, templateData, waitlistName);
        }
      } catch (error) {
        console.error('Error sending welcome email:', error);
      }
    }
  }
);
