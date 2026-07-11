import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import {
  upsertContact,
  ensureList,
  ensureSystemLists,
  SYSTEM_LISTS,
  waitlistListId,
} from './contacts.js';

/**
 * Admin callable: build the `Contacts` layer from existing users + verified
 * waitlist members (spec §Phase-3.1). Idempotent — safe to re-run; upserts
 * never duplicate and list membership counts stay stable.
 */
export const backfillContacts = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  try {
    await ensureSystemLists();

    let users = 0;
    let customers = 0;
    let waitlistMembers = 0;

    // 1. Users → all-users (+ all-customers when premium).
    const usersSnap = await db.collection('users').get();
    for (const doc of usersSnap.docs) {
      const u = doc.data();
      if (!u['email']) continue;
      const isCustomer = !!u['premiumType'] || u['premiumStatus'] === 'active' || u['premiumStatus'] === 'trialing';
      const lists: string[] = [SYSTEM_LISTS.ALL_USERS];
      if (isCustomer) {
        lists.push(SYSTEM_LISTS.ALL_CUSTOMERS);
        customers++;
      }
      await upsertContact({
        email: u['email'],
        name: u['name'],
        firstName: u['firstName'],
        userId: u['uid'],
        source: isCustomer ? 'customer' : 'signup',
        addLists: lists,
      });
      users++;
    }

    // 2. Verified waitlist members → waitlist-{id}.
    const wlSnap = await db.collection('WaitlistedUsers').where('emailVerified', '==', true).get();
    for (const doc of wlSnap.docs) {
      const w = doc.data();
      if (!w['email'] || !w['waitlistId']) continue;
      const listId = waitlistListId(w['waitlistId']);
      await ensureList(listId, { name: `Waitlist ${w['waitlistId']}`, type: 'system' });
      await upsertContact({
        email: w['email'],
        name: w['name'],
        firstName: w['firstName'],
        source: 'waitlist',
        addLists: [listId],
        consent: w['isSubscribed'] === false ? 'unsubscribed' : 'subscribed',
      });
      waitlistMembers++;
    }

    const result = { users, customers, waitlistMembers };
    logger.info('backfillContacts complete', result);
    return result;
  } catch (err) {
    logger.error('backfillContacts failed', err);
    throw new HttpsError('internal', 'Backfill failed.');
  }
});
