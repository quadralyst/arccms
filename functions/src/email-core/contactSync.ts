import { onDocumentCreated, onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import {
  upsertContact,
  unlinkUserContact,
  ensureList,
  ensureSystemLists,
  SYSTEM_LISTS,
  waitlistListId,
} from './contacts.js';
import type { WaitlistUserData } from '../types.js';

/**
 * Contacts auto-sync (spec §Phase-3.1). Each product moment that creates or
 * changes an audience member mirrors into the unified `Contacts` layer.
 */

/** New user → contact (source `signup`), joins the `all-users` system list. */
export const onUserCreateContact = onDocumentCreated('users/{docId}', async (event) => {
  const user = event.data?.data();
  const email: string | undefined = user?.['email'];
  if (!user || !email) return;

  try {
    await ensureSystemLists();
    await upsertContact({
      email,
      name: user['name'],
      firstName: user['firstName'],
      userId: user['uid'],
      source: 'signup',
      addLists: [SYSTEM_LISTS.ALL_USERS],
    });
  } catch (err) {
    logger.error('onUserCreateContact failed', err);
  }
});

/** User deleted → unlink + drop from system lists (cleanup). */
export const onUserDeleteContact = onDocumentDeleted('users/{docId}', async (event) => {
  const email: string | undefined = event.data?.data()?.['email'];
  if (!email) return;
  try {
    await unlinkUserContact(email);
  } catch (err) {
    logger.error('onUserDeleteContact failed', err);
  }
});

/** Waitlist member becomes verified → contact (source `waitlist`), joins `waitlist-{id}`. */
export const onWaitlistVerifiedContact = onDocumentUpdated(
  'Waitlists/{waitlistId}/users/{userId}',
  async (event) => {
    const before = event.data?.before.data() as WaitlistUserData | undefined;
    const after = event.data?.after.data() as WaitlistUserData | undefined;
    if (!before || !after) return;

    const justVerified = before.emailVerified !== true && after.emailVerified === true;
    if (!justVerified || !after.email) return;

    const waitlistId = event.params.waitlistId;
    const listId = waitlistListId(waitlistId);

    try {
      let name = `Waitlist ${waitlistId}`;
      try {
        const wl = await db.collection('Waitlists').doc(waitlistId).get();
        if (wl.exists && wl.data()?.['name']) name = wl.data()!['name'];
      } catch { /* use fallback name */ }

      await ensureList(listId, { name, type: 'system' });
      await upsertContact({
        email: after.email,
        name: after.name,
        firstName: after.firstName,
        source: 'waitlist',
        addLists: [listId],
        // Waitlist members opted in by joining; keep legacy isSubscribed semantics.
        consent: after.isSubscribed === false ? 'unsubscribed' : 'subscribed',
      });
    } catch (err) {
      logger.error('onWaitlistVerifiedContact failed', err);
    }
  },
);
