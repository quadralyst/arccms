import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { arcDocument } from '../arc-config.js';
import { createNotification } from '../email-core/notifications.js';
import { pageOfPageTextId, PAGE_TEXT_DRAFTS } from '../pages/page-text-store.js';
import { KEPT, extractContentTypeSlug } from './collectionHelpers.js';

/** How many kept drafts stay under a draft (VE-D84). */
export const KEPT_DRAFTS = 10;

const clip = (value: unknown, limit: number): string => (typeof value === 'string' ? value.trim().slice(0, limit) : '');

/** What was taken over, in words, and where it is edited; null for a document that is not a draft. */
async function takenOver(collection: string, docId: string, data: Record<string, any>): Promise<{ what: string; link: string } | null> {
    const type = extractContentTypeSlug(collection);
    if (type) {
        const title = clip(data['title'], 120);
        return {
            what: title ? `"${title}"` : 'an entry with no title',
            link: `/admin/edit/${encodeURIComponent(type)}/${encodeURIComponent(docId)}`,
        };
    }
    const page = collection === PAGE_TEXT_DRAFTS ? pageOfPageTextId(docId) : null;
    if (!page) return null;
    if (page.kind === 'home') return { what: 'the home page', link: '/admin/edit-page/home' };
    if (page.kind === 'static') return { what: `the page ${page.name}`, link: `/admin/edit-page/p/${page.name}` };
    const snap = await db.collection('ContentTypes').where('slug', '==', page.slug).limit(1).get();
    const name = snap.empty ? '' : clip(snap.docs[0].data()?.['name'], 120);
    return { what: `the ${name || page.slug} list page`, link: `/admin/edit-page/list/${page.slug}` };
}

/**
 * A draft was kept before someone took it over, or discarded it
 * (specs/visual-editing-spec.md, VE-D82, VE-D84): the person it was taken over from
 * is told, and only the newest ten stay under the draft.
 *
 * Watches the `Kept` subcollection alone, under drafts of every type and of pages,
 * so it runs only when work changes hands, never on an ordinary save. The same event
 * delivered twice tells the person once (the notification's id is the kept draft's)
 * and prunes again to the same ten.
 */
export const onDraftKept = onDocumentCreated(arcDocument(`{collection}/{docId}/${KEPT}/{keptId}`), async (event) => {
    const { collection, docId, keptId } = event.params;
    if (collection !== PAGE_TEXT_DRAFTS && !extractContentTypeSlug(collection)) return;
    const kept = event.data?.data();
    if (!kept) return;

    try {
        const by = typeof kept['by'] === 'string' ? kept['by'] : '';
        if (kept['why'] === 'takeover' && by && by !== kept['keptBy']) {
            const taken = await takenOver(collection, docId, (kept['data'] ?? {}) as Record<string, any>);
            if (taken) {
                await createNotification({
                    id: `kept-${docId}-${keptId}`,
                    userId: by,
                    type: 'draft_taken_over',
                    title: `${clip(kept['keptByName'], 80) || 'Someone'} took over ${taken.what}`,
                    body: 'Your changes are kept in History.',
                    link: taken.link,
                    createdBy: 'system',
                });
            }
        }
    } catch (error) {
        console.error(`Could not tell ${collection}/${docId}'s editor it was taken over:`, error);
    }

    try {
        const older = await db.collection(collection).doc(docId).collection(KEPT).orderBy('keptAt', 'desc').offset(KEPT_DRAFTS).get();
        // Each with its other languages, which outlive a plain delete.
        for (const doc of older.docs) await db.recursiveDelete(doc.ref);
    } catch (error) {
        console.error(`Could not prune the kept drafts of ${collection}/${docId}:`, error);
    }
});
