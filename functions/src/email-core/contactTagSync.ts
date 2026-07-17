import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { Timestamp, FieldValue } from 'firebase-admin/firestore';
import { db } from '../init.js';

/**
 * Deleting a tag pulls it off every contact carrying it (U2).
 *
 * Without this the tag id lingers in `Contacts.tags[]` forever: invisible in the
 * UI (no tag doc to render) but still matching a tag filter — the same orphan
 * class as a deleted form's list membership.
 *
 * Pages by re-querying, since each processed contact stops matching, with a cap
 * so a pathological loop can't run away.
 */
export const onContactTagDelete = onDocumentDeleted('ContactTags/{tagId}', async (event) => {
  const tagId = event.params.tagId;
  const PAGE = 400;
  const MAX_PAGES = 250; // 100k contacts — far beyond any real tag
  let cleared = 0;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const snap = await db
        .collection('Contacts')
        .where('tags', 'array-contains', tagId)
        .limit(PAGE)
        .get();
      if (snap.empty) break;

      const batch = db.batch();
      for (const doc of snap.docs) {
        batch.update(doc.ref, { tags: FieldValue.arrayRemove(tagId), updatedAt: Timestamp.now() });
      }
      await batch.commit();
      cleared += snap.size;

      if (snap.size < PAGE) break;
    }
    logger.info(`onContactTagDelete: removed tag ${tagId} from ${cleared} contacts`);
  } catch (err) {
    logger.error(`onContactTagDelete failed for ${tagId}`, err);
  }
});
