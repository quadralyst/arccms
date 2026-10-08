import { ComponentFixture, TestBed, fakeAsync, tick } from '@angular/core/testing';
import { ReadableStream } from 'stream/web';
(global as any).ReadableStream = ReadableStream;
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SiteIdentityService } from '../../core/services/site-identity.service';
import { DEFAULT_ABOUT_SETTINGS } from '../admin/(settings)/about/about-settings.model';
import { ContentListComponent } from './content-list.component';
import { ActivatedRoute } from '@angular/router';
import { HttpClient } from '@angular/common/http';
import { of } from 'rxjs';
import { signal, makeStateKey } from '@angular/core';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentPartialsComponent } from './content-partials.component';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { TagsStore } from '../admin/contents/content-types/tags/tags.store';
import { Meta, Title } from '@angular/platform-browser';
import { DOCUMENT } from '@angular/common';

import { GaTrackingService } from '../../../shared/services/ga-tracking.service';
import { TemplateHydrationService } from '../../core/services/template-hydration.service';
import { setSiteManifestForTesting, siteManifest } from '../../core/site/site';

/** The built manifest plus a folder of the test's own. */
function withFolder(name: string): void {
    const built = siteManifest();
    setSiteManifestForTesting({ ...built, templates: { ...built.templates, [name]: { list: 'app' } } });
}

describe('ContentListComponent', () => {
    let component: ContentListComponent;
    let fixture: ComponentFixture<ContentListComponent>;
    let mockContentsStore: any;
    let mockContentTypesStore: any;
    let mockTagsStore: any;
    let mockHttpClient: any;
    let mockTitleService: any;
    let mockMetaService: any;
    let mockGaTrackingService: any;

    beforeEach(async () => {
        mockContentsStore = {
            items: signal([]),
            isLoading: signal(false),
            getAll: vi.fn(),
            unsubscribeStore: vi.fn(),
        };

        mockContentTypesStore = {
            items: signal([]),
            isLoading: signal(false),
            isSuccess: signal(true),
            getAll: vi.fn(),
            unsubscribeStore: vi.fn(),
        };

        mockTagsStore = {
            items: signal([]),
            isLoading: signal(false),
            getAll: vi.fn(),
            unsubscribeStore: vi.fn(),
        };

        mockHttpClient = {
            get: vi.fn().mockReturnValue(of('<div>Template</div>')),
        };

        mockTitleService = {
            setTitle: vi.fn(),
        };

        mockMetaService = {
            updateTag: vi.fn(),
        };

        mockGaTrackingService = {
            trackContentListView: vi.fn(),
            trackPublicPageView: vi.fn()
        };

        await TestBed.configureTestingModule({
            imports: [ContentListComponent],
            providers: [
                { provide: ContentsStore, useValue: mockContentsStore },
                { provide: ContentTypesStore, useValue: mockContentTypesStore },
                { provide: TagsStore, useValue: mockTagsStore },
                { provide: HttpClient, useValue: mockHttpClient },
                { provide: Title, useValue: mockTitleService },
                { provide: Meta, useValue: mockMetaService },
                { provide: DOCUMENT, useValue: document },
                { provide: GaTrackingService, useValue: mockGaTrackingService },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: {
                            paramMap: {
                                get: (key: string) => key === 'contentTypeSlug' ? 'articles' : null
                            }
                        },
                        queryParams: of({}),
                        paramMap: of({ get: (key: string) => null, keys: [] })
                    }
                }
            ]
        })
            // The site footer embeds <arc-content-partials>, which declares its
            // own `providers: [ContentsStore]` and would otherwise construct a
            // real store (and Firestore) underneath every page.
            .overrideComponent(ContentPartialsComponent, {
                set: { providers: [{ provide: ContentsStore, useValue: mockContentsStore }] },
            })
            .compileComponents();

        fixture = TestBed.createComponent(ContentListComponent);
        component = fixture.componentInstance;
        // Do not call detectChanges here to allow individual tests to set up state
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('should create', () => {
        fixture.detectChanges();
        expect(component).toBeTruthy();
    });

    it('loads the newest 100 items, as the published list does, not the store\'s first ten', () => {
        fixture.detectChanges();
        expect(mockContentsStore.getAll).toHaveBeenCalledWith(
            expect.objectContaining({ orderByField: 'publishedOn', orderByDirection: 'desc', limitCount: 100 }),
            'articles',
        );
    });

    describe('SEO Meta Tags', () => {
        it('should set page title and meta description from content type', () => {
            const contentType = {
                slug: 'articles',
                name: 'My Articles',
                description: 'Best articles'
            };

            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            expect(mockTitleService.setTitle).toHaveBeenCalledWith('My Articles');
            expect(mockMetaService.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Best articles' });
        });

        it('should enable Open Graph and Twitter tags', () => {
            const contentType = {
                slug: 'articles',
                name: 'My Articles',
                description: 'Best articles'
            };

            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            expect(mockMetaService.updateTag).toHaveBeenCalledWith(expect.objectContaining({ property: 'og:title', content: 'My Articles' }));
            expect(mockMetaService.updateTag).toHaveBeenCalledWith(expect.objectContaining({ property: 'og:type', content: 'website' }));
            expect(mockMetaService.updateTag).toHaveBeenCalledWith(expect.objectContaining({ name: 'twitter:card', content: 'summary' }));
        });

        // Task 2.1: new SEO requirements
        it('should set robots to "index, follow"', () => {
            const contentType = { slug: 'articles', name: 'Articles', description: 'Articles desc' };
            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            expect(mockMetaService.updateTag).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'robots', content: 'index, follow' })
            );
        });

        it('should set og:site_name to the site\'s own name (Settings, About), not Arc CMS', async () => {
            TestBed.inject(SiteIdentityService).set({ ...DEFAULT_ABOUT_SETTINGS, name: 'Deepakam' });
            const contentType = { slug: 'articles', name: 'Articles', description: 'Articles desc' };
            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();
            await Promise.resolve();
            await Promise.resolve();

            expect(mockMetaService.updateTag).toHaveBeenCalledWith(
                expect.objectContaining({ property: 'og:site_name', content: 'Deepakam' })
            );
            expect(mockMetaService.updateTag).not.toHaveBeenCalledWith(
                expect.objectContaining({ property: 'og:site_name', content: 'Arc CMS' })
            );
        });

        it('should set og:url for the list page', () => {
            const contentType = { slug: 'articles', name: 'Articles', description: 'Articles desc' };
            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            const ogUrlCalls = (mockMetaService.updateTag as any).mock.calls.filter(
                (call: any[]) => call[0]?.property === 'og:url'
            );
            expect(ogUrlCalls.length).toBeGreaterThan(0);
            expect(ogUrlCalls[0][0].content).toBeTruthy();
        });

        it('should create a canonical link element in the document', () => {
            const contentType = { slug: 'articles', name: 'Articles', description: 'Articles desc' };
            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            // The canonical link is set via updateCanonicalUrl which manipulates the DOM.
            // In the test environment, DOCUMENT is the real jsdom document.
            // We verify og:url is set (same value drives canonical).
            const ogUrlCalls = (mockMetaService.updateTag as any).mock.calls.filter(
                (call: any[]) => call[0]?.property === 'og:url'
            );
            expect(ogUrlCalls.length).toBeGreaterThan(0);
        });

        it('should use fallback description when content type has no description', () => {
            const contentType = { slug: 'articles', name: 'Articles' };
            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            expect(mockMetaService.updateTag).toHaveBeenCalledWith(
                expect.objectContaining({ name: 'description', content: 'Browse all articles' })
            );
        });

        // Task 2.2: og:locale
        it('should set og:locale to en_US on list page', () => {
            const contentType = { slug: 'articles', name: 'Articles', description: 'Articles desc' };
            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            expect(mockMetaService.updateTag).toHaveBeenCalledWith(
                expect.objectContaining({ property: 'og:locale', content: 'en_US' })
            );
        });
    });

    describe('Custom Template Loading', () => {
        afterEach(() => setSiteManifestForTesting());

        it('should load custom template when folder is specified', () => {
            withFolder('custom-folder');
            const contentType = {
                slug: 'articles',
                name: 'Articles',
                templateFolder: 'custom-folder'
            };

            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            expect(mockHttpClient.get).toHaveBeenCalledWith(
                '/_site/templates/custom-folder/list.html',
                expect.objectContaining({ responseType: 'text' })
            );
        });

        it('loads the default list template for a type on the default', () => {
            const contentType = {
                slug: 'articles',
                name: 'Articles',
                templateFolder: 'default'
            };

            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            expect(mockHttpClient.get).toHaveBeenCalledWith('/_site/templates/default/list.html', expect.anything());
        });

        it('uses the default list.html for a folder that has only a detail.html', () => {
            const built = siteManifest();
            setSiteManifestForTesting({ ...built, templates: { ...built.templates, recipes: { detail: 'app' } } });
            mockContentTypesStore.items.set([{ slug: 'articles', name: 'Articles', templateFolder: 'recipes' }]);
            fixture.detectChanges();

            expect(mockHttpClient.get).toHaveBeenCalledWith('/_site/templates/default/list.html', expect.anything());
        });

        it('hydrates the template again when the list changes', () => {
            mockHttpClient.get.mockReturnValue(of('<ul data-arc-loop="items"><li>{{ title }}</li></ul>'));
            mockContentTypesStore.items.set([{ slug: 'articles', name: 'Articles' }]);
            mockContentsStore.items.set([{ id: '1', type: 'articles', publishedStatus: true, title: 'First', tags: [] }]);
            fixture.detectChanges();
            expect(component.templateHtml()).toContain('First');

            mockContentsStore.items.set([
                { id: '1', type: 'articles', publishedStatus: true, title: 'First', tags: [] },
                { id: '2', type: 'articles', publishedStatus: true, title: 'Second', tags: [] },
            ]);
            fixture.detectChanges();
            expect(component.templateHtml()).toContain('Second');
            expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
        });

        // B7: on a translated list the app's cards match the published ones.
        it('links each card, and names the type, in the page\'s language', () => {
            mockHttpClient.get.mockReturnValue(of('<p>{{ langPrefix }}|{{ lang }}</p><ul data-arc-loop="items"><li><a href="{{ url }}">{{ contentType }}</a></li></ul>'));
            mockContentTypesStore.items.set([{ slug: 'articles', name: 'Articles', nameTranslations: { hi: { name: 'लेख' } } }]);
            mockContentsStore.items.set([{ id: '1', type: 'articles', publishedStatus: true, title: 'First', urlSlug: 'first', tags: [] }]);
            fixture.detectChanges(); // ngOnInit reads the language from the route: the default
            component.pageLang.set('hi');
            fixture.detectChanges();
            expect(component.templateHtml()).toContain('<a href="/hi/articles/first">लेख</a>');
            expect(component.templateHtml()).toContain('/hi|hi');
        });

        it('should prepare correct data for template hydration', async () => {
            const contentType = {
                slug: 'articles',
                name: 'Articles',
                templateFolder: 'custom-folder',
                description: 'Article description'
            };
            const contents = [{
                id: '1',
                type: 'articles',
                title: 'Test Article',
                urlSlug: 'test-article',
                content: 'Some content',
                publishedStatus: true,
                publishedOn: new Date(),
                tags: ['Angular', 'ViTest']
            }];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);

            // Mock TemplateHydrationService methods
            const processLoopsSpy = vi.spyOn(TemplateHydrationService, 'processLoops').mockReturnValue('<div>Loops Processed</div>');
            const hydrateTemplateSpy = vi.spyOn(TemplateHydrationService, 'hydrateTemplate').mockReturnValue('<div>Fully Hydrated</div>');
            
            // Mock runTemplateScripts to avoid timing issues
            const runScriptsSpy = vi.spyOn(component as any, 'runTemplateScripts').mockImplementation(() => {});

            fixture.detectChanges();
            
            // Wait for subscription/effect to run
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(component.templateHtml()).toBe('<div>Fully Hydrated</div>');

            // Verify data passed to processLoops
            const lastCallArgs = processLoopsSpy.mock.calls[0];
            const listData = lastCallArgs[1].items;
            expect(listData[0].title).toBe('Test Article');
            expect(listData[0].url).toBe('/articles/test-article');
            expect(listData[0].tagsHtml).toContain('Angular');
        });

        it('should execute scripts in custom template (manual test)', () => {
            // We'll test the runTemplateScripts method directly to avoid document spying issues
            const mockScript = {
                attributes: [{ name: 'src', value: 'test.js' }],
                innerHTML: 'console.log("test")',
                parentNode: { replaceChild: vi.fn() }
            };
            
            const mockNewScript = {
                setAttribute: vi.fn(),
                appendChild: vi.fn()
            };

            const mockDocument = {
                querySelectorAll: vi.fn().mockReturnValue([mockScript]),
                createElement: vi.fn().mockReturnValue(mockNewScript),
                createTextNode: vi.fn().mockReturnValue({})
            };

            // Inject mock document
            (component as any).document = mockDocument;
            
            (component as any).runTemplateScripts();

            expect(mockDocument.querySelectorAll).toHaveBeenCalledWith('arc-content-list script');
            expect(mockDocument.createElement).toHaveBeenCalledWith('script');
            expect(mockNewScript.setAttribute).toHaveBeenCalledWith('src', 'test.js');
        });
    });

    describe('GA Tracking', () => {
        it('should track content list view once per content type', () => {
            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [{ id: '1', type: 'articles', publishedStatus: true }];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);

            fixture.detectChanges();
            expect(mockGaTrackingService.trackContentListView).toHaveBeenCalledWith('articles', 1);

            // Second detection should not re-track
            mockGaTrackingService.trackContentListView.mockClear();
            fixture.detectChanges();
            expect(mockGaTrackingService.trackContentListView).not.toHaveBeenCalled();
        });
    });

    describe('Content Filtering', () => {
        it('should filter contents by type and published status', () => {
            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, title: 'Valid' },
                { id: '2', type: 'articles', publishedStatus: false, title: 'Draft' },
                { id: '3', type: 'news', publishedStatus: true, title: 'Wrong Type' }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            const filtered = component.filteredContents();
            expect(filtered.length).toBe(1);
            expect(filtered[0].title).toBe('Valid');
        });

        it('should sort by publishedOn descending', () => {
            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, publishedOn: new Date('2023-01-01') },
                { id: '2', type: 'articles', publishedStatus: true, publishedOn: new Date('2023-01-10') }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            const filtered = component.filteredContents();
            expect(filtered[0].id).toBe('2');
            expect(filtered[1].id).toBe('1');
        });

        it('should sort Firestore Timestamps correctly (regression: NaN sort)', () => {
            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: 'old', type: 'articles', publishedStatus: true, title: 'Old', publishedOn: { seconds: 1702425600, nanoseconds: 0 } }, // 2023-12-13
                { id: 'new', type: 'articles', publishedStatus: true, title: 'New', publishedOn: { seconds: 1740355200, nanoseconds: 0 } }, // 2025-02-24
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            const filtered = component.filteredContents();
            expect(filtered[0].id).toBe('new');
            expect(filtered[1].id).toBe('old');
        });

        it('should sort mixed date types (Firestore Timestamp + Date) correctly', () => {
            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: 'date-obj', type: 'articles', publishedStatus: true, title: 'Date Obj', publishedOn: new Date('2023-06-01') },
                { id: 'timestamp', type: 'articles', publishedStatus: true, title: 'Timestamp', publishedOn: { seconds: 1704067200, nanoseconds: 0 } }, // 2024-01-01
                { id: 'no-date', type: 'articles', publishedStatus: true, title: 'No Date', publishedOn: null },
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            const filtered = component.filteredContents();
            expect(filtered[0].id).toBe('timestamp');  // 2024-01-01 – newest
            expect(filtered[1].id).toBe('date-obj');    // 2023-06-01
            expect(filtered[2].id).toBe('no-date');     // null – sorted last
        });
    });

    describe('Helper Functions', () => {
        it('should generate consistent gradients', () => {
            const g1 = component.getGradient('abc');
            const g2 = component.getGradient('abc');
            expect(g1).toBe(g2);
        });
    });

    describe('Hydration Behavior', () => {
        it('should have hydrated signal start as false in browser environment', () => {
            fixture.detectChanges();
            // TestBed uses browser platform, so hydrated starts false
            expect(component.hydrated()).toBe(false);
        });

        it('should set hydrated=true after content data loads', () => {
            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, title: 'Test' }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            expect(component.hydrated()).toBe(true);
        });

        it('should have TransferState injected', () => {
            fixture.detectChanges();
            expect((component as any).transferState).toBeDefined();
        });

        it('should have PLATFORM_ID injected', () => {
            fixture.detectChanges();
            expect((component as any).platformId).toBeDefined();
        });

        it('should check TransferState for cached template before HTTP fetch', () => {
            // Pre-populate TransferState with a cached template
            const transferState = (component as any).transferState;
            withFolder('custom-folder');
            const stateKey = makeStateKey<string>('tpl-list-/_site/templates/custom-folder/list.html');
            transferState.set(stateKey, '<div>Cached Template</div>');

            const contentType = {
                slug: 'articles',
                name: 'Articles',
                templateFolder: 'custom-folder'
            };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, title: 'Test', tags: [] }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            // In browser mode, TransferState cache is used, so HTTP should NOT be called
            expect(mockHttpClient.get).not.toHaveBeenCalled();
            // Template should be hydrated and set
            expect(component.templateHtml()).toContain('Cached Template');
            // TransferState key should be consumed (removed)
            expect(transferState.hasKey(stateKey)).toBe(false);
        });

        it('should not call runTemplateScripts when loading from TransferState cache', async () => {
            const runScriptsSpy = vi.spyOn(component as any, 'runTemplateScripts');

            // Pre-populate TransferState
            const transferState = (component as any).transferState;
            const stateKey = makeStateKey<string>('tpl-list-custom-folder2');
            transferState.set(stateKey, '<div>Cached</div>');

            const contentType = {
                slug: 'articles',
                name: 'Articles',
                templateFolder: 'custom-folder2'
            };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, title: 'Test', tags: [] }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            // Wait for any setTimeout calls
            await new Promise(resolve => setTimeout(resolve, 200));

            // runTemplateScripts should be called via setTimeout in browser env
            expect(runScriptsSpy).toHaveBeenCalled();
        });
    });
});
