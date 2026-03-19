import { Injectable, inject } from '@angular/core';
import { ContentTypesService } from './content-types.service';
import { createGenericStore } from '../../../../../shared/services/generic-store.service';
import { ContentType } from './content-types.model';

const ContentTypesStoreBase = createGenericStore<ContentType>(ContentTypesService);

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
