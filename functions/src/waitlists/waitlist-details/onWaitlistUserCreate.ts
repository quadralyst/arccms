import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { getEmailTemplate, createWelcomeEmailLog } from '../../utils/emailTemplateHelper.js';
import { WaitlistUserData } from '../../types.js';
import { db } from '../../init.js';

export const onWaitlistUserCreate = onDocumentCreated(
  'Waitlists/{WaitlistsId}/users/{usersId}',
  async (event) => {
    const waitlistedUsersData = event.data?.data() as WaitlistUserData | undefined;
    if (!waitlistedUsersData) return;

    // OTP email is sent by onWaitlistedUsersCreate (global collection trigger) — not here.
    // This function only handles the welcome email for direct-joined (already-verified) users.

    if (waitlistedUsersData?.isDirectJoined && waitlistedUsersData.emailVerified === true) {
      try {
        const templateData = await getEmailTemplate(
          waitlistedUsersData.waitlistId,
          'waitlist_welcome_email'
        );

        // Get waitlist name for template
        const waitlistDoc = await db.collection('Waitlists').doc(waitlistedUsersData.waitlistId).get();
        const waitlistName = waitlistDoc.exists ? waitlistDoc.data()?.name || '' : '';

        await createWelcomeEmailLog(waitlistedUsersData, templateData, waitlistName);
      } catch (error) {
        console.error('Error sending welcome email:', error);
      }
    }
  }
);
