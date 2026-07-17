// waitlists/onWaitlistsUpdate.ts
import { onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { waitlistListId } from '../email-core/contacts.js';

/**
 * Keep a form's mirrored audience list named after the form.
 *
 * Form-fed lists are system lists (admins can't rename them directly), so the
 * form name is the single source of truth. Only creation paths create the list —
 * a rename never resurrects a list that was deliberately removed.
 */
export const onWaitlistsUpdate = onDocumentUpdated('Waitlists/{waitlistsId}', async (event) => {
  const before = event.data?.before.data();
  const after = event.data?.after.data();
  if (!before || !after) return;

  const name = after['name'];
  if (!name || before['name'] === name) return;

  const waitlistsId = event.params.waitlistsId;
  const listRef = db.collection('Lists').doc(waitlistListId(waitlistsId));

  try {
    const snap = await listRef.get();
    if (!snap.exists) return;
    await listRef.set({ name, updatedAt: Timestamp.now() }, { merge: true });
    logger.info(`Renamed list for Waitlist ${waitlistsId} to "${name}"`);
  } catch (error) {
    logger.error(`Failed to rename list for Waitlist ${waitlistsId}`, error);
  }
});
