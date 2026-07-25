import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { waitlistListId } from './contacts.js';

/**
 * Admin callable: stamp `targetListIds` on every existing signup form
 * (audience-unification spec U3, runbook step 6).
 *
 * U3 decouples a form from its list: a form now declares which list(s) it feeds
 * via `targetListIds`, defaulting to just its own `waitlist-{id}` system list.
 * Forms created before U3 have no such field; the sync triggers already fall
 * back to `[ownList]`, but stamping makes the value explicit so the admin UI can
 * show and edit it.
 *
 * Idempotent: only writes forms missing the field (or with the own list absent),
 * and never drops manual lists an admin has already added.
 */
export const stampFormTargetLists = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const dryRun = request.data?.dryRun === true;

  try {
    const forms = await db.collection('Waitlists').get();

    let stamped = 0;
    let alreadyOk = 0;

    for (const form of forms.docs) {
      const ownListId = waitlistListId(form.id);
      const stored: unknown = form.data()['targetListIds'];
      const current: string[] = Array.isArray(stored) ? stored.filter((x) => typeof x === 'string') : [];

      // The own system list must always be a target (v1 decision).
      const next = [...new Set([ownListId, ...current])];

      const unchanged = Array.isArray(stored) && next.length === current.length;
      if (unchanged) {
        alreadyOk++;
        continue;
      }

      if (!dryRun) {
        await db.collection('Waitlists').doc(form.id).update({ targetListIds: next });
      }
      stamped++;
    }

    const result = { dryRun, forms: forms.size, stamped, alreadyOk };
    logger.info('stampFormTargetLists complete', result);
    return result;
  } catch (err) {
    logger.error('stampFormTargetLists failed', err);
    throw new HttpsError('internal', 'Stamping failed.');
  }
});
