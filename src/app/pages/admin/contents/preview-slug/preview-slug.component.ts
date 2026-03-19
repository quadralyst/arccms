import { DatePipe } from '@angular/common';
import { Component, computed, effect, inject } from '@angular/core';
import { SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute } from '@angular/router';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';

@Component({
    selector: 'arc-preview-slug',
    standalone: true,
    imports: [DatePipe],
    templateUrl: './preview-slug.component.html',
    styleUrl: './preview-slug.component.scss',
})
export class PreviewSlugComponent extends BaseComponent {
    safeContent: SafeHtml = '';
    fullUrl: string = '';
    isSlugUrlAvailable: boolean = true;

    public draftStore = inject(DraftContentsStore);

    contentDetailedData: any = computed(() => {
        return this.draftStore.currentItem();
    });

    constructor(private route: ActivatedRoute) {
        super();
        effect(() => {
            this.contentDetailedData();
            if (this.isEmpty(this.contentDetailedData()) && !this.draftStore.isLoading()) {
                this.isSlugUrlAvailable = false;
            } else {
                this.isSlugUrlAvailable = true;
            }
        });
    }

    ngOnInit() {
        this.route.paramMap.subscribe((params) => {
            const slug = params.get('slug');
            if (typeof window !== 'undefined') {
                this.fullUrl = `${window.location.origin}/preview-content/${slug}`;
            }

            if (slug) {
                this.draftStore.getByCustomField('urlSlug', '==', slug);
            }
        });
    }

    isEmpty(obj: any): boolean {
        return Object.keys(obj).length === 0;
    }

    getSafeString() {
        const modifiedContent = this.contentDetailedData()?.content?.replace(/color: rgb\(243, 244, 245\)/g, 'color: #000');
        return this.sanitizer.bypassSecurityTrustHtml(modifiedContent || '');
    }
}
