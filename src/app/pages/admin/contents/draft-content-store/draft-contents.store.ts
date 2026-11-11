import { Injectable, inject } from '@angular/core';
import { createGenericStore } from '../../../../../shared/services/generic-store.service';
import { IDraftContents, INextContentReference } from './draft-contents.model';
import { DraftContentsService } from './draft-contents.service';
import { BacklinkChange, BacklinkResult } from './series-links';
import { Observable, defer } from 'rxjs';
import { WritableStateSource, patchState } from '@ngrx/signals';
import { AuthState } from '../../../(auth)/auth.store';

const DraftContentsStoreBase = createGenericStore<IDraftContents>(DraftContentsService);

@Injectable({ providedIn: 'root' })
export class DraftContentsStore extends DraftContentsStoreBase {
    private draftService = inject(DraftContentsService);
    private authState = inject(AuthState);

    /**
     * Writes a new entry and emits its id; a failure is an error, never an
     * empty id (RF4 4.1, 4.4). `data` may carry its own createdAt and modifiedAt.
     */
    createDraft(data: Record<string, unknown>, contentType: string, id?: string): Observable<string> {
        const userId = this.authState.currentUser()?.id || '';
        return defer(() => this.draftService.createDraft(contentType, { ...data, createdBy: userId, modifiedBy: userId }, id));
    }

    /** An id for a new entry, chosen before its first write (see DraftContentsService.newDraftId). */
    newDraftId(contentType: string): string {
        return this.draftService.newDraftId(contentType);
    }

    /**
     * Makes an entry the editor has just created the current item, as if it
     * had been loaded, so a later publish and the reference sync compare with
     * what is stored (RF4 review M4).
     */
    adoptCreated(item: IDraftContents): void {
        patchState(this as unknown as WritableStateSource<{ currentItem: IDraftContents }>, { currentItem: item });
    }

    /**
     * Saves an entry's changes, refused with an EntryChangedError when the
     * stored entry no longer carries `openedModifiedAt` (null: overwrite).
     * A failure is an error (RF4 4.4, 4.5).
     */
    saveDraft(id: string, data: Record<string, unknown>, contentType: string, openedModifiedAt: unknown): Observable<void> {
        const modifiedBy = this.authState.currentUser()?.id || '';
        return defer(() => this.draftService.saveDraft(contentType, id, { ...data, modifiedBy }, openedModifiedAt));
    }

    /** Whether another entry of the type has this address, asked of the server (RF4 4.6). */
    isSlugTaken(slug: string, contentType: string, ownId?: string): Promise<boolean> {
        return this.draftService.isSlugTaken(slug, contentType, ownId);
    }

    /** The address of the entry's live page, '' when it has none. */
    publishedSlug(contentType: string, id: string): Promise<string> {
        return this.draftService.publishedSlug(contentType, id);
    }

    /** How many entries of the type carry a tag. */
    countWithTag(contentType: string, label: string): Promise<number> {
        return this.draftService.countWithTag(contentType, label);
    }

    /**
     * Check if a URL slug already exists
     */
    async checkExistingSlugUrl(slug: string, contentType: string): Promise<{ exists: boolean; slug: string }> {
        return this.draftService.checkExistingSlugUrl(slug, contentType);
    }

    /**
     * Get content item by slug
     */
    async getBySlug(slug: string, contentType: string): Promise<IDraftContents | null> {
        return this.draftService.getBySlug(slug, contentType);
    }

    /**
     * Get all content items of a specific type
     * @param contentType The content type slug to filter by
     * @param excludeId Optional ID to exclude from results (for current content)
     */
    async getContentsByType(contentType: string, excludeId?: string): Promise<IDraftContents[]> {
        return this.draftService.getContentsByType(contentType, excludeId);
    }

    /**
     * Update all content items that reference a specific content as their "nextContent"
     * @param contentId The ID of the content that was updated
     * @param updatedData The new title, summary, and slug values
     * @param contentType The content type slug
     */
    async updateNextContentReferences(
        contentId: string,
        updatedData: { title: string; summary: string; slug: string },
        contentType: string
    ): Promise<void> {
        return this.draftService.updateNextContentReferences(contentId, updatedData, contentType);
    }

    /**
     * Update all content items that reference a specific content as their "previousContent"
     * @param contentId The ID of the content that was updated
     * @param updatedData The new title, summary, and slug values
     * @param contentType The content type slug
     */
    async updatePreviousContentReferences(
        contentId: string,
        updatedData: { title: string; summary: string; slug: string },
        contentType: string
    ): Promise<void> {
        return this.draftService.updatePreviousContentReferences(contentId, updatedData, contentType);
    }

    /**
     * Points other entries' Previous or Next back at a saved entry, or clears
     * them, by the rules in series-links.ts. Resolves to the ids that changed
     * and the changes that failed.
     */
    async applyBacklinks(
        contentType: string,
        owner: INextContentReference,
        changes: BacklinkChange[],
    ): Promise<BacklinkResult> {
        return this.draftService.applyBacklinks(contentType, owner, changes);
    }

    /**
     * The link copy for another entry of the type as it is now, or null when
     * it no longer exists. Throws when the read fails.
     */
    async currentSeriesReference(contentType: string, id: string): Promise<INextContentReference | null> {
        return this.draftService.currentSeriesReference(contentType, id);
    }
}
