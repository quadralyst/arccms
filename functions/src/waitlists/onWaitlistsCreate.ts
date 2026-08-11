// waitlists/onWaitlistsCreate.ts
import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { ensureFormList } from '../email-core/contacts.js';
import { ensureWaitlistTemplates } from '../email-core/defaultTemplates.js';

/**
 * A new signup form (waitlist) gets:
 *  1. its mirrored audience list, created eagerly so the form shows up under
 *     Audience → Lists immediately — before anyone has signed up. (Membership
 *     still only arrives via contact sync; the list starts at memberCount 0.)
 *  2. its own default OTP + welcome templates, so each form can carry its own
 *     content and layout.
 *
 * Both steps are idempotent: a retried or re-fired trigger upserts the same
 * list and the same two template docs rather than duplicating them.
 */
export const onWaitlistsCreate = onDocumentCreated('Waitlists/{waitlistsId}', async (event: any) => {
  const waitlistsId = event.params.waitlistsId;
  const name = event.data?.data()?.['name'] || `Waitlist ${waitlistsId}`;

  // The list must not block template seeding (and vice versa) if it throws.
  try {
    await ensureFormList(waitlistsId, name);
  } catch (error) {
    logger.error(`Failed to ensure list for Waitlist ${waitlistsId}`, error);
  }

  // Eager warm path only. The same helper runs lazily at every point of use, so
  // a form whose trigger never fired (imported, restored, migrated) still gets
  // its templates the first time one is needed — this call just means the admin
  // Templates page is populated before anyone looks at it.
  try {
    const { created, skipped } = await ensureWaitlistTemplates(waitlistsId);
    logger.info(
      `Waitlist ${waitlistsId}: templates created=[${created.join(', ')}] `
      + `already-present=[${skipped.join(', ')}].`,
    );
  } catch (error) {
    logger.error(`Failed to ensure email templates for Waitlist ${waitlistsId}`, error);
  }
});
