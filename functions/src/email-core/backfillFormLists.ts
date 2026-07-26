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
 *
 * `dryRun` reports which lists would be created versus repaired without writing, so
 * a migration runbook can preview this step like every other one — the U5.5 backfill
 * showed how much a dry run catches before it writes.
 */
export const backfillFormLists = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const dryRun = request.data?.dryRun === true;

  try {
    const snap = await db.collection('Waitlists').get();

    let created = 0;
    let repaired = 0;
    const errors: string[] = [];
    const wouldCreate: string[] = [];

    for (const doc of snap.docs) {
      const name = doc.data()['name'] || `Waitlist ${doc.id}`;
      try {
        const existed = (await db.collection('Lists').doc(waitlistListId(doc.id)).get()).exists;
        // Count only after the write succeeds, so a form that threw is reported in
        // `errors` and not also as created. On a dry run there is no write to succeed,
        // so the count is taken from the existence check alone.
        if (!dryRun) await ensureFormList(doc.id, name);
        if (existed) repaired++; else { created++; wouldCreate.push(doc.id); }
      } catch (err) {
        logger.error(`backfillFormLists failed for Waitlist ${doc.id}`, err);
        errors.push(doc.id);
      }
    }

    const result = { dryRun, forms: snap.size, created, repaired, errors, wouldCreate };
    logger.info(`backfillFormLists${dryRun ? ' (dry run)' : ''} complete`, result);
    return result;
  } catch (err) {
    logger.error('backfillFormLists failed', err);
    throw new HttpsError('internal', 'Backfill failed.');
  }
});
