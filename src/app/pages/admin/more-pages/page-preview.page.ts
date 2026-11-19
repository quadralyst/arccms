import { ChangeDetectionStrategy, Component, OnDestroy, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PageTextService, type PageTextSession } from '../../../core/site/page-text.service';
import { PAGE_TEXT_PREVIEW, type PageTextPreview } from '../../../core/site/page-text-preview';
import { pageTextId } from '../../../core/utils/page-text-model';
import HomeComponent from '../../index.page';
import { PublicPageRendererComponent } from '../../public-page-renderer/public-page-renderer.component';
import { PageCardDrafts } from '../../page.parts/card-draft';
import { PageCardsSource } from './page-cards';

/** The Visual Editor's frame (`?edit=1`) draws each card with unpublished changes from its draft (VE-D53). */
function pageCardsInEditMode(): PageCardDrafts | null {
    return inject(ActivatedRoute).snapshot.queryParamMap?.get('edit') === '1' ? inject(PageCardsSource) : null;
}

/**
 * Live Preview of the home page or a static page (specs/visual-editing-spec.md,
 * VE-D50): the page as the site draws it, filled with the draft's values. Every
 * field of the classic editor saves on its own, so the window follows the draft
 * in Firestore and draws the page again after each save.
 *
 * The Visual Editor loads it in its frame with `?edit=1` (VE-D49, VE-D55): drawn
 * once, with the marks kept and the page's scripts off; the screen changes the
 * page in place from then on, so it never jumps under the person editing it.
 */
@Component({
    selector: 'arc-page-preview',
    standalone: true,
    imports: [HomeComponent, PublicPageRendererComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        { provide: PAGE_TEXT_PREVIEW, useExisting: PagePreviewPage },
        PageCardsSource,
        { provide: PageCardDrafts, useFactory: pageCardsInEditMode },
    ],
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
    /** The Visual Editor's frame (`?edit=1`): drawn once; the screen then changes the page in place. */
    readonly editing = this.route.snapshot.queryParamMap?.get('edit') === '1';
    private readonly pageId = this.isHome ? pageTextId.home() : pageTextId.staticPage(this.route.snapshot.paramMap.get('fileName') || '');
    private session: PageTextSession = this.pageText.session(this.pageId);
    /** One number per drawing: a new one draws the page again with the draft as it is then. */
    readonly drawing = signal<number[]>([]);
    private drawn = 0;

    constructor() {
        this.session.open();
        if (this.editing) inject(PageCardsSource).start(this.pageId);
        effect(() => {
            if (!this.session.loaded()) return;
            this.session.draft();
            if (this.editing && this.drawn > 0) return;
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
