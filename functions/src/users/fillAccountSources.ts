/**
 * Admin callable: give every `users` record a `by` (how the account was made), so the
 * admin users list can show only people (docs/features/users-and-roles.html).
 *
 * Every account made today has `by` (`email`, `phone`, `google`, `admin`, or `app` for
 * an app account). Records made before Arc CMS recorded it have none, and Firestore
 * leaves a record without the field out of `where('by', '!=', 'app')`, so the People
 * filter would miss them. This writes `by: 'unknown'` on each of those. The users page
 * calls it by itself, once, when its counts show such records.
 *
 * Idempotent: a record that already has a `by` is never touched.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { isArcAdmin } from './claims.js';

/** What a record made before Arc CMS recorded `by` gets. */
export const UNKNOWN_SOURCE = 'unknown';

/** Writes per batch, under Firestore's 500. */
const BATCH_SIZE = 400;

/** Whether a record says how it was made. */
export function hasSource(data: Record<string, unknown> | undefined): boolean {
    const by = data?.['by'];
    return typeof by === 'string' && by.trim() !== '';
}

export const fillAccountSources = onCall(async (request) => {
    if (!isArcAdmin(request.auth?.token)) {
        throw new HttpsError('permission-denied', 'Admin role required.');
    }

    // Firestore cannot query for a missing field, so read every record (only `by`).
    const snap = await db.collection('users').select('by').get();
    const missing = snap.docs.filter((doc) => !hasSource(doc.data()));

    for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        const batch = db.batch();
        for (const doc of missing.slice(i, i + BATCH_SIZE)) batch.update(doc.ref, { by: UNKNOWN_SOURCE });
        await batch.commit();
    }

    if (missing.length) logger.info(`fillAccountSources: ${missing.length} of ${snap.size} records had no by.`);
    return { filled: missing.length, total: snap.size };
});
