import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { ensureFormList, upsertContact } from './contacts.js';
import type { WaitlistUserData } from '../types.js';

/**
 * Admin callable: give historical unverified form signups a `pending` contact
 * (audience-unification spec U2, runbook step 3).
 *
 * Before U2 a contact was only created once a member verified, so everyone who
 * signed up and never confirmed is missing from the audience entirely. U2's
 * create trigger covers new signups; this covers the backlog.
 *
 * Idempotent by construction: `upsertContact` only applies `consent` when it
 * creates the doc, so re-running never regresses an already-`subscribed`
 * contact to `pending`, and `addContactToLists` only counts a genuinely new
 * membership. Verified members are skipped — they already have a contact via
 * the pre-U2 verify path, and `backfillContacts` owns repairing those.
 */
export const backfillPendingContacts = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  const dryRun = request.data?.dryRun === true;

  try {
    const forms = await db.collection('Waitlists').get();

    let scanned = 0;
    let created = 0;
    let existing = 0;
    let skippedNoEmail = 0;
    const errors: string[] = [];

    for (const form of forms.docs) {
      const name = form.data()['name'] || `Waitlist ${form.id}`;

      // Filter in memory rather than with where('emailVerified','!=',true):
      // Firestore's != excludes docs missing the field entirely, and those
      // legacy members are exactly the ones this backfill exists to repair.
      const members = await form.ref.collection('users').get();
      const targets = members.docs.filter((d) => d.data()['emailVerified'] !== true);

      if (!targets.length) continue;

      let listId: string;
      try {
        listId = await ensureFormList(form.id, name);
      } catch (err) {
        logger.error(`backfillPendingContacts could not ensure list for ${form.id}`, err);
        errors.push(form.id);
        continue;
      }

      for (const doc of targets) {
        const member = doc.data() as WaitlistUserData;
        scanned++;
        if (!member.email) {
          skippedNoEmail++;
          continue;
        }
        if (dryRun) {
          created++;
          continue;
        }
        try {
          const { created: isNew } = await upsertContact({
            email: member.email,
            name: member.name,
            firstName: member.firstName,
            source: 'waitlist',
            addLists: [listId],
            consent: member.isSubscribed === false ? 'unsubscribed' : 'pending',
          });
          isNew ? created++ : existing++;
        } catch (err) {
          logger.error(`backfillPendingContacts failed for ${doc.ref.path}`, err);
          errors.push(doc.ref.path);
        }
      }
    }

    const result = { dryRun, forms: forms.size, scanned, created, existing, skippedNoEmail, errors };
    logger.info('backfillPendingContacts complete', result);
    return result;
  } catch (err) {
    logger.error('backfillPendingContacts failed', err);
    throw new HttpsError('internal', 'Backfill failed.');
  }
});
