import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import PublicSearchPage from './search.page';
import { SearchService } from '../core/services/search.service';
import { LocalizationService } from '../core/services/localization.service';
import { UiStringsService } from '../core/services/ui-strings.service';

describe('PublicSearchPage', () => {
    let fixture: ComponentFixture<PublicSearchPage>;
    let component: PublicSearchPage;
    let searchMock: { isSearchable: (q: string) => boolean; search: ReturnType<typeof vi.fn> };
    let uiStrings: { use: ReturnType<typeof vi.fn>; activeLang: ReturnType<typeof signal<string>>; strings: ReturnType<typeof signal<Record<string, string>>> };
    let localization: { load: ReturnType<typeof vi.fn>; defaultLanguage: () => string; enabledLanguages: () => { code: string }[]; languageVariants: ReturnType<typeof signal<string[] | null>> };

    async function setup(lang: string, q: string) {
        searchMock = {
            isSearchable: (value: string) => value.trim().length >= 2,
            search: vi.fn().mockResolvedValue({
                results: [{ source: 'content', docId: 'a', lang: lang || 'en', title: 'Gunjan Karun', link: '/people/gunjan', badge: 'People', score: 1, highlights: { title: [[0, 3]], snippet: [] } }],
                tookMs: 4,
            }),
        };
        uiStrings = { use: vi.fn().mockResolvedValue({}), activeLang: signal(lang), strings: signal({}) };
        localization = {
            load: vi.fn().mockResolvedValue({}),
            defaultLanguage: () => 'en',
            enabledLanguages: () => [{ code: 'en' }, { code: 'hi' }],
            languageVariants: signal<string[] | null>(null),
        };

        await TestBed.configureTestingModule({
            imports: [PublicSearchPage],
            providers: [
                { provide: SearchService, useValue: searchMock },
                { provide: LocalizationService, useValue: localization },
                { provide: UiStringsService, useValue: uiStrings },
                { provide: Router, useValue: { navigateByUrl: vi.fn(), events: new BehaviorSubject(null), url: '/search' } },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { paramMap: { get: (key: string) => (key === 'lang' ? lang : null) } },
                        queryParamMap: new BehaviorSubject({ get: (key: string) => (key === 'q' ? q : null) }),
                    },
                },
            ],
        }).overrideComponent(PublicSearchPage, { set: { imports: [] , template: `
            @if (query()) { <p class="lead">{{ text('search_results_for').replace('{{query}}', query()) }}</p> }
            <ul>@for (r of results(); track r.docId) { <li>{{ r.title }}</li> }</ul>` } }).compileComponents();

        fixture = TestBed.createComponent(PublicSearchPage);
        component = fixture.componentInstance;
        fixture.detectChanges();
        await fixture.whenStable();
        await new Promise(resolve => setTimeout(resolve, 0));
        fixture.detectChanges();
    }

    beforeEach(() => TestBed.resetTestingModule());

    it('searches the default language on /search', async () => {
        await setup('', 'kar');
        expect(uiStrings.use).toHaveBeenCalledWith('');
        expect(searchMock.search).toHaveBeenCalledWith({ q: 'kar', lang: 'en', scope: 'public', limit: 20 });
        expect(component.results()).toHaveLength(1);
        expect(localization.languageVariants()).toEqual(['en', 'hi']);
        expect(fixture.nativeElement.querySelector('.lead').textContent).toContain('"kar"');
    });

    it('searches the route language on /{lang}/search', async () => {
        await setup('hi', 'गुंजन');
        expect(uiStrings.use).toHaveBeenCalledWith('hi');
        expect(searchMock.search).toHaveBeenCalledWith({ q: 'गुंजन', lang: 'hi', scope: 'public', limit: 20 });
    });

    it('does nothing for a short query', async () => {
        await setup('', 'k');
        expect(searchMock.search).not.toHaveBeenCalled();
        expect(component.results()).toEqual([]);
    });
});
