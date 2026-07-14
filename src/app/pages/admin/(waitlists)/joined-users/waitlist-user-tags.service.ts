import { Injectable, inject, signal, runInInjectionContext } from '@angular/core';
import { collection, CollectionReference, Firestore } from '@angular/fire/firestore';
import { DbService } from '../../../../../shared/services/db.service';
import { IWaitlistUserTag, getWaitlistUserTagsCollectionName } from './waitlist-user-tags.model';

/**
 * Waitlist user tags service with dynamic collection based on waitlist
 * Each waitlist has its own tags collection: WaitlistUserTags_{waitlistId}
 */
@Injectable({
    providedIn: 'root',
})
export class WaitlistUserTagsService extends DbService<IWaitlistUserTag> {
    private currentWaitlistId = signal<string>('');
    private tagFirestore = inject(Firestore);

    constructor() {
        // Initialize with default collection name, will be set dynamically
        super('WaitlistUserTags');
    }

    /**
     * Set the waitlist ID to scope tag operations
     * This updates the collection to WaitlistUserTags_{waitlistId}
     */
    setWaitlistId(waitlistId: string): void {
        this.currentWaitlistId.set(waitlistId);
        const collName = getWaitlistUserTagsCollectionName(waitlistId);
        // Update the dbCollection reference to point to the new collection
        this.dbCollection = runInInjectionContext(this.injector, () => collection(this.tagFirestore, collName)) as CollectionReference<IWaitlistUserTag>;
    }

    /**
     * Get the current waitlist ID
     */
    getWaitlistId(): string {
        return this.currentWaitlistId();
    }

    /**
     * Check if a tag label already exists for the current waitlist
     */
    async checkDuplicateLabel(label: string, excludeId?: string): Promise<boolean> {
        const result = await new Promise<IWaitlistUserTag[]>((resolve) => {
            this.getAll({ limitCount: 1000, currentPageNumber: 0, previousPageNumber: -1 }).subscribe({
                next: (res) => resolve(res.collectionData),
                error: () => resolve([]),
            });
        });
        return result.some(
            (tag: IWaitlistUserTag) => tag.label.toLowerCase() === label.toLowerCase() && tag.id !== excludeId
        );
    }
}
