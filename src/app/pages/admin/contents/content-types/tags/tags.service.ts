import { Injectable, inject, signal, runInInjectionContext } from '@angular/core';
import { collection, CollectionReference, Firestore } from '@angular/fire/firestore';
import { DbService } from '../../../../../../shared/services/db.service';
import { ITag, getTagsCollectionName } from './tags.model';

/**
 * Tags service with dynamic collection based on content type
 * Each content type has its own tags collection: Tags_{contentTypeSlug}
 */
@Injectable({
    providedIn: 'root',
})
export class TagsService extends DbService<ITag> {
    private currentContentTypeSlug = signal<string>('');
    private tagFirestore = inject(Firestore);

    constructor() {
        // Initialize with default collection name, will be set dynamically
        super('Tags');
    }

    /**
     * Set the content type slug to scope tag operations
     * This updates the collection to Tags_{contentTypeSlug}
     */
    setContentTypeSlug(slug: string): void {
        this.currentContentTypeSlug.set(slug);
        const collName = getTagsCollectionName(slug);
        // Update the dbCollection reference to point to the new collection
        this.dbCollection = runInInjectionContext(this.injector, () => collection(this.tagFirestore, collName)) as CollectionReference<ITag>;
    }

    /**
     * Get the current content type slug
     */
    getContentTypeSlug(): string {
        return this.currentContentTypeSlug();
    }

    /**
     * Check if a tag label already exists for the current content type
     */
    async checkDuplicateLabel(label: string, excludeId?: string): Promise<boolean> {
        // Get all tags using a synchronous query instead of async getAll
        const result = await new Promise<ITag[]>((resolve) => {
            this.getAll({ limitCount: 1000, currentPageNumber: 0, previousPageNumber: -1 }).subscribe({
                next: (res) => resolve(res.collectionData),
                error: () => resolve([]),
            });
        });
        return result.some(
            (tag: ITag) => tag.label.toLowerCase() === label.toLowerCase() && tag.id !== excludeId
        );
    }
}
