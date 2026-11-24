import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TranslocoPipe } from '@jsverse/transloco';

/**
 * How a page looks in a search engine's results and when its link is shared
 * (specs/visual-editing-spec.md, VE-D69): the same on an entry, an HTML page and a
 * list page, drawn from what will go out.
 */
@Component({
    selector: 'arc-share-preview',
    standalone: true,
    imports: [TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <span class="preview-label">{{ 'admin.edit_page.search_preview' | transloco }}</span>
        <div class="search" data-testid="search-preview">
            <div class="search-url">{{ url() }}</div>
            <div class="search-title">{{ shownTitle() }}</div>
            <div class="search-text">{{ description() || ('admin.edit_page.no_description' | transloco) }}</div>
        </div>
        <span class="preview-label">{{ 'admin.edit_page.share_preview' | transloco }}</span>
        <div class="share" data-testid="share-preview">
            @if (image()) { <img class="share-image" [src]="image()" alt=""> }
            @else { <div class="share-none">{{ 'admin.edit_page.no_share_image' | transloco }}</div> }
            <div class="share-body">
                <div class="share-host">{{ host() }}</div>
                <div class="share-title">{{ shownTitle() }}</div>
                @if (description()) { <div class="share-text">{{ description() }}</div> }
            </div>
        </div>
        <p class="text-muted small mt-2 mb-0">{{ 'admin.edit_page.preview_note' | transloco }}</p>
    `,
    styles: [`
        :host { display: block; }
        .preview-label { display: block; font-size: .85rem; font-weight: 600; margin: 12px 0 6px; }
        .search, .share { border: 1px solid #e1e8ed; border-radius: 10px; background: #fff; overflow: hidden; }
        .search { padding: 10px 12px; }
        .search-url, .share-host { font-size: .7rem; color: #5c636a; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .search-title { color: #1a0dab; font-size: 1rem; line-height: 1.3; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
        .search-text, .share-text { font-size: .78rem; color: #4d5156; line-height: 1.4; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .share-image { display: block; width: 100%; height: 140px; object-fit: cover; }
        .share-none { height: 80px; display: flex; align-items: center; justify-content: center; background: #f5f8fa; color: #5c636a; font-size: .78rem; }
        .share-body { padding: 8px 12px 10px; }
        .share-title { font-size: .875rem; font-weight: 600; color: #14171a; line-height: 1.3; overflow-wrap: anywhere; }
    `],
})
export class SharePreviewComponent {
    readonly title = input('');
    readonly description = input('');
    readonly image = input('');
    /** The page's full public address. */
    readonly url = input('');
    readonly host = computed(() => {
        try {
            return new URL(this.url()).host;
        } catch {
            return this.url();
        }
    });
    readonly shownTitle = computed(() => this.title() || this.host());
}
