/**
 * Type-ahead search box.
 *
 * One component for every search on the site: the admin header, the public
 * header in the SPA, and any page built on a custom source. It owns the
 * keystroke timing (250 ms debounce, two-character minimum), the dropdown,
 * keyboard navigation and the highlighting of matched text; the
 * SearchService owns the network and the cache.
 *
 * Strings are inputs rather than translation keys because the two callers
 * translate differently: the admin through Transloco, the public site
 * through the per-language strings JSON. English defaults cover the rest.
 *
 * Spec: docs/search-spec.md, phase S4 item 2.
 */

import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
    ChangeDetectionStrategy,
    Component,
    ElementRef,
    EventEmitter,
    Input,
    OnDestroy,
    OnInit,
    Output,
    PLATFORM_ID,
    ViewChild,
    computed,
    inject,
    signal,
} from '@angular/core';
import { Router } from '@angular/router';
import { SearchService, SEARCH_DEBOUNCE_MS } from '../../../app/core/services/search.service';
import { SearchResult, SearchScope, highlightSegments } from '../../models/search.model';

export interface SearchBoxResult extends SearchResult {
    titleSegments: { text: string; hit: boolean }[];
    snippetSegments: { text: string; hit: boolean }[];
}

@Component({
    selector: 'arc-search-box',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="arc-search" [class.is-open]="isOpen()" role="combobox"
             [attr.aria-expanded]="isOpen()" aria-haspopup="listbox" [attr.aria-owns]="listId">
            <div class="arc-search__field">
                <i class="fa-solid fa-magnifying-glass arc-search__icon" aria-hidden="true"></i>
                <input #input type="search" class="arc-search__input" autocomplete="off" spellcheck="false"
                       [attr.placeholder]="placeholder" [attr.aria-label]="placeholder"
                       [attr.aria-controls]="listId"
                       [attr.aria-activedescendant]="activeIndex() >= 0 ? listId + '-' + activeIndex() : null"
                       [value]="query()"
                       (input)="onInput($any($event.target).value)"
                       (keydown)="onKeydown($event)"
                       (focus)="onFocus()"
                       (blur)="onBlur()" />
                @if (loading()) {
                    <i class="fa-solid fa-spinner fa-spin arc-search__spinner" aria-hidden="true"></i>
                } @else if (hotkey && !query()) {
                    <kbd class="arc-search__kbd">{{ hotkeyLabel }}</kbd>
                } @else if (query()) {
                    <button type="button" class="arc-search__clear" (mousedown)="$event.preventDefault()" (click)="clear()" aria-label="Clear">
                        <i class="fa-solid fa-xmark" aria-hidden="true"></i>
                    </button>
                }
            </div>

            @if (isOpen()) {
                <div class="arc-search__panel" (mousedown)="$event.preventDefault()">
                    @if (fallbackUsed()) {
                        <p class="arc-search__note">{{ showingForText.replace('{{term}}', fallbackUsed()!) }}</p>
                    }
                    @if (results().length) {
                        <ul class="arc-search__list" role="listbox" [id]="listId">
                            @for (result of results(); track result.source + result.docId + result.lang; let i = $index) {
                                <li role="option" [id]="listId + '-' + i"
                                    class="arc-search__item" [class.is-active]="i === activeIndex()"
                                    [attr.aria-selected]="i === activeIndex()"
                                    (mouseenter)="activeIndex.set(i)" (click)="open(result)">
                                    <div class="arc-search__title">
                                        <span>@for (seg of result.titleSegments; track $index) {@if (seg.hit) {<mark>{{ seg.text }}</mark>} @else {{{ seg.text }}}}</span>
                                        @if (result.badge) { <span class="arc-search__badge">{{ result.badge }}</span> }
                                    </div>
                                    @if (result.snippetSegments.length) {
                                        <div class="arc-search__snippet">@for (seg of result.snippetSegments; track $index) {@if (seg.hit) {<mark>{{ seg.text }}</mark>} @else {{{ seg.text }}}}</div>
                                    }
                                </li>
                            }
                        </ul>
                        @if (resultsUrl) {
                            <button type="button" class="arc-search__all" (click)="goToResults()">{{ allResultsText }}</button>
                        }
                    } @else if (!loading() && searched()) {
                        <p class="arc-search__empty">{{ emptyText }}</p>
                    }
                </div>
            }
        </div>
    `,
    styles: [`
        :host { display: block; min-width: 0; }
        .arc-search { position: relative; }
        .arc-search__field {
            display: flex; align-items: center; gap: 8px;
            height: 36px; padding: 0 10px;
            border: 1px solid #e0e0e0; border-radius: 8px; background: #fff;
            transition: border-color .15s, box-shadow .15s;
        }
        .arc-search__field:focus-within { border-color: #0066cc; box-shadow: 0 0 0 3px rgba(0, 102, 204, .12); }
        .arc-search__icon { color: #8a8f98; font-size: 13px; flex-shrink: 0; }
        .arc-search__input {
            flex: 1; min-width: 0; border: 0; outline: 0; background: transparent;
            font: inherit; font-size: 14px; color: #1a1a1a;
        }
        .arc-search__input::-webkit-search-cancel-button { display: none; }
        .arc-search__spinner { color: #8a8f98; font-size: 12px; }
        .arc-search__kbd {
            font: 600 11px/1 ui-monospace, SFMono-Regular, Menlo, monospace; color: #6e6e73;
            background: #f1f3f5; border: 1px solid #e0e0e0; border-radius: 4px; padding: 3px 5px;
        }
        .arc-search__clear { border: 0; background: transparent; color: #8a8f98; cursor: pointer; padding: 0 2px; }
        .arc-search__clear:hover { color: #1a1a1a; }
        .arc-search__panel {
            position: absolute; top: calc(100% + 6px); left: 0; right: 0; z-index: 1000;
            min-width: 320px; max-height: 420px; overflow-y: auto;
            background: #fff; border: 1px solid #e5e7eb; border-radius: 10px;
            box-shadow: 0 12px 32px rgba(0, 0, 0, .12);
        }
        .arc-search__list { list-style: none; margin: 0; padding: 6px; }
        .arc-search__item { padding: 8px 10px; border-radius: 8px; cursor: pointer; }
        .arc-search__item.is-active { background: #f1f5ff; }
        .arc-search__title { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; font-size: 14px; font-weight: 500; color: #1a1a1a; }
        .arc-search__title > span:first-child { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .arc-search__badge {
            flex-shrink: 0; font-size: 11px; font-weight: 600; color: #495057;
            background: #f1f3f5; border-radius: 999px; padding: 2px 8px; white-space: nowrap;
        }
        .arc-search__snippet { margin-top: 2px; font-size: 12.5px; color: #6e6e73; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .arc-search mark { background: transparent; color: #0066cc; font-weight: 700; padding: 0; }
        .arc-search__note, .arc-search__empty { margin: 0; padding: 10px 14px; font-size: 13px; color: #6e6e73; }
        .arc-search__note { border-bottom: 1px solid #f1f3f5; }
        .arc-search__all {
            display: block; width: 100%; border: 0; border-top: 1px solid #f1f3f5; background: transparent;
            padding: 10px; font: inherit; font-size: 13px; color: #0066cc; cursor: pointer; text-align: center;
        }
        .arc-search__all:hover { background: #f8f9fb; }
    `],
})
export class SearchBoxComponent implements OnInit, OnDestroy {
    private searchService = inject(SearchService);
    private router = inject(Router);
    private platformId = inject(PLATFORM_ID);
    private document = inject(DOCUMENT);

    @ViewChild('input') inputRef?: ElementRef<HTMLInputElement>;

    /** Who is asking. Decides which sources the function will search. */
    @Input() scope: SearchScope = 'public';
    /** Limit to these sources. Omit for every source the scope may read. */
    @Input() sources?: string[];
    /** The language being viewed. Omit for language-neutral sources only. */
    @Input() lang?: string;
    @Input() limit = 8;
    /** Where Enter goes with the query appended as `?q=`. Omit to disable. */
    @Input() resultsUrl?: string;
    /** How a picked result is opened. Router for SPA routes, location for static pages. */
    @Input() navigation: 'router' | 'location' | 'none' = 'router';
    /** Cmd+K / Ctrl+K focuses the box. */
    @Input() hotkey = false;

    @Input() placeholder = 'Search';
    @Input() emptyText = 'No results';
    @Input() showingForText = 'Showing results for "{{term}}"';
    @Input() allResultsText = 'See all results';

    @Output() picked = new EventEmitter<SearchResult>();

    readonly listId = `arc-search-list-${Math.random().toString(36).slice(2, 8)}`;
    readonly hotkeyLabel = isPlatformBrowser(inject(PLATFORM_ID)) && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K';

    readonly query = signal('');
    readonly results = signal<SearchBoxResult[]>([]);
    readonly loading = signal(false);
    readonly searched = signal(false);
    readonly fallbackUsed = signal<string | null>(null);
    readonly focused = signal(false);
    readonly activeIndex = signal(-1);
    readonly isOpen = computed(() => this.focused() && this.searchService.isSearchable(this.query()) && (this.results().length > 0 || this.searched() || this.loading()));

    private timer: ReturnType<typeof setTimeout> | null = null;
    private hotkeyHandler = (event: KeyboardEvent) => {
        if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
            event.preventDefault();
            this.focus();
        }
    };

    ngOnInit(): void {
        if (this.hotkey && isPlatformBrowser(this.platformId)) {
            this.document.addEventListener('keydown', this.hotkeyHandler);
        }
    }

    ngOnDestroy(): void {
        if (this.timer) clearTimeout(this.timer);
        if (isPlatformBrowser(this.platformId)) {
            this.document.removeEventListener('keydown', this.hotkeyHandler);
        }
    }

    focus(): void {
        this.inputRef?.nativeElement.focus();
        this.inputRef?.nativeElement.select();
    }

    onInput(value: string): void {
        this.query.set(value);
        this.activeIndex.set(-1);
        if (this.timer) clearTimeout(this.timer);

        if (!this.searchService.isSearchable(value)) {
            this.results.set([]);
            this.searched.set(false);
            this.fallbackUsed.set(null);
            this.loading.set(false);
            return;
        }
        this.loading.set(true);
        this.timer = setTimeout(() => void this.run(value), SEARCH_DEBOUNCE_MS);
    }

    onFocus(): void {
        this.focused.set(true);
    }

    onBlur(): void {
        // The panel swallows mousedown, so a click inside never blurs us; a
        // blur means focus really left.
        this.focused.set(false);
    }

    onKeydown(event: KeyboardEvent): void {
        const count = this.results().length;
        switch (event.key) {
            case 'ArrowDown':
                if (!count) return;
                event.preventDefault();
                this.activeIndex.set((this.activeIndex() + 1) % count);
                return;
            case 'ArrowUp':
                if (!count) return;
                event.preventDefault();
                this.activeIndex.set((this.activeIndex() - 1 + count) % count);
                return;
            case 'Enter': {
                event.preventDefault();
                const active = this.activeIndex();
                if (active >= 0 && active < count) this.open(this.results()[active]);
                else this.goToResults();
                return;
            }
            case 'Escape':
                if (this.query()) this.clear();
                else this.inputRef?.nativeElement.blur();
                return;
        }
    }

    clear(): void {
        this.onInput('');
        this.focus();
    }

    open(result: SearchResult): void {
        this.picked.emit(result);
        this.focused.set(false);
        this.inputRef?.nativeElement.blur();
        if (this.navigation === 'router') {
            void this.router.navigateByUrl(result.link);
        } else if (this.navigation === 'location' && isPlatformBrowser(this.platformId)) {
            this.document.location.assign(result.link);
        }
    }

    goToResults(): void {
        const q = this.query().trim();
        if (!this.resultsUrl || !this.searchService.isSearchable(q)) return;
        this.focused.set(false);
        this.inputRef?.nativeElement.blur();
        const url = `${this.resultsUrl}?q=${encodeURIComponent(q)}`;
        if (this.navigation === 'location' && isPlatformBrowser(this.platformId)) {
            this.document.location.assign(url);
        } else {
            void this.router.navigateByUrl(url);
        }
    }

    private async run(value: string): Promise<void> {
        try {
            const response = await this.searchService.search({
                q: value,
                lang: this.lang,
                scope: this.scope,
                sources: this.sources,
                limit: this.limit,
            });
            // null: a newer query answered first, or will.
            if (!response) return;
            if (value !== this.query()) return;
            this.results.set(response.results.map(result => ({
                ...result,
                titleSegments: highlightSegments(result.title, result.highlights?.title),
                snippetSegments: highlightSegments(result.snippet ?? '', result.highlights?.snippet),
            })));
            this.fallbackUsed.set(response.fallbackUsed ?? null);
            this.searched.set(true);
            this.activeIndex.set(-1);
        } catch (error) {
            console.error('Search failed:', error);
            this.results.set([]);
            this.searched.set(true);
        } finally {
            if (value === this.query()) this.loading.set(false);
        }
    }
}
