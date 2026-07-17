import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { ensureFormList, waitlistListId } from './contacts.js';

/**
 * Admin callable: give every existing signup form (waitlist) its mirrored
 * audience list (audience-unification spec U1, runbook step 2).
 *
 * Before U1 the list was created lazily — only when the first member verified —
 * so forms with no verified members were invisible under Audience → Lists. This
 * creates the missing ones and repairs those made by the lazy path, which carry
 * no `formId` back-pointer and often a placeholder name ("Waitlist wl-123").
 *
 * Idempotent: re-running touches names/back-pointers only, never memberCount.
 */
export const backfillFormLists = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  try {
    const snap = await db.collection('Waitlists').get();

    let created = 0;
    let repaired = 0;
    const errors: string[] = [];

    for (const doc of snap.docs) {
      const name = doc.data()['name'] || `Waitlist ${doc.id}`;
      try {
        const existed = (await db.collection('Lists').doc(waitlistListId(doc.id)).get()).exists;
        await ensureFormList(doc.id, name);
        existed ? repaired++ : created++;
      } catch (err) {
        logger.error(`backfillFormLists failed for Waitlist ${doc.id}`, err);
        errors.push(doc.id);
      }
    }

    const result = { forms: snap.size, created, repaired, errors };
    logger.info('backfillFormLists complete', result);
    return result;
  } catch (err) {
    logger.error('backfillFormLists failed', err);
    throw new HttpsError('internal', 'Backfill failed.');
  }
});
