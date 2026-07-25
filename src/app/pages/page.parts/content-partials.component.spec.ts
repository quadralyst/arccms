import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReadableStream } from 'stream/web';
(global as any).ReadableStream = ReadableStream;
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ContentPartialsComponent } from './content-partials.component';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { signal, makeStateKey, TransferState } from '@angular/core';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { ActivatedRoute, Router } from '@angular/router';
import { GlobalService } from '../../../shared/services/global.service';
import { ToastService } from '../../../shared/services/toast.service';

describe('ContentPartialsComponent', () => {
    let component: ContentPartialsComponent;
    let fixture: ComponentFixture<ContentPartialsComponent>;
    let mockContentsStore: any;
    let mockContentTypesStore: any;
    let mockHttpClient: any;
    let mockGlobalService: any;
    let mockToastService: any;

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
            getAll: vi.fn(),
            unsubscribeStore: vi.fn(),
        };

        mockHttpClient = {
            get: vi.fn().mockReturnValue(of('<div>Template</div>')),
        };

        mockGlobalService = {
            debugMode: false,
            convertToNormalString: vi.fn((str: string) => str),
        };

        mockToastService = {
            showSuccess: vi.fn(),
            showError: vi.fn(),
        };

        await TestBed.configureTestingModule({
            imports: [ContentPartialsComponent],
            providers: [
                { provide: ContentsStore, useValue: mockContentsStore },
                { provide: ContentTypesStore, useValue: mockContentTypesStore },
                { provide: HttpClient, useValue: mockHttpClient },
                { provide: GlobalService, useValue: mockGlobalService },
                { provide: ToastService, useValue: mockToastService },
                { provide: Router, useValue: { navigate: vi.fn() } },
                {
                    provide: ActivatedRoute,
                    useValue: {
                        snapshot: { paramMap: { get: () => null } },
                        paramMap: of({ get: () => null, keys: [] }),
                        queryParams: of({}),
                    }
                },
            ]
        })
            // ContentPartialsComponent declares `providers: [ContentsStore]`, which shadows the
            // root-level mock above. Override the component-level provider so the component
            // resolves the mock instead of constructing a real store (which needs Firestore).
            .overrideComponent(ContentPartialsComponent, {
                set: {
                    providers: [
                        { provide: ContentsStore, useValue: mockContentsStore },
                    ]
                }
            })
            .compileComponents();

        fixture = TestBed.createComponent(ContentPartialsComponent);
        component = fixture.componentInstance;
    });

    it('should create', () => {
        fixture.detectChanges();
        expect(component).toBeTruthy();
    });

    describe('Input Bindings', () => {
        it('should have default contentType of "articles"', () => {
            fixture.detectChanges();
            expect(component.contentType()).toBe('articles');
        });

        it('should accept contentType input', () => {
            fixture.componentRef.setInput('contentType', 'news');
            fixture.detectChanges();
            expect(component.contentType()).toBe('news');
        });

        it('should accept count input with default of 4', () => {
            fixture.detectChanges();
            expect(component.count()).toBe(4);
        });

        it('should accept custom count input', () => {
            fixture.componentRef.setInput('count', 10);
            fixture.detectChanges();
            expect(component.count()).toBe(10);
        });

        it('should have default sectionTitle of "Latest Updates"', () => {
            fixture.detectChanges();
            expect(component.sectionTitle()).toBe('Latest Updates');
        });

        it('should accept sectionTitle input', () => {
            fixture.componentRef.setInput('sectionTitle', 'Featured Posts');
            fixture.detectChanges();
            expect(component.sectionTitle()).toBe('Featured Posts');
        });

        it('should accept templateFolder input', () => {
            fixture.componentRef.setInput('templateFolder', 'custom-templates');
            fixture.detectChanges();
            expect(component.templateFolder()).toBe('custom-templates');
        });
    });

    describe('Display Title', () => {
        it('should use sectionTitle if provided', () => {
            fixture.componentRef.setInput('contentType', 'articles');
            fixture.componentRef.setInput('sectionTitle', 'My Custom Title');

            const contentType = { slug: 'articles', name: 'Articles' };
            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            expect(component.displayTitle()).toBe('My Custom Title');
        });

        it('should use default sectionTitle if not provided', () => {
            fixture.componentRef.setInput('contentType', 'articles');
            // No sectionTitle provided, should use default 'Latest Updates'

            const contentType = { slug: 'articles', name: 'Articles' };
            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            expect(component.displayTitle()).toBe('Latest Updates');
        });

        it('should generate title from content type name if sectionTitle is explicitly cleared', () => {
            fixture.componentRef.setInput('contentType', 'articles');
            fixture.componentRef.setInput('sectionTitle', ''); // Clear default

            const contentType = { slug: 'articles', name: 'Articles' };
            mockContentTypesStore.items.set([contentType]);
            fixture.detectChanges();

            expect(component.displayTitle()).toBe('Latest Articles');
        });

        it('should fall back to "Latest Content" if no content type and no section title', () => {
            fixture.componentRef.setInput('contentType', 'nonexistent');
            fixture.componentRef.setInput('sectionTitle', ''); // Clear default
            fixture.detectChanges();

            expect(component.displayTitle()).toBe('Latest Content');
        });
    });

    describe('Custom Template Loading', () => {
        it('should load custom template when templateFolder is specified', () => {
            fixture.componentRef.setInput('contentType', 'articles');
            fixture.componentRef.setInput('templateFolder', 'custom-folder');

            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, title: 'Test' }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            expect(mockHttpClient.get).toHaveBeenCalledWith(
                '/templates/custom-folder/partials.html',
                expect.objectContaining({ responseType: 'text' })
            );
        });

        it('should load template from content type templateFolder if no input override', () => {
            fixture.componentRef.setInput('contentType', 'articles');

            const contentType = { slug: 'articles', name: 'Articles', templateFolder: 'articles' };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, title: 'Test' }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            expect(mockHttpClient.get).toHaveBeenCalledWith(
                '/templates/articles/partials.html',
                expect.objectContaining({ responseType: 'text' })
            );
        });

        it('should NOT load custom template if folder is default', () => {
            fixture.componentRef.setInput('contentType', 'articles');

            const contentType = { slug: 'articles', name: 'Articles', templateFolder: 'default' };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, title: 'Test' }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            expect(mockHttpClient.get).not.toHaveBeenCalled();
            expect(component.useCustomTemplate()).toBe(false);
        });

        it('should fall back to default template on HTTP error', () => {
            fixture.componentRef.setInput('contentType', 'articles');
            fixture.componentRef.setInput('templateFolder', 'nonexistent');
            mockHttpClient.get.mockReturnValue(throwError(() => new Error('Not found')));

            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, title: 'Test' }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            expect(component.useCustomTemplate()).toBe(false);
        });
    });

    describe('Content Filtering', () => {
        beforeEach(() => {
            fixture.componentRef.setInput('contentType', 'articles');
        });

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

        it('should limit results to count input', () => {
            fixture.componentRef.setInput('count', 2);

            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, title: 'First' },
                { id: '2', type: 'articles', publishedStatus: true, title: 'Second' },
                { id: '3', type: 'articles', publishedStatus: true, title: 'Third' },
                { id: '4', type: 'articles', publishedStatus: true, title: 'Fourth' }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            const filtered = component.filteredContents();
            expect(filtered.length).toBe(2);
        });

        it('should sort by publishedOn descending (newest first)', () => {
            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, publishedOn: new Date('2023-01-01') },
                { id: '2', type: 'articles', publishedStatus: true, publishedOn: new Date('2023-01-10') }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            const filtered = component.filteredContents();
            expect(filtered[0].id).toBe('2'); // Newest first
            expect(filtered[1].id).toBe('1');
        });

        it('should sort Firestore Timestamps correctly (regression: NaN sort)', () => {
            const contentType = { slug: 'articles', name: 'Articles' };
            // Firestore returns {seconds, nanoseconds} — not Date objects
            const contents = [
                { id: 'old', type: 'articles', publishedStatus: true, publishedOn: { seconds: 1702425600, nanoseconds: 0 } },  // Dec 13, 2023
                { id: 'new', type: 'articles', publishedStatus: true, publishedOn: { seconds: 1740355200, nanoseconds: 0 } },  // Feb 24, 2025
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            const filtered = component.filteredContents();
            expect(filtered[0].id).toBe('new'); // Newest first
            expect(filtered[1].id).toBe('old');
        });

        it('should sort mixed date types (Firestore Timestamp + Date) correctly', () => {
            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: 'date-obj', type: 'articles', publishedStatus: true, publishedOn: new Date('2023-06-01') },
                { id: 'timestamp', type: 'articles', publishedStatus: true, publishedOn: { seconds: 1704067200, nanoseconds: 0 } }, // Jan 1, 2024
                { id: 'no-date', type: 'articles', publishedStatus: true, publishedOn: null },
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            const filtered = component.filteredContents();
            expect(filtered[0].id).toBe('timestamp'); // Jan 2024 — newest
            expect(filtered[1].id).toBe('date-obj');   // Jun 2023
            expect(filtered[2].id).toBe('no-date');     // null → epoch 0 → last
        });

        it('should return empty array if contentType not set', () => {
            fixture.componentRef.setInput('contentType', '');
            fixture.detectChanges();

            expect(component.filteredContents().length).toBe(0);
        });
    });

    describe('Helper Functions', () => {
        beforeEach(() => {
            fixture.detectChanges();
        });

        it('should generate consistent gradients for same ID', () => {
            const g1 = component.getGradient('abc');
            const g2 = component.getGradient('abc');
            expect(g1).toBe(g2);
        });

        it('should format dates correctly', () => {
            const date = new Date('2023-06-15');
            const formatted = component.formatContentDate(date);
            expect(formatted).toContain('2023');
            expect(formatted).toContain('Jun');
        });

        it('should handle Firestore timestamp format', () => {
            const firestoreDate = { seconds: 1686787200 }; // 2023-06-15
            const formatted = component.formatContentDate(firestoreDate);
            expect(formatted).toContain('2023');
        });

        it('should return empty string for null date', () => {
            expect(component.formatContentDate(null)).toBe('');
        });

        it('should calculate read time', () => {
            const content = { content: 'Word '.repeat(200) } as any;
            const readTime = component.getReadTime(content);
            expect(readTime).toBeGreaterThan(0);
        });

        it('should use existing readTime if available', () => {
            const content = { readTime: 5, content: 'Short' } as any;
            expect(component.getReadTime(content)).toBe(5);
        });

        it('should generate excerpt from metaDescription', () => {
            const content = { metaDescription: 'This is the meta description' } as any;
            const excerpt = component.getExcerpt(content);
            expect(excerpt).toBe('This is the meta description');
        });

        it('should generate excerpt from content if no metaDescription', () => {
            const content = { content: '<p>This is the content body</p>' } as any;
            const excerpt = component.getExcerpt(content);
            expect(excerpt).toContain('This is the content body');
        });

        it('should truncate long excerpts', () => {
            const longContent = 'Word '.repeat(50);
            const content = { content: longContent } as any;
            const excerpt = component.getExcerpt(content);
            expect(excerpt.endsWith('...')).toBe(true);
        });
    });

    describe('Current Content Type', () => {
        it('should find matching content type by slug', () => {
            fixture.componentRef.setInput('contentType', 'articles');

            const contentTypes = [
                { slug: 'news', name: 'News' },
                { slug: 'articles', name: 'Articles' }
            ];
            mockContentTypesStore.items.set(contentTypes);
            fixture.detectChanges();

            expect(component.currentContentType()?.name).toBe('Articles');
        });

        it('should return null if content type not found', () => {
            fixture.componentRef.setInput('contentType', 'nonexistent');

            const contentTypes = [{ slug: 'articles', name: 'Articles' }];
            mockContentTypesStore.items.set(contentTypes);
            fixture.detectChanges();

            expect(component.currentContentType()).toBeNull();
        });
    });

    describe('Hydration Behavior', () => {
        it('should have hydrated signal start as false in browser environment', () => {
            fixture.detectChanges();
            // TestBed uses browser platform, so hydrated starts false
            expect(component.hydrated()).toBe(false);
        });

        it('should set hydrated=true after content data loads', () => {
            fixture.componentRef.setInput('contentType', 'articles');

            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, title: 'Test', publishedOn: new Date() }
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
            const stateKey = makeStateKey<string>('tpl-partials-custom-folder');
            transferState.set(stateKey, '<div>Cached Template</div>');

            fixture.componentRef.setInput('contentType', 'articles');
            fixture.componentRef.setInput('templateFolder', 'custom-folder');

            const contentType = { slug: 'articles', name: 'Articles' };
            const contents = [
                { id: '1', type: 'articles', publishedStatus: true, title: 'Test', publishedOn: new Date() }
            ];

            mockContentTypesStore.items.set([contentType]);
            mockContentsStore.items.set(contents);
            fixture.detectChanges();

            // In browser mode, TransferState cache is used, so HTTP should NOT be called
            expect(mockHttpClient.get).not.toHaveBeenCalled();
            // Template should be hydrated and set
            expect(component.useCustomTemplate()).toBe(true);
            // TransferState key should be consumed (removed)
            expect(transferState.hasKey(stateKey)).toBe(false);
        });
    });
});
