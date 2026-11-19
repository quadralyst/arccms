import { ChangeDetectionStrategy, Component, OnDestroy, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PageTextService, type PageTextSession } from '../../../core/site/page-text.service';
import { PAGE_TEXT_PREVIEW, type PageTextPreview } from '../../../core/site/page-text-preview';
import { pageTextId } from '../../../core/utils/page-text-model';
import HomeComponent from '../../index.page';
import { PublicPageRendererComponent } from '../../public-page-renderer/public-page-renderer.component';

/**
 * Live Preview of the home page or a static page (specs/visual-editing-spec.md,
 * VE-D50): the page as the site draws it, filled with the draft's values. Every
 * field of the classic editor saves on its own, so the window follows the draft
 * in Firestore and draws the page again after each save.
 */
@Component({
    selector: 'arc-page-preview',
    standalone: true,
    imports: [HomeComponent, PublicPageRendererComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [{ provide: PAGE_TEXT_PREVIEW, useExisting: PagePreviewPage }],
    template: `
        @for (drawn of drawing(); track drawn) {
            @if (isHome) { <arc-home></arc-home> } @else { <app-public-page-renderer></app-public-page-renderer> }
        }
    `,
})
export default class PagePreviewPage implements PageTextPreview, OnDestroy {
    private route = inject(ActivatedRoute);
    private pageText = inject(PageTextService);
    readonly isHome = !this.route.snapshot.paramMap.get('fileName');
    private session: PageTextSession = this.pageText.session(
        this.isHome ? pageTextId.home() : pageTextId.staticPage(this.route.snapshot.paramMap.get('fileName') || ''),
    );
    /** One number per drawing: a new one draws the page again with the draft as it is then. */
    readonly drawing = signal<number[]>([]);
    private drawn = 0;

    constructor() {
        this.session.open();
        effect(() => {
            if (!this.session.loaded()) return;
            this.session.draft();
            this.drawing.set([++this.drawn]);
        });
    }

    values() {
        return this.session.draft();
    }

    ngOnDestroy(): void {
        this.session.close();
    }
}
