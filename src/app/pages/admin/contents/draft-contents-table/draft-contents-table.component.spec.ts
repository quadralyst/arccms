import { ComponentFixture, TestBed } from '@angular/core/testing';
import { headerTestProviders } from '../../../../../test/header-test-providers';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { DraftContentsTableComponent } from './draft-contents-table.component';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';
import { ContentsStore } from '../content-store/published-contents.store';
import { ContentTypesStore } from '../content-types/content-types.store';
import { GlobalService } from '../../../../../shared/services/global.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { DomSanitizer } from '@angular/platform-browser';
import { PageEvent } from '@angular/material/paginator';
import { MatDialog } from '@angular/material/dialog';
import { Firestore } from '@angular/fire/firestore';
import { ContentTypesService } from '../content-types/content-types.service';
import { DatePipe } from '@angular/common';
import { PublishQueueService } from '../publish-queue/publish-queue.service';

describe('DraftContentsTableComponent', () => {
    let component: DraftContentsTableComponent;
    let fixture: ComponentFixture<DraftContentsTableComponent>;
    let mockRouter: any;
    let mockActivatedRoute: any;
    let mockDraftContentsStore: any;
    let mockContentsStore: any;
    let mockContentTypesStore: any;
    let mockGlobalService: any;
    let mockToastService: any;
    let mockSanitizer: any;
    let mockMatDialog: any;
    let dialogResult: boolean;

    const sampleContents = [
        { id: '1', title: 'Article One', type: 'article', publishedStatus: true, isFeatured: false, modifiedAt: new Date() },
        { id: '2', title: 'Article Two', type: 'blog', publishedStatus: false, isFeatured: true, modifiedAt: new Date() },
    ];

    beforeEach(async () => {
        // Configure dialog to return true by default
        dialogResult = true;

        mockRouter = {
            navigate: vi.fn().mockResolvedValue(true),
        };

        mockActivatedRoute = {
            paramMap: of({ keys: [], get: () => null }),
            queryParams: of({})
        };

        mockDraftContentsStore = {
            items: signal(sampleContents),
            currentItem: signal({}),
            isLoading: signal(false),
            totalRecords: signal(2),
            getAll: vi.fn(() => of(sampleContents)),
            clearList: vi.fn(),
            delete: vi.fn().mockReturnValue(of({})),
            update: vi.fn().mockReturnValue(of({})),
            unsubscribeStore: vi.fn(),
        };

        mockContentsStore = {
            items: signal([]),
            update: vi.fn().mockReturnValue(of({})),
            unsubscribeStore: vi.fn(),
        };

        mockContentTypesStore = {
            items: signal([{ name: 'Article', slug: 'article' }, { name: 'Blog', slug: 'blog' }]),
            isLoading: signal(false),
            getAll: vi.fn(() => of([])),
            unsubscribeStore: vi.fn(),
        };

        mockGlobalService = {
            goBack: vi.fn(),
            debugMode: false,
        };

        mockToastService = {
            success: vi.fn(),
            error: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
        };

        mockSanitizer = {
            bypassSecurityTrustHtml: vi.fn((html) => html),
        };

        mockMatDialog = {
            open: vi.fn().mockReturnValue({
                afterClosed: () => of(dialogResult)
            })
        };

        await TestBed.configureTestingModule({
            imports: [DraftContentsTableComponent, NoopAnimationsModule],
            providers: [
                ...headerTestProviders(),
                { provide: DraftContentsStore, useValue: mockDraftContentsStore },
                { provide: ContentsStore, useValue: mockContentsStore },
                { provide: ContentTypesStore, useValue: mockContentTypesStore },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: GlobalService, useValue: mockGlobalService },
                { provide: ToastService, useValue: mockToastService },
                { provide: DomSanitizer, useValue: mockSanitizer },
                { provide: MatDialog, useValue: mockMatDialog },
                { provide: Firestore, useValue: {} },
                { provide: ContentTypesService, useValue: { update: vi.fn().mockReturnValue(of({})) } },
                { provide: PublishQueueService, useValue: { enqueue: vi.fn().mockResolvedValue(undefined) } },
                { provide: DatePipe, useValue: { transform: vi.fn((date: any, format?: string) => {
                        if (!date) return null;
                        try {
                            const d = date instanceof Date ? date : new Date(date);
                            if (isNaN(d.getTime())) return null;
                            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            return `${months[d.getMonth()]} ${String(d.getDate()).padStart(2, '0')}, ${d.getFullYear()}`;
                        } catch { return null; }
                    }) } }
            ]
        })
            .overrideComponent(DraftContentsTableComponent, {
                set: {
                    providers: [
                        { provide: ContentTypesService, useValue: { update: vi.fn().mockReturnValue(of({})) } },
                    ]
                }
            })
            .overrideProvider(MatDialog, { useValue: mockMatDialog })
            .overrideProvider(ContentTypesService, { useValue: { update: vi.fn().mockReturnValue(of({})) } })
            .overrideProvider(Firestore, { useValue: {} })
            .compileComponents();

        fixture = TestBed.createComponent(DraftContentsTableComponent);
        component = fixture.componentInstance;

        // Override the private dialogService to use our mock
        (component as any).dialogService = mockMatDialog;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Initialization', () => {
        it('should subscribe to data on init', () => {
            component.ngOnInit();
            expect(mockDraftContentsStore.getAll).toBeDefined();
        });

        it('should return draft contents from computed', () => {
            const data = component.draftContentsData();
            expect(data.length).toBe(2);
            expect(data[0].title).toBe('Article One');
        });

        it('should not reload content types if already loaded', () => {
            // Content types are already loaded (items signal has data)
            component.ngOnInit();
            // getAll should NOT be called since items already has data
            expect(mockContentTypesStore.getAll).not.toHaveBeenCalled();
        });

        it('should initialize with default sort field as modifiedAt', () => {
            expect(component.sortField()).toBe('modifiedAt');
        });

        it('should initialize with default sort order as desc', () => {
            expect(component.sortOrder()).toBe('desc');
        });

        it('should initialize with default page size of 10', () => {
            expect(component.pageSizeSignal()).toBe(10);
        });

        it('should initialize with current page 0', () => {
            expect(component.currentPageNum()).toBe(0);
        });

        it('should initialize with empty filters', () => {
            expect(Object.keys(component.filters()).length).toBe(0);
        });

        it('should have filterable columns defined', () => {
            expect(component.filterableColumns.length).toBeGreaterThan(0);
            expect(component.filterableColumns[0].field).toBe('title');
        });
    });

    describe('Content Type Slug Changes (ngOnChanges)', () => {
        it('should re-fetch data when contentTypeSlug changes', () => {
            component.ngOnInit();
            vi.clearAllMocks();

            component.contentTypeSlug = 'articles';
            component.ngOnChanges({
                contentTypeSlug: {
                    currentValue: 'articles',
                    previousValue: 'blogs',
                    firstChange: false,
                    isFirstChange: () => false
                }
            });

            expect(mockDraftContentsStore.getAll).toHaveBeenCalled();
        });

        it('should reset pagination when contentTypeSlug changes', () => {
            component.currentPageNum.set(3);
            component.ngOnInit();
            vi.clearAllMocks();

            component.ngOnChanges({
                contentTypeSlug: {
                    currentValue: 'articles',
                    previousValue: 'blogs',
                    firstChange: false,
                    isFirstChange: () => false
                }
            });

            expect(component.currentPageNum()).toBe(0);
        });

        it('should clear filters when contentTypeSlug changes', () => {
            component.filters.set({ title: 'test' });
            component.ngOnInit();
            vi.clearAllMocks();

            component.ngOnChanges({
                contentTypeSlug: {
                    currentValue: 'articles',
                    previousValue: 'blogs',
                    firstChange: false,
                    isFirstChange: () => false
                }
            });

            expect(Object.keys(component.filters()).length).toBe(0);
        });

        it('should also re-fetch on first change (ngOnChanges always triggers fetchData)', () => {
            vi.clearAllMocks();
            component.ngOnChanges({
                contentTypeSlug: {
                    currentValue: 'articles',
                    previousValue: undefined,
                    firstChange: true,
                    isFirstChange: () => true
                }
            });

            // ngOnChanges always triggers fetchData for contentTypeSlug changes
            expect(mockDraftContentsStore.getAll).toHaveBeenCalled();
        });

        it('should not react to changes in other properties', () => {
            component.ngOnInit();
            vi.clearAllMocks();

            component.ngOnChanges({
                someOtherProperty: {
                    currentValue: 'new',
                    previousValue: 'old',
                    firstChange: false,
                    isFirstChange: () => false
                }
            });

            expect(mockDraftContentsStore.getAll).not.toHaveBeenCalled();
        });
    });

    describe('URL Parameter Handling', () => {
        it('should use default sort field when no URL params provided', () => {
            component.ngOnInit();
            expect(component.sortField()).toBe('modifiedAt');
            expect(component.sortOrder()).toBe('desc');
        });

        it('should use default pagination when no URL params provided', () => {
            component.ngOnInit();
            expect(component.currentPageNum()).toBe(0);
            expect(component.pageSizeSignal()).toBe(10);
        });

        it('should use default empty filters when no URL params provided', () => {
            component.ngOnInit();
            expect(Object.keys(component.filters()).length).toBe(0);
        });
    });

    describe('Sorting', () => {
        it('should set sort field when setSortField is called', () => {
            component.setSortField('title');
            expect(component.sortField()).toBe('title');
        });

        it('should toggle sort order when clicking same field', () => {
            component.sortField.set('title');
            component.sortOrder.set('asc');

            component.setSortField('title');

            expect(component.sortOrder()).toBe('desc');
        });

        it('should reset to asc when clicking different field', () => {
            component.sortField.set('title');
            component.sortOrder.set('desc');

            component.setSortField('modifiedAt');

            expect(component.sortField()).toBe('modifiedAt');
            expect(component.sortOrder()).toBe('asc');
        });

        it('should return correct sort icon for active field asc', () => {
            component.sortField.set('title');
            component.sortOrder.set('asc');

            expect(component.getSortIcon('title')).toBe('arrow_upward');
        });

        it('should return correct sort icon for active field desc', () => {
            component.sortField.set('title');
            component.sortOrder.set('desc');

            expect(component.getSortIcon('title')).toBe('arrow_downward');
        });

        it('should return unfold_more for inactive field', () => {
            component.sortField.set('title');

            expect(component.getSortIcon('modifiedAt')).toBe('unfold_more');
        });

        it('should return true for isSortedBy when field matches', () => {
            component.sortField.set('title');

            expect(component.isSortedBy('title')).toBe(true);
            expect(component.isSortedBy('modifiedAt')).toBe(false);
        });

        it('should navigate with query params when sorting', () => {
            component.setSortField('title');

            expect(mockRouter.navigate).toHaveBeenCalledWith([], expect.objectContaining({
                queryParams: expect.objectContaining({
                    sort: 'title',
                    order: 'asc'
                }),
                queryParamsHandling: 'merge'
            }));
        });
    });

    describe('Pagination', () => {
        it('should update page index on page change', () => {
            const event: PageEvent = { pageIndex: 2, pageSize: 10, length: 100 };
            component.onPageChange(event);

            expect(component.currentPageNum()).toBe(2);
        });

        it('should update page size on page change', () => {
            const event: PageEvent = { pageIndex: 0, pageSize: 25, length: 100 };
            component.onPageChange(event);

            expect(component.pageSizeSignal()).toBe(25);
        });

        it('should navigate with query params on page change', () => {
            const event: PageEvent = { pageIndex: 1, pageSize: 10, length: 100 };
            component.onPageChange(event);

            expect(mockRouter.navigate).toHaveBeenCalledWith([], expect.objectContaining({
                queryParams: expect.objectContaining({
                    page: 1,
                    size: 10
                })
            }));
        });

        it('should return correct start record', () => {
            component.currentPageNum.set(0);
            component.pageSizeSignal.set(10);
            mockDraftContentsStore.totalRecords.set(25);

            expect(component.getStartRecord()).toBe(1);
        });

        it('should return correct start record for page 2', () => {
            component.currentPageNum.set(1);
            component.pageSizeSignal.set(10);
            mockDraftContentsStore.totalRecords.set(25);

            expect(component.getStartRecord()).toBe(11);
        });

        it('should return 0 for start record when no records', () => {
            mockDraftContentsStore.totalRecords.set(0);

            expect(component.getStartRecord()).toBe(0);
        });

        it('should return correct end record', () => {
            component.currentPageNum.set(0);
            component.pageSizeSignal.set(10);
            mockDraftContentsStore.totalRecords.set(25);

            expect(component.getEndRecord()).toBe(10);
        });

        it('should return total as end record on last page', () => {
            component.currentPageNum.set(2);
            component.pageSizeSignal.set(10);
            mockDraftContentsStore.totalRecords.set(25);

            expect(component.getEndRecord()).toBe(25);
        });
    });

    describe('Filtering', () => {
        it('should update filter on filter change', () => {
            const event = { target: { value: 'test' } };
            component.onFilterChange('title', event);

            expect(component.filters()['title']).toBe('test');
        });

        it('should reset page to 0 on filter change', () => {
            component.currentPageNum.set(2);
            const event = { target: { value: 'test' } };

            component.onFilterChange('title', event);

            expect(component.currentPageNum()).toBe(0);
        });

        it('should remove filter when value is empty', () => {
            component.filters.set({ title: 'test' });
            const event = { target: { value: '' } };

            component.onFilterChange('title', event);

            expect(component.filters()['title']).toBeUndefined();
        });

        it('should clear all filters', () => {
            component.filters.set({ title: 'test', status: 'draft' });

            component.clearFilters();

            expect(Object.keys(component.filters()).length).toBe(0);
        });

        it('should reset page to 0 on clear filters', () => {
            component.currentPageNum.set(2);
            component.filters.set({ title: 'test' });

            component.clearFilters();

            expect(component.currentPageNum()).toBe(0);
        });

        it('should return true for hasActiveFilters when filters exist', () => {
            component.filters.set({ title: 'test' });

            expect(component.hasActiveFilters()).toBe(true);
        });

        it('should return false for hasActiveFilters when no filters', () => {
            component.filters.set({});

            expect(component.hasActiveFilters()).toBe(false);
        });

        it('should navigate with filter params', () => {
            const event = { target: { value: 'test' } };
            component.onFilterChange('title', event);

            expect(mockRouter.navigate).toHaveBeenCalledWith([], expect.objectContaining({
                queryParams: expect.objectContaining({
                    filter_title: 'test'
                })
            }));
        });

        it('should clear status filter when clearFilters is called', () => {
            component.statusFilter.set('published');
            component.filters.set({ title: 'test' });

            component.clearFilters();

            expect(component.statusFilter()).toBe('');
        });

        it('should fetch data after clearing filters', () => {
            component.filters.set({ title: 'test' });
            component.statusFilter.set('draft');
            vi.clearAllMocks();

            component.clearFilters();

            expect(mockDraftContentsStore.getAll).toHaveBeenCalled();
        });

        it('should return true for hasActiveFilters when statusFilter is set', () => {
            component.filters.set({});
            component.statusFilter.set('published');

            expect(component.hasActiveFilters()).toBe(true);
        });
    });

    describe('Delete Item', () => {
        it('should delete item when confirmed', async () => {
            dialogResult = true;
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });

            component.deleteItem(sampleContents[0]);
            await fixture.whenStable();

            expect(mockDraftContentsStore.delete).toHaveBeenCalledWith('1', undefined);
        });

        it('should show success toast after deletion', async () => {
            dialogResult = true;
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });

            component.deleteItem(sampleContents[0]);
            await fixture.whenStable();

            expect(mockToastService.success).toHaveBeenCalledWith('Content deleted successfully.');
        });

        it('should not delete when cancelled', async () => {
            dialogResult = false;
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(false) });

            component.deleteItem(sampleContents[0]);
            await fixture.whenStable();

            expect(mockDraftContentsStore.delete).not.toHaveBeenCalled();
        });
    });

    describe('Open Content', () => {
        it('should navigate to add page for content type when no id and contentTypeSlug is set', () => {
            component.contentTypeSlug = 'articles';
            component.openContent('');

            expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/contents/articles/add']);
        });

        it('should navigate to create-content fallback when no id and no contentTypeSlug', () => {
            component.contentTypeSlug = '';
            component.openContent('');

            expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/contents/create-content']);
        });

        it('should navigate to edit page with correct slug-based route when id provided', () => {
            component.contentTypeSlug = 'articles';
            component.openContent('content-123');

            expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/contents/articles/edit', 'content-123']);
        });

        it('should show error toast when editing without contentTypeSlug', () => {
            component.contentTypeSlug = '';
            component.openContent('content-123');

            expect(mockToastService.error).toHaveBeenCalledWith('Cannot determine content type for editing.');
            expect(mockRouter.navigate).not.toHaveBeenCalled();
        });

        it('should use different slugs for different content types', () => {
            component.contentTypeSlug = 'blogs';
            component.openContent('blog-456');

            expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/contents/blogs/edit', 'blog-456']);
        });
    });


    describe('Unpublish Content', () => {
        it('should unpublish content when confirmed', async () => {
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });

            component.confirmUnpublishContent('content-123');
            await fixture.whenStable();

            // Now updates the draft store (not published contentsStore) and enqueues unpublish via publish queue
            expect(mockDraftContentsStore.update).toHaveBeenCalledWith('content-123', expect.objectContaining({ status: 'draft', publishedStatus: false }));
        });

        it('should not unpublish when cancelled', async () => {
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(false) });

            component.confirmUnpublishContent('content-123');
            await fixture.whenStable();

            expect(mockDraftContentsStore.update).not.toHaveBeenCalled();
        });

        it('should show success toast after unpublishing', async () => {
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });

            component.confirmUnpublishContent('content-123');
            await fixture.whenStable();

            expect(mockToastService.success).toHaveBeenCalledWith('Content unpublished.');
        });
    });

    describe('Publish History', () => {
        it('should set historyOpened with content data', () => {
            const item = { id: 'content-1', urlSlug: 'my-article' };

            component.openPublishHistory(item);

            expect(component.historyOpened).toEqual({
                contentId: 'content-1',
                urlSlug: 'my-article'
            });
        });
    });

    describe('Featured Toggle', () => {
        it('should add to featured when not featured', async () => {
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });
            const item = { id: '1', isFeatured: false };

            component.makeItemFeatured(item);
            await fixture.whenStable();

            expect(mockDraftContentsStore.update).toHaveBeenCalledWith('1', { isFeatured: true });
        });

        it('should remove from featured when already featured', async () => {
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });
            const item = { id: '2', isFeatured: true };

            component.makeItemFeatured(item);
            await fixture.whenStable();

            expect(mockDraftContentsStore.update).toHaveBeenCalledWith('2', { isFeatured: false });
        });

        it('should show appropriate success message when adding', async () => {
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });
            const item = { id: '1', isFeatured: false };

            component.makeItemFeatured(item);
            await fixture.whenStable();

            expect(mockToastService.success).toHaveBeenCalledWith('Content added to featured successfully.');
        });

        it('should show appropriate success message when removing', async () => {
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });
            const item = { id: '2', isFeatured: true };

            component.makeItemFeatured(item);
            await fixture.whenStable();

            expect(mockToastService.success).toHaveBeenCalledWith('Content removed from featured successfully.');
        });

        it('should not toggle when cancelled', async () => {
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(false) });
            const item = { id: '1', isFeatured: false };

            component.makeItemFeatured(item);
            await fixture.whenStable();

            expect(mockDraftContentsStore.update).not.toHaveBeenCalled();
        });
    });

    describe('Search', () => {
        it('should have searchTerm signal', () => {
            expect(component.searchTerm).toBeDefined();
            expect(component.searchTerm()).toBe('');
        });

        it('should update searchTerm', () => {
            component.searchTerm.set('test search');
            expect(component.searchTerm()).toBe('test search');
        });
    });

    describe('Content Type Slug Validation', () => {
        it('should return true for isValidSlug when no slug', () => {
            component.contentTypeSlug = '';
            expect(component.isValidSlug()).toBe(true);
        });

        it('should return true for isValidSlug when slug exists in content types', () => {
            component.contentTypeSlug = 'article';
            expect(component.isValidSlug()).toBe(true);
        });

        it('should return false for isValidSlug when slug not found', () => {
            mockContentTypesStore.items.set([{ name: 'Article', slug: 'article' }]);
            mockContentTypesStore.isLoading.set(false);
            component.contentTypeSlug = 'nonexistent';

            expect(component.isValidSlug()).toBe(false);
        });

        it('should return error message for invalid slug', () => {
            mockContentTypesStore.items.set([{ name: 'Article', slug: 'article' }]);
            mockContentTypesStore.isLoading.set(false);
            component.contentTypeSlug = 'nonexistent';

            expect(component.invalidSlugMessage()).toContain('nonexistent');
            expect(component.invalidSlugMessage()).toContain('does not exist');
        });
    });

    describe('Date Formatting', () => {
        it('should return -- for null date', () => {
            expect(component.formatDate(null)).toBe('--');
        });

        it('should return -- for undefined date', () => {
            expect(component.formatDate(undefined)).toBe('--');
        });

        it('should format regular Date object', () => {
            const date = new Date('2024-01-15');
            const result = component.formatDate(date);
            expect(result).toContain('Jan');
            expect(result).toContain('15');
            expect(result).toContain('2024');
        });

        it('should handle Firestore timestamp with toDate method', () => {
            const mockTimestamp = {
                toDate: () => new Date('2024-01-15')
            };
            const result = component.formatDate(mockTimestamp);
            expect(result).toContain('Jan');
        });

        it('should handle Firestore timestamp with seconds property', () => {
            const mockTimestamp = {
                seconds: 1705305600, // Jan 15, 2024
                nanoseconds: 0
            };
            const result = component.formatDate(mockTimestamp);
            expect(result).not.toBe('--');
        });
    });
});

