/**
 * The content page on the live preview (specs/visual-editing-spec.md, VE-D4): a
 * DetailSource hands it the editor's draft, which it draws with the site's
 * template, marked for click to field, and draws again with each change.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReadableStream } from 'stream/web';
(global as any).ReadableStream = ReadableStream;
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { Meta, Title } from '@angular/platform-browser';
import { ContentDetailComponent } from './content-detail.component';
import { ContentPartialsComponent } from './content-partials.component';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { DraftContentsStore } from '../admin/contents/draft-content-store/draft-contents.store';
import { GaTrackingService } from '../../../shared/services/ga-tracking.service';
import { AuthorProfileService } from '../../core/services/author-profile.service';
import { ItemsFromTypeService } from '../../core/services/items-from-type.service';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { setSiteManifestForTesting } from '../../core/site/site';
import { coreSiteManifest } from '../../../test/core-site';
import { DetailRoute, DetailSource, LiveDetail } from './detail-source';

const TEMPLATE = '<article><h1 data-arc-bind="title">x</h1><p class="price">{{ price }}</p><ul data-arc-loop="faq"><li>{{ question }}</li></ul><form><button>Join</button></form></article>';

class LiveSource extends DetailSource {
    override readonly live = signal<LiveDetail | null>(null);
    override readonly markFields = true;
    route(): DetailRoute {
        return { typeSlug: 'events', urlSlug: '', preview: false, lang: this.live()?.lang || '' };
    }
}

describe('ContentDetailComponent on the live preview', () => {
    let fixture: ComponentFixture<ContentDetailComponent>;
    let source: LiveSource;
    let contentsStore: any;
    let typesStore: any;
    let http: any;
    let ga: any;
    let uiStrings: any;

    const draft = (over: Record<string, any> = {}) => ({
        id: 'e1', type: 'events', title: 'Fair', urlSlug: 'fair', content: '<p>Body</p>',
        customFields: { 'events-price': '20', 'events-faq': [{ question: 'Q1', answer: 'A1' }] }, ...over,
    });
    const settle = async () => {
        for (let i = 0; i < 4; i++) {
            fixture.detectChanges();
            await new Promise((resolve) => setTimeout(resolve, 0));
        }
    };
    const page = () => fixture.nativeElement as HTMLElement;

    beforeEach(async () => {
        setSiteManifestForTesting(coreSiteManifest());
        source = new LiveSource();
        contentsStore = { items: signal([]), isLoading: signal(false), isSuccess: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() };
        typesStore = {
            items: signal([{ slug: 'events', name: 'Events', fields: [{ key: 'events-price' }, { key: 'events-faq' }] }]),
            isLoading: signal(false), isSuccess: signal(true), getAll: vi.fn(), unsubscribeStore: vi.fn(),
        };
        http = { get: vi.fn().mockReturnValue(of(TEMPLATE)) };
        ga = { trackContentDetailView: vi.fn(), trackPublicPageView: vi.fn(), trackShareClick: vi.fn() };

        await TestBed.configureTestingModule({
            imports: [ContentDetailComponent],
            providers: [
                { provide: DetailSource, useValue: source },
                { provide: ContentsStore, useValue: contentsStore },
                { provide: ContentTypesStore, useValue: typesStore },
                { provide: DraftContentsStore, useValue: { getBySlug: vi.fn() } },
                { provide: Auth, useValue: { onAuthStateChanged: vi.fn((cb) => { cb(null); return () => undefined; }), currentUser: null } },
                { provide: HttpClient, useValue: http },
                { provide: Title, useValue: { setTitle: vi.fn() } },
                { provide: Meta, useValue: { updateTag: vi.fn(), removeTag: vi.fn() } },
                { provide: GaTrackingService, useValue: ga },
                { provide: AuthorProfileService, useValue: { load: vi.fn().mockResolvedValue(null) } },
                { provide: ItemsFromTypeService, useValue: { rows: vi.fn().mockResolvedValue([]) } },
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: () => null }, queryParamMap: { get: () => null } }, paramMap: of({ get: () => null, keys: [] }), queryParams: of({}) } },
            ],
        })
            .overrideComponent(ContentPartialsComponent, { set: { providers: [{ provide: ContentsStore, useValue: contentsStore }] } })
            .compileComponents();
        uiStrings = TestBed.inject(UiStringsService);
        vi.spyOn(uiStrings, 'use');
        fixture = TestBed.createComponent(ContentDetailComponent);
        fixture.detectChanges();
    });

    afterEach(() => setSiteManifestForTesting());

    it('loads only the type: the entry comes from the editor', () => {
        expect(contentsStore.getAll).not.toHaveBeenCalled();
        expect(typesStore.getAll).toHaveBeenCalledWith(expect.objectContaining({ whereConditions: [{ field: 'slug', operator: '==', value: 'events' }] }));
    });

    it('draws the draft with the type\'s template, every filled element marked', async () => {
        source.live.set({ content: draft(), lang: '', translation: null });
        await settle();
        expect(http.get).toHaveBeenCalledWith('/_site/templates/default/detail.html', expect.anything());
        expect(page().querySelector('h1[data-arc-field="title"]')?.textContent).toBe('Fair');
        expect(page().querySelector('[data-arc-field="price"]')?.textContent).toBe('20');
        expect(page().querySelector('li[data-arc-field="faq"][data-arc-row="0"]')?.textContent).toBe('Q1');
    });

    it('draws each change again without loading the template again', async () => {
        source.live.set({ content: draft(), lang: '', translation: null });
        await settle();
        const loads = http.get.mock.calls.length;
        source.live.set({ content: draft({ title: 'Fair two', customFields: { 'events-price': '25', 'events-faq': [] } }), lang: '', translation: null });
        await settle();
        expect(page().querySelector('article h1')?.textContent).toBe('Fair two');
        expect(page().querySelector('.price')?.textContent).toBe('25');
        expect(page().querySelectorAll('article li')).toHaveLength(0);
        expect(http.get.mock.calls.length).toBe(loads);
    });

    it('shows the translation on the editor\'s screen, in its language', async () => {
        source.live.set({ content: draft(), lang: 'hi', translation: { lang: 'hi', title: 'मेला', customFields: { 'events-faq': [{ question: 'प्र1' }] } } as any });
        await settle();
        expect(page().querySelector('article h1')?.textContent).toBe('मेला');
        expect(uiStrings.use).toHaveBeenCalledWith('hi');
        expect(fixture.componentInstance.pageLang()).toBe('hi');
    });

    it('is not counted as a page view, and its forms are not made live', async () => {
        source.live.set({ content: draft(), lang: '', translation: null });
        await settle();
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(ga.trackContentDetailView).not.toHaveBeenCalled();
        expect(document.querySelector('script[src*="arc-site"]')).toBeNull();
    });
});
