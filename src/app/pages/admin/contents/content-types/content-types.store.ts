import { Injectable, inject } from '@angular/core';
import { ContentTypesService } from './content-types.service';
import { createGenericStore } from '../../../../../shared/services/generic-store.service';
import { ContentType } from './content-types.model';

/**
 * Content types are never paginated in the store.
 *
 * The store is a root singleton, and far more of the admin reads it than the
 * list page that used to drive it: the content editor resolves a type's custom
 * fields out of `items()`, as do the drafts table and the side navigation. With
 * the generic default of ten, visiting the list page left the singleton holding
 * only its first page — and every content type outside that window silently
 * rendered *no custom fields at all* when adding or editing its content.
 *
 * `limit: 0` means no Firestore limit (see `DbService.getAll`). A site has tens
 * of content types, not thousands, so fetching the lot is cheaper than the
 * cursor bookkeeping it replaces; the list page slices for display.
 */
const ContentTypesStoreBase = createGenericStore<ContentType>(ContentTypesService, { limit: 0 });

@Injectable({
    providedIn: 'root'
})
export class ContentTypesStore extends ContentTypesStoreBase {
    private contentTypesService = inject(ContentTypesService);

    /**
     * Check if a URL slug already exists
     */
    async checkExistingSlugUrl(slug: string): Promise<{ exists: boolean; slug: string }> {
        return this.contentTypesService.checkExistingSlugUrl(slug);
    }
}
