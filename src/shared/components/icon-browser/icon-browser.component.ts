/**
 * Browsable icon grid — the Icons tab in the Media Manager.
 *
 * Distinct from `arc-icon-picker`, which is a compact typeahead bound to a
 * form control and yields a class string. This one fills a pane, filters by
 * style, and yields a full `ArcIcon` token with the inline-SVG fallback
 * attached. They share `IconLibraryService`, which is where the data and the
 * ranking actually live.
 *
 * The grid previews each icon with the Font Awesome webfont the admin already
 * loads, so browsing 1,873 icons costs one 48KB-gzipped index fetch and no
 * path data at all.
 */

import { ChangeDetectionStrategy, Component, inject, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { ArcIcon, FaIconStyle, FaIndex, FaIndexEntry, FA_STYLES } from '../../models/icon.model';
import { IconLibraryService, IconSearchResult } from '../../services/icon-library.service';

/** How many results the grid renders at once. */
const PAGE_SIZE = 120;

@Component({
    selector: 'arc-icon-browser',
    standalone: true,
    imports: [FormsModule, TranslocoPipe],
    templateUrl: './icon-browser.component.html',
    styleUrl: './icon-browser.component.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class IconBrowserComponent implements OnInit {
    private icons = inject(IconLibraryService);

    /** Fires whenever the highlighted icon changes, with the built token. */
    readonly iconSelected = output<ArcIcon | null>();

    readonly styles = FA_STYLES;
    readonly searchTerm = signal('');
    readonly activeStyle = signal<FaIconStyle | 'all'>('all');
    readonly results = signal<IconSearchResult[]>([]);
    readonly loading = signal(true);
    readonly failed = signal(false);
    readonly selectedKey = signal<string | null>(null);
    readonly shownCount = signal(PAGE_SIZE);
    readonly totalMatches = signal(0);

    private index: FaIndex | null = null;

    async ngOnInit(): Promise<void> {
        this.index = await this.icons.loadIndex();
        this.loading.set(false);
        this.failed.set(this.index === null);
        this.refresh();
    }

    onSearchChange(term: string): void {
        this.searchTerm.set(term);
        this.shownCount.set(PAGE_SIZE);
        this.refresh();
    }

    setStyle(style: FaIconStyle | 'all'): void {
        this.activeStyle.set(style);
        this.shownCount.set(PAGE_SIZE);
        this.refresh();
    }

    showMore(): void {
        this.shownCount.update((n) => n + PAGE_SIZE);
        this.refresh();
    }

    /**
     * Selecting resolves the path data, so the token carries its SVG
     * fallback. The highlight is set first and the token emitted after: the
     * first pick of a style waits on a path fetch, and a grid that only
     * responds once that lands feels broken.
     */
    async select(result: IconSearchResult): Promise<void> {
        this.selectedKey.set(this.keyFor(result));
        const token = await this.icons.buildToken(result.entry, result.style);
        // Ignore a token that lost the race to a later click.
        if (this.selectedKey() === this.keyFor(result)) {
            this.iconSelected.emit(token);
        }
    }

    /** Unique per name+style, since one icon can appear in several styles. */
    keyFor(result: IconSearchResult): string {
        return `${result.style}:${result.entry.n}`;
    }

    trackByKey = (_: number, result: IconSearchResult) => this.keyFor(result);

    /**
     * Ranks every match, then renders a window of it.
     *
     * Ranking the full set on each keystroke is not the waste it looks like:
     * `search` already walks all 1,873 entries to filter, so the only extra
     * cost is sorting ~2,000 items. It buys an honest match count for the
     * "showing 120 of 431" line, which a limit-capped search cannot give.
     */
    private refresh(): void {
        const matches = this.icons.search(this.index, this.searchTerm(), this.activeStyle());
        this.totalMatches.set(matches.length);
        this.results.set(matches.slice(0, this.shownCount()));
    }

    /** True while more results exist beyond the current window. */
    hasMore(): boolean {
        return this.totalMatches() > this.results().length;
    }

    /** The display label for an entry, used as the grid tooltip. */
    labelFor(entry: FaIndexEntry): string {
        return entry.l;
    }
}
