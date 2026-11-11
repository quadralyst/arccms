import { Injectable, runInInjectionContext } from '@angular/core';
import { CollectionReference, collection, getDocs, getDoc, getDocsFromServer, getCountFromServer, query, where, limit, doc, writeBatch, orderBy, runTransaction } from '@angular/fire/firestore';
import { EntryChangedError, EntryGoneError, changedSinceOpened } from './entry-changed';
import { draftQueueEntry } from '../../../../../shared/services/search-queue';
import { DbService } from '../../../../../shared/services/db.service';
import { IDraftContents, INextContentReference } from './draft-contents.model';
import { IContentTranslation, pruneTranslation } from './content-translation.model';
import { BacklinkChange, BacklinkResult, SeriesField, SeriesLinks, backlinkValue, isRealId, refreshedReference, seriesReference } from './series-links';
import { Functions } from '@angular/fire/functions';
import { arcCallable } from '../../../../core/config/arc-functions';

@Injectable({
    providedIn: 'root'
})
export class DraftContentsService extends DbService<IDraftContents> {

    constructor() {
        super('DraftContents'); // Default fallback
    }

    override getCollectionRef(collectionSuffix?: string): CollectionReference<IDraftContents> {
        if (collectionSuffix) {
            return runInInjectionContext(this.injector, () => collection(this.firestore, `arc_${collectionSuffix}_drafts`)) as CollectionReference<IDraftContents>;
        }
        return super.getCollectionRef();
    }

    /**
     * Creates the indexes a type's list needs to filter by status and stay sorted. False when
     * they could not be created (functions/src/content-types/createContentListIndexes.ts).
     */
    async createListIndexes(contentTypeSlug: string): Promise<boolean> {
        const functions = this.injector.get(Functions);
        const result = await runInInjectionContext(this.injector, () =>
            arcCallable<{ slug: string }, { indexes: string }>(functions, 'createContentListIndexes')({ slug: contentTypeSlug }));
        return result.data.indexes === 'requested';
    }

    // ── Translations (M2) ──────────────────────────────────────────────────
    // Per-language variants live in a sibling subcollection so the base draft
    // document — the default language — is never migrated or rewritten:
    //   arc_{slug}_drafts/{docId}/translations/{lang}

    private translationsRef(contentTypeSlug: string, docId: string): CollectionReference {
        return runInInjectionContext(this.injector, () =>
            collection(this.firestore, `arc_${contentTypeSlug}_drafts`, docId, 'translations'),
        );
    }

    /** Reads one language variant. Returns null when it has not been translated. */
    async getTranslation(
        contentTypeSlug: string,
        docId: string,
        lang: string,
    ): Promise<IContentTranslation | null> {
        try {
            const ref = runInInjectionContext(this.injector, () =>
                doc(this.translationsRef(contentTypeSlug, docId), lang),
            );
            const snap = await runInInjectionContext(this.injector, () => getDoc(ref));
            if (!snap.exists()) return null;
            return { ...(snap.data() as IContentTranslation), lang };
        } catch (error) {
            console.error(`Error loading "${lang}" translation:`, error);
            return null;
        }
    }

    /**
     * Lists the language codes this item has been translated into.
     * Used to badge the language tabs — cheap enough to refresh on load.
     */
    async getTranslatedLanguages(contentTypeSlug: string, docId: string): Promise<string[]> {
        try {
            const snapshot = await runInInjectionContext(this.injector, () =>
                getDocs(this.translationsRef(contentTypeSlug, docId)),
            );
            return snapshot.docs.map((d) => d.id);
        } catch (error) {
            console.error('Error listing translations:', error);
            return [];
        }
    }

    /**
     * Writes one language variant. Blank fields are pruned rather than stored,
     * so they keep falling back to the base document.
     */
    async saveTranslation(
        contentTypeSlug: string,
        docId: string,
        translation: IContentTranslation,
    ): Promise<void> {
        const pruned = pruneTranslation(translation);
        const ref = runInInjectionContext(this.injector, () =>
            doc(this.translationsRef(contentTypeSlug, docId), translation.lang),
        );
        // Not a merge write: pruned-away fields must actually disappear so that
        // clearing a field in the editor restores the default-language value.
        // The draft is queued for search with it (specs/feature-flags-spec.md 6.5).
        // A transaction, not a batch: without a connection it fails at once
        // instead of waiting, so the editor can say "Not saved" (RF4 review M6).
        await runInInjectionContext(this.injector, () => runTransaction(this.firestore, async (transaction) => {
            transaction.set(ref, { ...pruned, lang: translation.lang });
            const entry = draftQueueEntry(this.firestore, ref.path);
            if (entry) transaction.set(entry.ref, entry.data);
        }));
    }

    /** Removes a language variant entirely, reverting it to the base content. */
    async deleteTranslation(contentTypeSlug: string, docId: string, lang: string): Promise<void> {
        const ref = runInInjectionContext(this.injector, () =>
            doc(this.translationsRef(contentTypeSlug, docId), lang),
        );
        await runInInjectionContext(this.injector, () => runTransaction(this.firestore, async (transaction) => {
            transaction.delete(ref);
            const entry = draftQueueEntry(this.firestore, ref.path);
            if (entry) transaction.set(entry.ref, entry.data);
        }));
    }

    /**
     * An id for a new entry, chosen before its first write so a retry writes
     * the same entry again rather than a second one (RF4 review H1, L1).
     */
    newDraftId(contentType: string): string {
        return runInInjectionContext(this.injector, () => doc(this.getCollectionRef(contentType))).id;
    }

    /**
     * Writes a new entry and returns its id (RF4 4.1). Unlike `add`, a failure
     * reaches the caller, so the editor can say "Not saved". A transaction, so
     * it fails at once without a connection instead of waiting in the queue.
     */
    async createDraft(contentType: string, data: Record<string, unknown>, id?: string): Promise<string> {
        const collectionRef = this.getCollectionRef(contentType);
        const ref = runInInjectionContext(this.injector, () => (id ? doc(collectionRef, id) : doc(collectionRef)));
        const now = new Date();
        const written = { createdAt: now, modifiedAt: now, ...data, id: ref.id };
        await runInInjectionContext(this.injector, () => runTransaction(this.firestore, async (transaction) => {
            transaction.set(ref, written);
            const entry = draftQueueEntry(this.firestore, ref.path);
            if (entry) transaction.set(entry.ref, entry.data);
        }));
        return ref.id;
    }

    /**
     * Saves an entry's changes (RF4 4.4, 4.5). With `openedModifiedAt`, the
     * stored entry must still carry that time: when someone else saved it
     * since, nothing is written and an EntryChangedError is thrown. Without it
     * (Keep mine), the write goes ahead. `data.modifiedAt` is the new mark;
     * the caller keeps it for its next save. Failures reach the caller.
     */
    async saveDraft(
        contentType: string,
        id: string,
        data: Record<string, unknown>,
        openedModifiedAt: unknown,
    ): Promise<void> {
        const ref = runInInjectionContext(this.injector, () => doc(this.getCollectionRef(contentType), id));
        const written = { ...data, modifiedAt: data['modifiedAt'] ?? new Date() };
        await runInInjectionContext(this.injector, () => runTransaction(this.firestore, async (transaction) => {
            const snap = await transaction.get(ref);
            if (!snap.exists()) throw new EntryGoneError();
            if (changedSinceOpened(openedModifiedAt, (snap.data() as { modifiedAt?: unknown }).modifiedAt)) {
                throw new EntryChangedError();
            }
            transaction.update(ref, written);
            const entry = draftQueueEntry(this.firestore, ref.path);
            if (entry) transaction.set(entry.ref, entry.data);
        }));
    }

    /**
     * Whether another entry of the type already has this address (RF4 4.6).
     * Asked of the server, for a new entry and an existing one alike; the
     * entry itself (`ownId`) does not count. A failed read throws, so a save
     * never goes ahead on a guess.
     */
    async isSlugTaken(slug: string, contentType: string, ownId?: string): Promise<boolean> {
        // Drafts, and live pages too: an entry whose draft moved to another
        // address still holds its old one on the site until it is published
        // again (RF4 server review M1).
        const drafts = this.getCollectionRef(contentType);
        const live = runInInjectionContext(this.injector, () => collection(this.firestore, `arc_${contentType}`));
        const [draftSnap, liveSnap] = await Promise.all([drafts, live].map((ref) => {
            const q = runInInjectionContext(this.injector, () => query(ref, where('urlSlug', '==', slug), limit(2)));
            return runInInjectionContext(this.injector, () => getDocsFromServer(q));
        }));
        return [...draftSnap.docs, ...liveSnap.docs].some((d) => d.id !== ownId);
    }

    /**
     * The address of an entry's live page, '' when it has none. The editor
     * offers a redirect from it when the address changes (RF4 4.6).
     */
    async publishedSlug(contentType: string, id: string): Promise<string> {
        try {
            const ref = runInInjectionContext(this.injector, () => doc(this.firestore, `arc_${contentType}`, id));
            const snap = await runInInjectionContext(this.injector, () => getDoc(ref));
            return snap.exists() ? String((snap.data() as { urlSlug?: string }).urlSlug || '') : '';
        } catch (error) {
            console.error('Error reading the published address:', error);
            return '';
        }
    }

    /**
     * Every entry of a type, for the entries list's title search (RF5 5.9),
     * which Firestore cannot do inside a title. Throws when it cannot be read.
     */
    async listForSearch(contentType: string): Promise<IDraftContents[]> {
        const snapshot = await runInInjectionContext(this.injector, () => getDocs(this.getCollectionRef(contentType)));
        return snapshot.docs.map((d) => ({ ...(d.data() as unknown as Record<string, unknown>), id: d.id }) as IDraftContents);
    }

    /** How many entries of the type carry a tag (RF4 4.11). Throws when it cannot be counted. */
    async countWithTag(contentType: string, label: string): Promise<number> {
        const q = runInInjectionContext(this.injector, () =>
            query(this.getCollectionRef(contentType), where('tags', 'array-contains', label)));
        const snapshot = await runInInjectionContext(this.injector, () => getCountFromServer(q));
        return snapshot.data().count;
    }

    /**
     * Check if a URL slug already exists in the collection
     * @param slug The URL slug to check
     * @param contentType The content type slug
     * @returns Promise with exists flag and the slug
     */
    async checkExistingSlugUrl(slug: string, contentType: string): Promise<{ exists: boolean; slug: string }> {
        try {
            const collectionRef = this.getCollectionRef(contentType);
            const q = runInInjectionContext(this.injector, () => query(collectionRef, where('urlSlug', '==', slug), limit(1)));
            const querySnapshot = await runInInjectionContext(this.injector, () => getDocs(q));

            return {
                exists: !querySnapshot.empty,
                slug: slug
            };
        } catch (error) {
            console.error('Error checking slug existence:', error);
            return { exists: false, slug: slug };
        }
    }

    /**
     * Get content item by slug
     * @param slug The URL slug to search for
     * @param contentType The content type slug
     * @returns Promise with content item or null
     */
    async getBySlug(slug: string, contentType: string): Promise<IDraftContents | null> {
        try {
            const collectionRef = this.getCollectionRef(contentType);
            const q = runInInjectionContext(this.injector, () => query(collectionRef, where('urlSlug', '==', slug), limit(1)));
            const querySnapshot = await runInInjectionContext(this.injector, () => getDocs(q));

            if (querySnapshot.empty) {
                return null;
            }

            const docSnap = querySnapshot.docs[0];
            return { ...(docSnap.data() as unknown as Record<string, unknown>), id: docSnap.id } as IDraftContents;
        } catch (error) {
            console.error('Error fetching content by slug:', error);
            return null;
        }
    }

    /**
     * Get all content items of a specific type
     * @param contentType The content type slug to filter by
     * @param excludeId Optional ID to exclude from results (for current content)
     * @returns Promise with array of content items
     */
    async getContentsByType(contentType: string, excludeId?: string): Promise<IDraftContents[]> {
        try {
            // Now we just query the specific collection for that type
            const collectionRef = this.getCollectionRef(contentType);
            const q = runInInjectionContext(this.injector, () => query(
                collectionRef,
                orderBy('title', 'asc')
            ));
            const querySnapshot = await runInInjectionContext(this.injector, () => getDocs(q));

            const contents: IDraftContents[] = [];
            querySnapshot.forEach((docSnap) => {
                const data = docSnap.data() as IDraftContents;
                // Exclude the current content from the list
                if (!excludeId || data.id !== excludeId) {
                    contents.push({ ...(data as unknown as Record<string, unknown>), id: docSnap.id } as IDraftContents);
                }
            });

            return contents;
        } catch (error) {
            console.error('Error fetching contents by type:', error);
            return [];
        }
    }

    /**
     * Refreshes the copy of an entry kept in other entries' Next links after
     * its title, summary or slug changed. Entries whose copy already matches
     * are left alone, so a save that renames nothing marks nothing edited.
     * @param contentId The ID of the content that was updated
     * @param updatedData The new title, summary, and slug values
     * @param contentType The content type slug; links stay within one type
     */
    async updateNextContentReferences(
        contentId: string,
        updatedData: { title: string; summary: string; slug: string },
        contentType: string
    ): Promise<void> {
        return this.refreshSeriesReferences('nextContent', contentId, updatedData, contentType);
    }

    /**
     * The same as updateNextContentReferences, for the copy kept in other
     * entries' Previous links.
     */
    async updatePreviousContentReferences(
        contentId: string,
        updatedData: { title: string; summary: string; slug: string },
        contentType: string
    ): Promise<void> {
        return this.refreshSeriesReferences('previousContent', contentId, updatedData, contentType);
    }

    private async refreshSeriesReferences(
        field: SeriesField,
        contentId: string,
        updatedData: { title: string; summary: string; slug: string },
        contentType: string
    ): Promise<void> {
        if (!isRealId(contentId)) return;
        const owner: INextContentReference = { id: contentId, ...updatedData };
        try {
            const collectionRef = this.getCollectionRef(contentType);
            const q = runInInjectionContext(this.injector, () => query(collectionRef, where(`${field}.id`, '==', contentId)));
            const querySnapshot = await runInInjectionContext(this.injector, () => getDocs(q));

            const stale = querySnapshot.docs.filter(
                (docSnap) => refreshedReference((docSnap.data() as SeriesLinks)[field], owner) !== undefined,
            );
            if (stale.length === 0) return;

            // Chunked to stay under Firestore's 500 operations per batch.
            const MAX_BATCH_OPS = 400;
            for (let i = 0; i < stale.length; i += MAX_BATCH_OPS) {
                const chunk = stale.slice(i, i + MAX_BATCH_OPS);
                const batch = runInInjectionContext(this.injector, () => writeBatch(this.firestore));

                for (const docSnap of chunk) {
                    const docRef = runInInjectionContext(this.injector, () => doc(collectionRef, docSnap.id));
                    batch.update(docRef, {
                        [field]: { ...owner },
                        modifiedAt: new Date()
                    });
                }

                await runInInjectionContext(this.injector, () => batch.commit());
            }
        } catch (error) {
            console.error(`Error updating ${field} references:`, error);
            throw error;
        }
    }

    /**
     * Applies the backlink changes one save asks for (see planBacklinks):
     * each target is read and written in its own transaction, so a Previous or
     * Next an editor set by hand in the meantime is seen and kept. A missing
     * target is skipped. The changed entry's draft is marked edited; its page
     * shows the new link once it is published again.
     * @returns the ids of the entries that changed, and the changes that
     * failed, so the editor can ask for them again on its next save
     */
    async applyBacklinks(
        contentType: string,
        owner: INextContentReference,
        changes: BacklinkChange[],
    ): Promise<BacklinkResult> {
        const changed: string[] = [];
        const failed: BacklinkChange[] = [];
        if (!isRealId(owner.id) || changes.length === 0) return { changed, failed };
        const collectionRef = this.getCollectionRef(contentType);
        for (const change of changes) {
            try {
                const docRef = runInInjectionContext(this.injector, () => doc(collectionRef, change.targetId));
                const wrote = await runInInjectionContext(this.injector, () => runTransaction(this.firestore, async (transaction) => {
                    const snap = await transaction.get(docRef);
                    if (!snap.exists()) return false;
                    const current = (snap.data() as SeriesLinks)[change.field];
                    const next = backlinkValue(current, change.action, owner);
                    if (next === undefined) return false;
                    transaction.update(docRef, { [change.field]: next, modifiedAt: new Date() });
                    return true;
                }));
                if (wrote) changed.push(change.targetId);
            } catch (error) {
                // One target failing must not stop the others.
                console.error(`Error updating ${change.field} of ${change.targetId}:`, error);
                failed.push(change);
            }
        }
        return { changed, failed };
    }

    /**
     * The link copy an entry should store for another entry of the type, from
     * that entry as it is now: its current title, meta description and slug.
     * Null when the entry no longer exists or the id is a placeholder. A read
     * that fails throws, so a caller never mistakes it for a deleted entry.
     */
    async currentSeriesReference(contentType: string, id: string): Promise<INextContentReference | null> {
        if (!isRealId(id)) return null;
        const ref = runInInjectionContext(this.injector, () => doc(this.getCollectionRef(contentType), id));
        const snap = await runInInjectionContext(this.injector, () => getDoc(ref));
        if (!snap.exists()) return null;
        return seriesReference(id, snap.data() as IDraftContents);
    }
}
