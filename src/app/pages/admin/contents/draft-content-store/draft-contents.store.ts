import { Injectable, inject } from '@angular/core';
import { createGenericStore } from '../../../../../shared/services/generic-store.service';
import { IDraftContents } from './draft-contents.model';
import { DraftContentsService } from './draft-contents.service';

const DraftContentsStoreBase = createGenericStore<IDraftContents>(DraftContentsService);

@Injectable({ providedIn: 'root' })
export class DraftContentsStore extends DraftContentsStoreBase {
    private draftService = inject(DraftContentsService);

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
}
