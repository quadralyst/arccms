import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SearchBoxComponent } from './search-box.component';
import { SearchService, SEARCH_DEBOUNCE_MS } from '../../../app/core/services/search.service';
import { SearchResult } from '../../models/search.model';

function result(docId: string, title: string, link = `/admin/contents/articles/edit/${docId}`): SearchResult {
    return { source: 'content-drafts', docId, lang: 'en', title, link, badge: 'Articles', score: 1, highlights: { title: [[0, 3]], snippet: [] } };
}

describe('SearchBoxComponent', () => {
    let fixture: ComponentFixture<SearchBoxComponent>;
    let component: SearchBoxComponent;
    let searchMock: { isSearchable: (q: string) => boolean; search: ReturnType<typeof vi.fn> };
    let router: { navigateByUrl: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        vi.useFakeTimers();
        searchMock = {
            isSearchable: (q: string) => q.trim().length >= 2,
            search: vi.fn().mockResolvedValue({ results: [result('a', 'Gunjan Karun'), result('b', 'Guide')], tookMs: 2 }),
        };
        router = { navigateByUrl: vi.fn().mockResolvedValue(true) };

        await TestBed.configureTestingModule({
            imports: [SearchBoxComponent],
            providers: [
                { provide: SearchService, useValue: searchMock },
                { provide: Router, useValue: router },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SearchBoxComponent);
        component = fixture.componentInstance;
        component.scope = 'admin';
        component.sources = ['content-drafts'];
        component.lang = 'all';
        component.resultsUrl = '/admin/search';
        fixture.detectChanges();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    async function type(value: string): Promise<void> {
        component.onFocus();
        component.onInput(value);
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 5);
        fixture.detectChanges();
    }

    it('waits for the debounce and two characters before searching', async () => {
        component.onInput('k');
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS + 5);
        expect(searchMock.search).not.toHaveBeenCalled();

        component.onInput('ka');
        await vi.advanceTimersByTimeAsync(SEARCH_DEBOUNCE_MS - 50);
        expect(searchMock.search).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(60);
        expect(searchMock.search).toHaveBeenCalledWith({ q: 'ka', lang: 'all', scope: 'admin', sources: ['content-drafts'], limit: 8 });
    });

    it('renders results with highlighted segments and badges', async () => {
        await type('gun');
        expect(component.isOpen()).toBe(true);
        expect(component.results()[0].titleSegments).toEqual([{ text: 'Gun', hit: true }, { text: 'jan Karun', hit: false }]);
        const items = fixture.nativeElement.querySelectorAll('.arc-search__item');
        expect(items).toHaveLength(2);
        expect(items[0].querySelector('mark').textContent).toBe('Gun');
        expect(items[0].querySelector('.arc-search__badge').textContent).toBe('Articles');
    });

    it('navigates through the keyboard and opens the active result with the router', async () => {
        await type('gun');
        component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowDown' }));
        expect(component.activeIndex()).toBe(1);
        component.onKeydown(new KeyboardEvent('keydown', { key: 'ArrowUp' }));
        expect(component.activeIndex()).toBe(0);

        const picked = vi.fn();
        component.picked.subscribe(picked);
        component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(picked).toHaveBeenCalledWith(expect.objectContaining({ docId: 'a' }));
        expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/contents/articles/edit/a');
    });

    it('goes to the results page on Enter with nothing selected', async () => {
        await type('gun jan');
        component.onKeydown(new KeyboardEvent('keydown', { key: 'Enter' }));
        expect(router.navigateByUrl).toHaveBeenCalledWith('/admin/search?q=gun%20jan');
    });

    it('shows the empty state and the fallback note', async () => {
        searchMock.search.mockResolvedValueOnce({ results: [], tookMs: 1 });
        await type('zzz');
        expect(fixture.nativeElement.querySelector('.arc-search__empty').textContent).toBe('No results');

        searchMock.search.mockResolvedValueOnce({ results: [result('a', 'Gunjan')], tookMs: 1, fallbackUsed: 'gunja' });
        await type('gunjam');
        expect(fixture.nativeElement.querySelector('.arc-search__note').textContent).toContain('gunja');
    });

    it('ignores a stale (null) response and clears on Escape', async () => {
        searchMock.search.mockResolvedValueOnce(null);
        await type('gun');
        expect(component.results()).toEqual([]);

        await type('gun');
        expect(component.results()).toHaveLength(2);
        component.onKeydown(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(component.query()).toBe('');
        expect(component.results()).toEqual([]);
    });

    it('closes when focus leaves', async () => {
        await type('gun');
        expect(component.isOpen()).toBe(true);
        component.onBlur();
        expect(component.isOpen()).toBe(false);
    });
});
