/**
 * Card blocks in the site's header and footer, on the pages the app draws
 * (sign-in, the form pages, search, content pages before they are published):
 * each <arc-content-partials> becomes the card block component, its plain
 * attributes setting its inputs, as on the home page. Publishing fills the same
 * blocks with the same cards (functions/src/pages/card-blocks.ts).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { signal } from '@angular/core';
import { of, Subject } from 'rxjs';

vi.mock('virtual:arc-site', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    header: '<nav class="site-nav"><arc-content-partials content-type="programs" count="2" section-title="Programs">'
        + '</arc-content-partials></nav>',
    footer: '<footer class="site-footer"><div class="col"><arc-content-partials content-type="entry-points" count="five"'
        + ' template-folder="entry-point"></arc-content-partials></div></footer>',
}));

import { HeaderComponent } from './header.component';
import { FooterComponent } from './footer.component';
import { ContentPartialsComponent } from './content-partials.component';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { ContentsService } from '../admin/contents/content-store/published-contents.service';
import { ContentTypesService } from '../admin/contents/content-types/content-types.service';
import { AuthState } from '../(auth)/auth.store';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { SiteIdentityService } from '../../core/services/site-identity.service';
import { SitePagesService } from '../../core/site/site-pages.service';
import { PublicContentTypesService } from '../../core/site/public-content-types';
import { MediaSettingsService } from '../../core/services/media-settings.service';
import { DEFAULT_ABOUT_SETTINGS, IAboutSettings } from '../admin/(settings)/about/about-settings.model';

describe('card blocks in the header and footer the app draws', () => {
    beforeEach(async () => {
        const emptyStore = { items: signal([]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() };
        await TestBed.configureTestingModule({
            imports: [HeaderComponent, FooterComponent],
            providers: [
                { provide: ContentTypesStore, useValue: emptyStore },
                { provide: HttpClient, useValue: { get: vi.fn().mockReturnValue(of('')) } },
                { provide: Router, useValue: { navigate: vi.fn(), events: of(), url: '/' } },
                {
                    provide: ActivatedRoute,
                    useValue: { snapshot: { paramMap: { get: () => null } }, paramMap: of({ get: () => null, keys: [] }), queryParams: of({}) },
                },
            ],
        })
            .overrideComponent(ContentPartialsComponent, {
                set: {
                    providers: [{ provide: ContentsStore, useValue: emptyStore }],
                    // What the block was given, instead of the cards.
                    template: '<i class="given">{{ contentType() }}|{{ count() }}|{{ sectionTitle() }}|{{ templateFolder() }}</i>',
                },
            })
            .compileComponents();
    });

    it('turns the header\'s card block into the component, with its attributes as inputs', () => {
        const fixture = TestBed.createComponent(HeaderComponent);
        fixture.detectChanges();
        const block = (fixture.nativeElement as HTMLElement).querySelector('nav arc-content-partials .given');
        expect(block?.textContent).toBe('programs|2|Programs|');
    });

    it('does the same in the footer: a count that is not a number gives 4', () => {
        const fixture = TestBed.createComponent(FooterComponent);
        fixture.detectChanges();
        const block = (fixture.nativeElement as HTMLElement).querySelector('footer .col arc-content-partials .given');
        expect(block?.textContent).toBe('entry-points|4||entry-point');
    });
});

describe('ContentPartialsComponent.attributeInputs', () => {
    it('reads the four attributes, and only those present', () => {
        const element = document.createElement('arc-content-partials');
        element.setAttribute('content-type', 'services');
        element.setAttribute('count', '12');
        element.setAttribute('section-title', 'What we do');
        element.setAttribute('data-other', 'x');
        expect(ContentPartialsComponent.attributeInputs(element)).toEqual({ contentType: 'services', count: 12, sectionTitle: 'What we do' });
        element.setAttribute('template-folder', 'cards');
        element.setAttribute('count', '0');
        expect(ContentPartialsComponent.attributeInputs(element)).toMatchObject({ count: 4, templateFolder: 'cards' });
    });

    it('reads `count` as the publish side does: a whole number from 1 to 50, else 4', () => {
        const element = document.createElement('arc-content-partials');
        for (const [count, read] of [['-2', 1], ['2.7', 2], ['0.5', 1], ['500', 50], ['0', 4], ['five', 4], ['', 4]] as const) {
            element.setAttribute('count', count);
            expect(ContentPartialsComponent.attributeInputs(element)['count']).toBe(read);
        }
    });
});

/**
 * What one page view costs with a card block in the footer: the footer is drawn
 * again as the page's strings, the site's details, its standard pages and the
 * public content types arrive, and the block must not be mounted (and read)
 * again for each, nor touch the page's own query of its content type.
 */
describe('a footer card block\'s reads for one page view', () => {
    const entry = (i: number) => ({ id: `e${i}`, type: 'entry-points', publishedStatus: true, title: `Entry ${i}`, urlSlug: `e${i}`, publishedOn: new Date(2026, 0, 30 - i) });
    const result = (rows: unknown[]) => of({ collectionData: rows, totalCount: rows.length, firstVisible: null, lastVisible: null });
    let strings: ReturnType<typeof signal<Record<string, string>>>;
    let identity: ReturnType<typeof signal<IAboutSettings>>;
    let pages: ReturnType<typeof signal<{ slug: string; title: string }[]>>;
    let types: ReturnType<typeof signal<ReadonlySet<string>>>;
    let contentsReads: ReturnType<typeof vi.fn>;
    let typesReads: ReturnType<typeof vi.fn>;
    /** The content page's own query of its type, still on its way. */
    let pageQuery: Subject<unknown>;

    beforeEach(async () => {
        strings = signal<Record<string, string>>({});
        identity = signal<IAboutSettings>(DEFAULT_ABOUT_SETTINGS);
        pages = signal<{ slug: string; title: string }[]>([]);
        types = signal<ReadonlySet<string>>(new Set());
        pageQuery = new Subject();
        contentsReads = vi.fn(() => result(Array.from({ length: 6 }, (_, i) => entry(i))));
        typesReads = vi.fn((params: { whereConditions?: { value: string }[] }) => {
            const slug = params?.whereConditions?.[0]?.value;
            if (slug === 'events') return pageQuery;
            return result([{ id: 't1', slug: 'entry-points', name: 'Entry points' }, { id: 't2', slug: 'events', name: 'Events' }]
                .filter((type) => !slug || type.slug === slug));
        });
        await TestBed.configureTestingModule({
            imports: [FooterComponent],
            providers: [
                { provide: ContentsService, useValue: { getAll: contentsReads } },
                { provide: ContentTypesService, useValue: { getAll: typesReads } },
                { provide: AuthState, useValue: {} },
                { provide: UiStringsService, useValue: { activeLang: signal(''), strings, load: async () => ({}) } },
                { provide: SiteIdentityService, useValue: { identity, load: vi.fn(async () => identity()) } },
                { provide: SitePagesService, useValue: { pages, load: vi.fn(async () => pages()) } },
                { provide: PublicContentTypesService, useValue: { slugs: types, load: vi.fn(async () => types()) } },
                { provide: MediaSettingsService, useValue: { load: vi.fn(async () => 1600), maxSize: signal(1600) } },
                {
                    provide: HttpClient,
                    useValue: { get: vi.fn().mockReturnValue(of('<ul class="cards" data-arc-loop="items"><li>{{ title }}</li></ul>')) },
                },
                { provide: Router, useValue: { navigate: vi.fn(), events: of(), url: '/events/launch' } },
                {
                    provide: ActivatedRoute,
                    useValue: { snapshot: { paramMap: { get: () => null } }, paramMap: of({ get: () => null, keys: [] }), queryParams: of({}) },
                },
            ],
        }).compileComponents();
    });

    it('reads the block\'s type and its `count` entries once, keeps it drawn, and leaves the page\'s query alone', async () => {
        // The content page asks the root store for its own type first.
        const pageTypes = TestBed.inject(ContentTypesStore);
        void pageTypes.getAll({ whereConditions: [{ field: 'slug', operator: '==', value: 'events' }], orderByField: 'slug', orderByDirection: 'asc', limitCount: 1 });

        const fixture = TestBed.createComponent(FooterComponent);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        const block = el.querySelector('arc-content-partials');

        // What arrives while the page is open, each redrawing the footer.
        strings.set({ latest_of_type: 'Newest {{ contentType }}' });
        fixture.detectChanges();
        identity.set({ ...DEFAULT_ABOUT_SETTINGS, phone: '+91 98765 43210' });
        fixture.detectChanges();
        pages.set([{ slug: 'terms', title: 'Terms' }]);
        fixture.detectChanges();
        types.set(new Set(['entry-points', 'events']));
        fixture.detectChanges();
        // Not whenStable: the page's query, still on its way, holds the app unstable.
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();

        // One read of the block's type (by its slug) and one of its four entries.
        const blockTypeReads = typesReads.mock.calls.filter(([params]) => params?.whereConditions?.[0]?.value !== 'events');
        expect(blockTypeReads).toHaveLength(1);
        expect(blockTypeReads[0][0]).toMatchObject({ whereConditions: [{ field: 'slug', operator: '==', value: 'entry-points' }], limitCount: 1 });
        expect(contentsReads).toHaveBeenCalledTimes(1);
        expect(contentsReads).toHaveBeenCalledWith(expect.objectContaining({ limitCount: 4 }), 'entry-points');

        // The same block, still showing its cards: not mounted again.
        expect(el.querySelector('arc-content-partials')).toBe(block);
        expect(Array.from(el.querySelectorAll('.cards li')).map((li) => li.textContent)).toEqual(['Entry 0', 'Entry 1', 'Entry 2', 'Entry 3']);

        // The page's own query was not cancelled, and its answer is what the root store holds.
        expect(pageQuery.observed).toBe(true);
        pageQuery.next({ collectionData: [{ id: 't2', slug: 'events', name: 'Events' }], totalCount: 1, firstVisible: null, lastVisible: null });
        expect(pageTypes.items().map((type) => type.slug)).toEqual(['events']);
    });
});
