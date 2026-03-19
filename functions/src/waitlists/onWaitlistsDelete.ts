import { onDocumentDeleted } from 'firebase-functions/v2/firestore';

import { db } from '../init.js';

const BATCH_LIMIT = 500;

export const onWaitlistsDelete = onDocumentDeleted('Waitlists/{WaitlistsId}', async (event) => {
  const docId = event.params.WaitlistsId;

  await deleteSubCollections(docId);
});

/**
 * Deletes all subcollections of a Waitlist document.
 * Handles Firestore's 500-document batch limit by chunking deletions.
 */
export async function deleteSubCollections(docId: string): Promise<void> {
  try {
    const waitlistsDocRef = db.collection('Waitlists').doc(docId);
    const subcollections = await waitlistsDocRef.listCollections();

    for (const subcollection of subcollections) {
      await deleteCollectionInBatches(waitlistsDocRef.collection(subcollection.id));
    }

    console.log(`Successfully deleted Waitlist ${docId} and all subcollections`);
  } catch (error) {
    console.error(`Error deleting subcollections for Waitlist ${docId}:`, error);
    throw error;
  }
}

/**
 * Deletes all documents in a collection, respecting the 500 batch limit.
 */
async function deleteCollectionInBatches(
  collectionRef: FirebaseFirestore.CollectionReference
): Promise<void> {
  const query = collectionRef.limit(BATCH_LIMIT);

  return new Promise((resolve, reject) => {
    deleteQueryBatch(query, resolve).catch(reject);
  });
}

async function deleteQueryBatch(
  query: FirebaseFirestore.Query,
  resolve: () => void
): Promise<void> {
  const snapshot = await query.get();

  if (snapshot.size === 0) {
    resolve();
    return;
  }

  const batch = db.batch();
  for (const doc of snapshot.docs) {
    const subcollections = await doc.ref.listCollections();
    for (const subcol of subcollections) {
      await deleteCollectionInBatches(subcol);
    }
    batch.delete(doc.ref);
  }
  await batch.commit();

  // Recurse for remaining documents
  process.nextTick(() => {
    deleteQueryBatch(query, resolve);
  });
}
