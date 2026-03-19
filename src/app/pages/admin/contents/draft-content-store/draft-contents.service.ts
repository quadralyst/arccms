import { Injectable } from '@angular/core';
import { CollectionReference, collection, getDocs, query, where, limit, doc, writeBatch, orderBy } from '@angular/fire/firestore';
import { DbService } from '../../../../../shared/services/db.service';
import { IDraftContents, INextContentReference } from './draft-contents.model';

@Injectable({
    providedIn: 'root'
})
export class DraftContentsService extends DbService<IDraftContents> {

    constructor() {
        super('DraftContents'); // Default fallback
    }

    override getCollectionRef(collectionSuffix?: string): CollectionReference<IDraftContents> {
        if (collectionSuffix) {
            return collection(this.firestore, `arc_${collectionSuffix}_drafts`) as CollectionReference<IDraftContents>;
        }
        return super.getCollectionRef();
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
            const q = query(collectionRef, where('urlSlug', '==', slug), limit(1));
            const querySnapshot = await getDocs(q);

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
            const q = query(collectionRef, where('urlSlug', '==', slug), limit(1));
            const querySnapshot = await getDocs(q);

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
            const q = query(
                collectionRef,
                orderBy('title', 'asc')
            );
            const querySnapshot = await getDocs(q);

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
     * Update all content items that reference a specific content as their "nextContent"
     * This is called when a content's title, summary, or slug changes
     * @param contentId The ID of the content that was updated
     * @param updatedData The new title, summary, and slug values
     * @param contentType The content type of the updated content (assuming references are in same type or we need to know where to look)
     */
    async updateNextContentReferences(
        contentId: string,
        updatedData: { title: string; summary: string; slug: string },
        contentType: string
    ): Promise<void> {
        try {
            // For now, assume nextContent links are within the same content type collection
            const collectionRef = this.getCollectionRef(contentType);
            // Query for all documents that have this content as their nextContent
            const q = query(collectionRef, where('nextContent.id', '==', contentId));
            const querySnapshot = await getDocs(q);

            if (querySnapshot.empty) {
                return;
            }

            // Use batch writes with chunking to stay under Firestore's 500 operation limit
            const MAX_BATCH_OPS = 400;
            const docs = querySnapshot.docs;
            for (let i = 0; i < docs.length; i += MAX_BATCH_OPS) {
                const chunk = docs.slice(i, i + MAX_BATCH_OPS);
                const batch = writeBatch(this.firestore);

                for (const docSnap of chunk) {
                    const docRef = doc(collectionRef, docSnap.id);
                    const updatedNextContent: INextContentReference = {
                        id: contentId,
                        title: updatedData.title,
                        summary: updatedData.summary,
                        slug: updatedData.slug
                    };
                    batch.update(docRef, {
                        nextContent: updatedNextContent,
                        modifiedAt: new Date()
                    });
                }

                await batch.commit();
            }
        } catch (error) {
            console.error('Error updating next content references:', error);
            throw error;
        }
    }
}
