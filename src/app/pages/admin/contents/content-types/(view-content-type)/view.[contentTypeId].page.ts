import { RouteMeta } from '@analogjs/router';
import { SiteBrandService } from '../../../../../core/brand/site-brand';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, ChangeDetectorRef, Component, EventEmitter, inject, Input, input, Output } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { BaseComponent } from '../../../../../../shared/components/base/base.component';
import { ContentType } from '../content-types.model';
import { ContentTypesStore } from '../content-types.store';
import { roleGuard } from '../../../../../guards/role.guard';
import { templateReference, type TemplateRefSection } from '../../../../../../shared/utils/template-reference';

export const routeMeta: RouteMeta = {
    title: 'View Content Type',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
    providers: [],
};

import { layoutLabel, siteLayouts, siteManifest } from '../../../../../core/site/site';
@Component({
    selector: 'arc-view-content-type',
    standalone: true,
    imports: [CommonModule, MatIconModule],
    templateUrl: './view-content-type.html',
    styleUrl: './view-content-type.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ViewContentTypeComponent extends BaseComponent {
    /** The site's name for the footer (core/brand/site-brand.ts). */
    readonly siteName = inject(SiteBrandService).name;
    @Output() close = new EventEmitter();
    contentTypesStore = inject(ContentTypesStore);
    action = input('action');
    currentItem: ContentType | null = null;

    #id = '';
    @Input()
    get id(): string {
        return this.#id;
    }
    set id(newValue: string) {
        this.#id = newValue;

        if (this.id) {
            this.currentItem = this.contentTypesStore.get(this.id);
        }
    }

    closeView() {
        this.close.emit();
    }

    /** Copy a template attribute syntax to the clipboard */
    copiedKey: string | null = null;
    private cdr = inject(ChangeDetectorRef);

    /**
     * Where a content type's templates come from, for the Template row: the app's
     * own folder (src/custom/site/templates/), an Arc CMS folder, or the default
     * because the site has no folder of that name.
     */
    templateSource(folder: string | null | undefined): { path: string; missing: boolean } | null {
        if (!folder || folder === 'default') return null;
        const files = siteManifest().templates[folder];
        if (!files) return { path: `templates/${folder}`, missing: true };
        const own = Object.values(files).includes('app');
        return { path: own ? `src/custom/site/templates/${folder}` : `public/_site/templates/${folder}`, missing: false };
    }
    /** The layouts the type's folder offers (SS8), for the Layouts row; none for most types. */
    layoutsOf(folder: string | null | undefined): { name: string; label: string }[] {
        return siteLayouts(folder).map((name) => ({ name, label: layoutLabel(name) }));
    }

    copyToClipboard(syntax: string, key: string) {
        navigator.clipboard.writeText(syntax).then(() => {
            this.copiedKey = key;
            this.cdr.markForCheck();
            setTimeout(() => {
                this.copiedKey = null;
                this.cdr.markForCheck();
            }, 1500);
        });
    }

    /** What this type's templates can bind, page by page (src/shared/utils/template-reference.ts). */
    get referenceSections(): TemplateRefSection[] {
        if (!this.currentItem) return [];
        return templateReference(this.currentItem.slug, this.currentItem.fields || []);
    }
}
