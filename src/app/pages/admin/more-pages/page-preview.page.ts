import { ChangeDetectionStrategy, Component, OnDestroy, effect, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { PageTextService, type PageTextSession } from '../../../core/site/page-text.service';
import { PAGE_TEXT_PREVIEW, type PageTextPreview } from '../../../core/site/page-text-preview';
import HomeComponent from '../../index.page';
import { PublicPageRendererComponent } from '../../public-page-renderer/public-page-renderer.component';
import { PageCardDrafts } from '../../page.parts/card-draft';
import { ContentListComponent } from '../../page.parts/content-list.component';
import { PageCardsSource } from './page-cards';
import { pageIdOf, type PageRef } from './page-ref';

/**
 * The Visual Editor's frame (`?edit=1`) draws each card with unpublished changes from
 * its draft (VE-D53); so does Live Preview opened from the Visual Editor (`?cards=1`),
 * as its one Publish would put them out.
 */
function pageCardsWithDrafts(): PageCardDrafts | null {
    const query = inject(ActivatedRoute).snapshot.queryParamMap;
    const editing = query?.get('edit') === '1';
    if (!editing && query?.get('cards') !== '1') return null;
    const source = inject(PageCardsSource);
    source.editing = editing;
    return source;
}

/** The page the preview's address names: the parameters are the ones each page's own renderer reads. */
function previewedPage(params: { get(key: string): string | null }): PageRef {
    const type = params.get('contentTypeSlug');
    if (type) return { kind: 'list', name: type };
    const name = params.get('fileName');
    return name ? { kind: 'static', name } : { kind: 'home', name: '' };
}

/**
 * Live Preview of the home page, a static page or a list page (specs/visual-editing-spec.md,
 * VE-D50, VE-D65): the page as the site draws it, filled with the draft's values. Every
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
    imports: [HomeComponent, PublicPageRendererComponent, ContentListComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    providers: [
        { provide: PAGE_TEXT_PREVIEW, useExisting: PagePreviewPage },
        PageCardsSource,
        { provide: PageCardDrafts, useFactory: pageCardsWithDrafts },
    ],
    template: `
        @for (drawn of drawing(); track drawn) {
            @switch (page.kind) {
                @case ('home') { <arc-home></arc-home> }
                @case ('list') { <arc-content-list></arc-content-list> }
                @default { <app-public-page-renderer></app-public-page-renderer> }
            }
        }
    `,
})
export default class PagePreviewPage implements PageTextPreview, OnDestroy {
    private route = inject(ActivatedRoute);
    private pageText = inject(PageTextService);
    readonly page = previewedPage(this.route.snapshot.paramMap);
    /** The Visual Editor's frame (`?edit=1`): drawn once; the screen then changes the page in place. */
    readonly editing = this.route.snapshot.queryParamMap?.get('edit') === '1';
    private readonly pageId = pageIdOf(this.page);
    private session: PageTextSession = this.pageText.session(this.pageId);
    /** One number per drawing: a new one draws the page again with the draft as it is then. */
    readonly drawing = signal<number[]>([]);
    private drawn = 0;

    constructor() {
        this.session.open();
        // The frame, or Live Preview from the Visual Editor: the cards' drafts on this page are followed.
        if (inject(PageCardDrafts, { optional: true })) inject(PageCardsSource).start(this.pageId);
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
