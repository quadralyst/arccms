import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';

/**
 * Admin maintenance callable: remove duplicate `EmailTemplate` documents.
 *
 * Historically `onWaitlistsCreate` wrote per-waitlist templates with random
 * auto-ids, so a re-fired create trigger (or a re-created waitlist) left two
 * docs sharing the same `type` + `waitlistId`. That surfaced as the same
 * template appearing twice in the composer / drip pickers.
 *
 * This groups docs by `type` + `waitlistId` and keeps a single canonical doc
 * per group (preferring the deterministic id now used by the trigger, else the
 * oldest by `createdAt`), deleting the rest. Docs without a `type` are left
 * untouched. Safe to re-run — a deduped collection is a no-op.
 */
export const dedupeEmailTemplates = onCall(async (request) => {
  if (request.auth?.token?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin role required.');
  }

  try {
    const snap = await db.collection('EmailTemplate').get();

    // Group docs by their logical identity.
    const groups = new Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>();
    for (const doc of snap.docs) {
      const data = doc.data();
      const type = data['type'];
      if (!type) continue; // never dedupe typeless docs
      const waitlistId = data['waitlistId'] || '';
      const key = `${type}::${waitlistId}`;
      const bucket = groups.get(key) || [];
      bucket.push(doc);
      groups.set(key, bucket);
    }

    let duplicateGroups = 0;
    let deleted = 0;
    const batch = db.batch();

    for (const [, docs] of groups) {
      if (docs.length < 2) continue;
      duplicateGroups++;

      const type = docs[0].data()['type'];
      const waitlistId = docs[0].data()['waitlistId'] || '';
      const deterministicId = waitlistId ? `${type}_${waitlistId}` : type;

      // Keeper: prefer the deterministic id, else the oldest doc.
      const toMillis = (d: FirebaseFirestore.QueryDocumentSnapshot): number => {
        const c = d.data()['createdAt'];
        if (c?.toMillis) return c.toMillis();
        if (c instanceof Date) return c.getTime();
        return Number.MAX_SAFE_INTEGER;
      };
      const sorted = [...docs].sort((a, b) => {
        if (a.id === deterministicId) return -1;
        if (b.id === deterministicId) return 1;
        return toMillis(a) - toMillis(b);
      });

      for (const dup of sorted.slice(1)) {
        batch.delete(dup.ref);
        deleted++;
      }
    }

    if (deleted > 0) await batch.commit();

    const result = { duplicateGroups, deleted, scanned: snap.size };
    logger.info('dedupeEmailTemplates complete', result);
    return result;
  } catch (err) {
    logger.error('dedupeEmailTemplates failed', err);
    throw new HttpsError('internal', 'Failed to dedupe email templates.');
  }
});
