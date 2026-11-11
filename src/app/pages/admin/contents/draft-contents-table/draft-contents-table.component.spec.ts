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
import { DraftContentsService } from '../draft-content-store/draft-contents.service';

describe('DraftContentsTableComponent', () => {
    let mockDraftContentsService: { createListIndexes: ReturnType<typeof vi.fn>; listForSearch: ReturnType<typeof vi.fn> };
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
            queryParams: of({}),
            snapshot: { queryParams: {} },
        };

        mockDraftContentsStore = {
            currentPageNumber: signal(0),
            items: signal(sampleContents),
            currentItem: signal({}),
            isLoading: signal(false),
            totalRecords: signal(2),
            error: signal(''),
            getAll: vi.fn(() => of(sampleContents)),
            clearList: vi.fn(),
            delete: vi.fn().mockReturnValue(of({})),
            update: vi.fn().mockReturnValue(of({})),
            unsubscribeStore: vi.fn(),
        };

        mockDraftContentsService = {
            createListIndexes: vi.fn().mockResolvedValue(true),
            listForSearch: vi.fn().mockResolvedValue([
                { id: 'a', title: 'Pricing guide', publishedStatus: true, modifiedAt: new Date('2026-01-02') },
                { id: 'b', title: 'Getting started', publishedStatus: false, modifiedAt: new Date('2026-01-03') },
                { id: 'c', title: 'The price list', publishedStatus: false, modifiedAt: new Date('2026-01-01') },
            ]),
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

        // NotifyService translates a key and hands the finished text here, so
        // these assertions still check what a person actually reads.
        mockToastService = {
            success: vi.fn(),
            error: vi.fn(),
            warning: vi.fn(),
            info: vi.fn(),
            openCustomSnackbar: vi.fn(),
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
                { provide: DraftContentsService, useValue: mockDraftContentsService },
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

        it('reads the list once on opening, from ngOnInit and not its first slug as well', () => {
            vi.clearAllMocks();
            component.ngOnChanges({
                contentTypeSlug: {
                    currentValue: 'articles',
                    previousValue: undefined,
                    firstChange: true,
                    isFirstChange: () => true
                }
            });
            expect(mockDraftContentsStore.getAll).not.toHaveBeenCalled();

            component.ngOnInit();
            expect(mockDraftContentsStore.getAll).toHaveBeenCalledTimes(1);
        });

        it('reads once when the content type changes', () => {
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

            expect(mockDraftContentsStore.getAll).toHaveBeenCalledTimes(1);
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

        const openedAt = (queryParams: Record<string, string>) => {
            mockActivatedRoute.snapshot.queryParams = queryParams;
            mockDraftContentsStore.getAll.mockClear();
            const opened = TestBed.createComponent(DraftContentsTableComponent).componentInstance;
            opened.ngOnInit();
            return opened;
        };

        it('opens on the sort and page size in the address, and reads with them', () => {
            const opened = openedAt({ sort: 'title', order: 'asc', size: '25' });

            expect(opened.sortField()).toBe('title');
            expect(opened.sortOrder()).toBe('asc');
            expect(opened.pageSizeSignal()).toBe(25);
            expect(mockDraftContentsStore.getAll).toHaveBeenCalledWith(
                expect.objectContaining({ orderByField: 'title', orderByDirection: 'asc', limitCount: 25, currentPageNumber: 0 }),
                undefined,
            );
        });

        it('opens on the first page whatever page an old address names', () => {
            const opened = openedAt({ page: '4' });

            expect(opened.currentPageNum()).toBe(0);
        });

        it.each([
            ['an order that is not one', { order: 'sideways' }],
            ['a sort field Firestore would refuse', { sort: 'title..name' }],
            ['a page size the list does not offer', { size: '7' }],
            ['a page size that is not a number', { size: 'many' }],
            ['a page size of none, which would read every record', { size: '0' }],
        ])('keeps the default for %s', (_name, queryParams) => {
            const opened = openedAt(queryParams as Record<string, string>);

            expect(opened.sortField()).toBe('modifiedAt');
            expect(opened.sortOrder()).toBe('desc');
            expect(opened.pageSizeSignal()).toBe(10);
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

        it('reads the list in the new order, from its first page', () => {
            component.currentPageNum.set(3);
            mockDraftContentsStore.getAll.mockClear();

            component.setSortField('title');

            expect(mockDraftContentsStore.getAll).toHaveBeenCalledTimes(1);
            expect(mockDraftContentsStore.getAll).toHaveBeenCalledWith(
                expect.objectContaining({ orderByField: 'title', orderByDirection: 'asc', currentPageNumber: 0 }),
                component.contentTypeSlug || undefined,
            );
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

        it('should keep the page size in the address, and no page, which a reload could not reach', () => {
            const event: PageEvent = { pageIndex: 1, pageSize: 10, length: 100 };
            component.onPageChange(event);

            expect(mockRouter.navigate).toHaveBeenCalledWith([], expect.objectContaining({
                queryParams: expect.objectContaining({
                    page: null,
                    size: 10
                })
            }));
        });

        it('reads the page it moved to', () => {
            mockDraftContentsStore.getAll.mockClear();

            component.onPageChange({ pageIndex: 2, pageSize: 10, length: 100 });

            expect(mockDraftContentsStore.getAll).toHaveBeenCalledTimes(1);
            expect(mockDraftContentsStore.getAll).toHaveBeenCalledWith(
                expect.objectContaining({ currentPageNumber: 2, limitCount: 10 }),
                component.contentTypeSlug || undefined,
            );
        });

        it('reads again at a new page size', () => {
            mockDraftContentsStore.getAll.mockClear();

            component.onPageChange({ pageIndex: 0, pageSize: 25, length: 100 });

            expect(mockDraftContentsStore.getAll).toHaveBeenCalledWith(expect.objectContaining({ limitCount: 25 }), component.contentTypeSlug || undefined);
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
        const NEEDS_INDEX = 'The query requires an index. You can create it here: https://console.firebase.google.com/v1/r/project/p/firestore/indexes?create_composite=abc';
        const lastRead = () => mockDraftContentsStore.getAll.mock.lastCall![0];
        const choose = (value: string) => component.onStatusFilterChange({ target: { value } });
        const alert = () => fixture.nativeElement.querySelector('.alert-warning');

        it('asks the server for the chosen status, and All reads everything', () => {
            choose('published');
            expect(lastRead().whereConditions).toEqual([{ field: 'publishedStatus', operator: '==', value: true }]);

            choose('draft');
            expect(lastRead().whereConditions).toEqual([{ field: 'publishedStatus', operator: '==', value: false }]);

            choose('');
            expect(lastRead().whereConditions).toEqual([]);
        });

        it('shows the rows the server sends and its total, with no filtering of its own', () => {
            mockDraftContentsStore.items.set([{ id: 'a', title: 'A', type: '', publishedStatus: true }]);
            mockDraftContentsStore.totalRecords.set(40);
            component.statusFilter.set('draft');

            expect(component.draftContentsData()).toHaveLength(1);
            expect(component.filteredTotalRecords()).toBe(40);
        });

        it('a filter sorts by the date, the one sort it has an index for', () => {
            component.sortField.set('title');
            choose('draft');
            expect(lastRead().orderByField).toBe('modifiedAt');
        });

        it('with no index it reads in record order and offers the button, and creates nothing by itself', () => {
            choose('draft');
            mockDraftContentsStore.error.set(NEEDS_INDEX);
            fixture.detectChanges();

            expect(component.orderPending()).toBe(true);
            expect(lastRead()).toMatchObject({ orderByField: '__name__', orderByDirection: 'asc' });
            expect(lastRead().whereConditions).toEqual([{ field: 'publishedStatus', operator: '==', value: false }]);
            expect(alert().querySelector('button')).not.toBeNull();
            expect(mockDraftContentsService.createListIndexes).not.toHaveBeenCalled();
        });

        it('another error is not mistaken for a missing index', () => {
            choose('draft');
            mockDraftContentsStore.error.set('Missing or insufficient permissions.');
            fixture.detectChanges();

            expect(component.orderPending()).toBe(false);
            expect(alert()).toBeNull();
        });

        it('the unfiltered list has no alert, whatever the error', () => {
            mockDraftContentsStore.error.set(NEEDS_INDEX);
            fixture.detectChanges();

            expect(component.orderPending()).toBe(false);
        });

        it('the button creates the indexes for this type and says it has', async () => {
            component.contentTypeSlug = 'article';
            choose('draft');
            mockDraftContentsStore.error.set(NEEDS_INDEX);
            fixture.detectChanges();

            await component.createIndexes();
            fixture.detectChanges();

            expect(mockDraftContentsService.createListIndexes).toHaveBeenCalledWith('article');
            expect(component.indexRequest()).toBe('requested');
            expect(alert().querySelector('button')).toBeNull();
        });

        it("when it cannot, it offers Firestore's own link to the Firebase console", async () => {
            mockDraftContentsService.createListIndexes.mockRejectedValue(new Error('not deployed'));
            choose('draft');
            mockDraftContentsStore.error.set(NEEDS_INDEX);
            fixture.detectChanges();

            await component.createIndexes();
            fixture.detectChanges();

            expect(component.indexRequest()).toBe('failed');
            expect(alert().querySelector('a').getAttribute('href')).toContain('https://console.firebase.google.com/');
        });

        it('choosing the filter again tries the sorted read, which finds a finished index', () => {
            choose('draft');
            mockDraftContentsStore.error.set(NEEDS_INDEX);
            fixture.detectChanges();

            choose('published');

            expect(component.orderPending()).toBe(false);
            expect(lastRead().orderByField).toBe('modifiedAt');
        });

        it('sorting waits while the list is in record order', () => {
            choose('draft');
            mockDraftContentsStore.error.set(NEEDS_INDEX);
            fixture.detectChanges();
            const order = component.sortOrder();

            component.setSortField('modifiedAt');

            expect(component.sortOrder()).toBe(order);
        });

        it('should reset page to 0 on clear filters', () => {
            component.currentPageNum.set(2);
            component.statusFilter.set('draft');

            component.clearFilters();

            expect(component.currentPageNum()).toBe(0);
        });

        it('should return true for hasActiveFilters when a status is chosen', () => {
            component.statusFilter.set('draft');

            expect(component.hasActiveFilters()).toBe(true);
        });

        it('should return false for hasActiveFilters when no status is chosen', () => {
            component.statusFilter.set('');

            expect(component.hasActiveFilters()).toBe(false);
        });

        it('should clear status filter when clearFilters is called', () => {
            component.statusFilter.set('published');

            component.clearFilters();

            expect(component.statusFilter()).toBe('');
        });

        it('should fetch data after clearing filters', () => {
            component.statusFilter.set('draft');
            vi.clearAllMocks();

            component.clearFilters();

            expect(mockDraftContentsStore.getAll).toHaveBeenCalled();
        });

        it('should return true for hasActiveFilters when statusFilter is set', () => {
            component.statusFilter.set('published');

            expect(component.hasActiveFilters()).toBe(true);
        });
    });

    // RF5 5.9: a title search on the entries list.
    describe('title search', () => {
        const wait = () => new Promise((resolve) => setTimeout(resolve, 300));

        it('matches anywhere in the title in any case, after one read of the type', async () => {
            component.contentTypeSlug = 'article';
            component.onSearchInput('PRIC');
            await wait();

            expect(mockDraftContentsService.listForSearch).toHaveBeenCalledWith('article');
            expect(component.draftContentsData().map((r: any) => r.id).sort()).toEqual(['a', 'c']);
            expect(component.filteredTotalRecords()).toBe(2);
            expect(component.hasActiveFilters()).toBe(true);

            component.onSearchInput('price list');
            await wait();
            expect(mockDraftContentsService.listForSearch).toHaveBeenCalledTimes(1);
            expect(component.draftContentsData().map((r: any) => r.id)).toEqual(['c']);
        });

        it('applies the status filter to the matches, and Clear filters empties the box', async () => {
            component.contentTypeSlug = 'article';
            component.onSearchInput('pric');
            await wait();
            component.onStatusFilterChange({ target: { value: 'published' } });
            expect(component.draftContentsData().map((r: any) => r.id)).toEqual(['a']);

            component.clearFilters();
            expect(component.searchTerm()).toBe('');
            expect(component.isSearching()).toBe(false);
        });

        // RF4 review L9.
        it('reads the entries again after a delete, so a deleted entry leaves the matches', async () => {
            component.contentTypeSlug = 'article';
            component.onSearchInput('pric');
            await wait();
            expect(mockDraftContentsService.listForSearch).toHaveBeenCalledTimes(1);
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });
            component.deleteItem({ id: 'c', title: 'The price list', publishedStatus: false });
            await wait();
            expect(mockDraftContentsService.listForSearch).toHaveBeenCalledTimes(2);
        });

        it('shows the table\'s error state with Retry when the read fails', async () => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            mockDraftContentsService.listForSearch.mockRejectedValueOnce(new Error('offline'));
            component.contentTypeSlug = 'article';
            component.onSearchInput('pric');
            await wait();
            expect(component.listError()).toBe(true);

            component.retryLoad();
            await wait();
            expect(component.listError()).toBeNull();
            expect(component.draftContentsData().length).toBe(2);
        });
    });

    // RF5 5.1: a list that did not load says so, with Retry, and shows no raw error.
    describe('load error', () => {
        it('marks the list failed when its read ends in an error, but not for a missing index', () => {
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            component.retryLoad();
            mockDraftContentsStore.isLoading.set(true);
            fixture.detectChanges();
            mockDraftContentsStore.error.set('permission-denied: Missing or insufficient permissions.');
            mockDraftContentsStore.isLoading.set(false);
            fixture.detectChanges();
            expect(component.listError()).toBe(true);
            expect(fixture.nativeElement.textContent).not.toContain('permission-denied');

            component.retryLoad();
            mockDraftContentsStore.isLoading.set(true);
            fixture.detectChanges();
            mockDraftContentsStore.error.set('');
            mockDraftContentsStore.isLoading.set(false);
            fixture.detectChanges();
            expect(component.listError()).toBeNull();
        });
    });

    describe('Delete Item', () => {
        it('should delete item when confirmed', async () => {
            dialogResult = true;
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });

            component.deleteItem(sampleContents[0]);
            await fixture.whenStable();
            await new Promise((resolve) => setTimeout(resolve));

            expect(mockDraftContentsStore.delete).toHaveBeenCalledWith('1', undefined);
        });

        it('should show success toast after deletion', async () => {
            dialogResult = true;
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });

            component.deleteItem(sampleContents[0]);
            await fixture.whenStable();
            await new Promise((resolve) => setTimeout(resolve));

            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith(
                'Deleted.', 'success', 'check_circle');
        });

        // RF4 4.11: the wording says the live page goes too; a published
        // entry's page is taken down first, and a failure deletes nothing.
        it('says a published entry\'s live page goes too, and a draft\'s only that it cannot be undone', () => {
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(false) });
            component.deleteItem(sampleContents[0]);
            component.deleteItem(sampleContents[1]);
            const messages = mockMatDialog.open.mock.calls.map((call: any[]) => String(call[1].data.dialogMessage?.changingThisBreaksApplicationSecurity ?? call[1].data.dialogMessage));
            expect(messages[0]).toContain('live page');
            expect(messages[1]).not.toContain('live page');
        });

        it('takes the live page down before deleting, and deletes nothing when that cannot start', async () => {
            const queue = TestBed.inject(PublishQueueService) as any;
            queue.enqueue.mockRejectedValueOnce(new Error('offline'));
            vi.spyOn(console, 'error').mockImplementation(() => undefined);
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });

            component.deleteItem(sampleContents[0]);
            await fixture.whenStable();
            await new Promise((resolve) => setTimeout(resolve));

            expect(queue.enqueue).toHaveBeenCalledWith('delete', expect.anything(), '1');
            expect(mockDraftContentsStore.delete).not.toHaveBeenCalled();
            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith(
                expect.stringContaining('Nothing was deleted'), 'error', expect.anything());
        });

        it('should not delete when cancelled', async () => {
            dialogResult = false;
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(false) });

            component.deleteItem(sampleContents[0]);
            await fixture.whenStable();

            expect(mockDraftContentsStore.delete).not.toHaveBeenCalled();
        });
    });

    // SS2: a type kept in its own order offers Arrange.
    describe('Arrange', () => {
        it('is offered only for a type in its own order', () => {
            component.contentTypeSlug = 'blog';
            mockContentTypesStore.items.set([{ name: 'Blog', slug: 'blog' }]);
            expect(component.isOwnOrder()).toBe(false);
            mockContentTypesStore.items.set([{ name: 'Blog', slug: 'blog', entryOrder: 'manual' }]);
            expect(component.isOwnOrder()).toBe(true);
        });

        it('opens the Arrange dialog for the type', () => {
            component.contentTypeSlug = 'blog';
            mockContentTypesStore.items.set([{ name: 'Blogs', slug: 'blog', entryOrder: 'manual' }]);
            const open = vi.spyOn(component['dialogService'], 'open').mockReturnValue({} as never);
            component.openArrange();
            expect(open).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: expect.objectContaining({ slug: 'blog' }) }));
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

            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith(
                'Open a content type to edit its entries.', 'error', 'error');
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

            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith(
                'Taken off the website.', 'success', 'check_circle');
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

            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith('Featured.', 'success', 'check_circle');
        });

        it('should show appropriate success message when removing', async () => {
            mockMatDialog.open.mockReturnValue({ afterClosed: () => of(true) });
            const item = { id: '2', isFeatured: true };

            component.makeItemFeatured(item);
            await fixture.whenStable();

            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith('No longer featured.', 'success', 'check_circle');
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
            expect(component.invalidSlugMessage()).toContain('There is no content type');
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
    describe('Dynamic list columns', () => {
        /** A content type whose custom fields shadow the built-ins, as real ones do. */
        function useArticleType(fields: any[]): void {
            mockContentTypesStore.items.set([
                { id: 'ct1', name: 'Article', slug: 'article', fields },
            ]);
            component.contentTypeSlug = 'article';
            component.visibleColumnKeys.set([]);
            component.updateDynamicColumns();
        }

        const TITLE_FIELD = { key: 'title', label: 'Title', type: 'text', required: false, order: 0 };
        const BODY_FIELD = { key: 'body', label: 'Body', type: 'richtext', required: false, order: 1 };
        const COVER_FIELD = { key: 'coverImage', label: 'Cover Image', type: 'image', required: false, order: 2 };
        const AUTHOR_FIELD = { key: 'author', label: 'Author', type: 'text', required: false, order: 3 };
        const ICON_FIELD = { key: 'card_icon', label: 'Card Icon', type: 'icon', required: false, order: 4 };
        const CARDS_FIELD = { key: 'info_cards', label: 'Info Cards', type: 'infocard', required: false, order: 5 };

        /** A stored icon token, as the picker writes it. */
        const ICON_TOKEN = {
            set: 'fa', name: 'trophy', style: 'solid',
            classes: 'fa-solid fa-trophy', label: 'Trophy',
            markup: '<svg viewBox="0 0 576 512"><path d="M400 0z"/></svg>',
        };

        it('should render the Title heading only once when a custom title field shadows the built-in', () => {
            useArticleType([TITLE_FIELD, AUTHOR_FIELD]);

            // Headings are translation keys now — the table resolves them, so a
            // custom field shadowing `title` shows up as a second column with the
            // same key rather than the same literal text.
            const titleColumns = component.tableColumns.filter((c) => c.key === 'title');
            expect(titleColumns).toHaveLength(1);
            expect(titleColumns[0].header).toBe('admin.contents.list.col_title');
            expect(component.tableColumns.map((c) => c.key)).toContain('author');
        });

        it('should not offer a shadowing field in the column picker either', () => {
            useArticleType([TITLE_FIELD, AUTHOR_FIELD]);

            expect(component.availableColumns().map((c) => c.key)).not.toContain('title');
            expect(component.availableColumns().map((c) => c.key)).toContain('author');
        });

        it('should drop rich-text fields, which are too long for a table cell', () => {
            useArticleType([BODY_FIELD, AUTHOR_FIELD]);

            expect(component.tableColumns.map((c) => c.key)).not.toContain('body');
            expect(component.availableColumns().map((c) => c.key)).not.toContain('body');
        });

        it('should drop rich text even when a saved preference still lists it', () => {
            mockContentTypesStore.items.set([
                { id: 'ct1', name: 'Article', slug: 'article', fields: [BODY_FIELD, AUTHOR_FIELD], listColumns: ['body', 'author'] },
            ]);
            component.contentTypeSlug = 'article';
            component.visibleColumnKeys.set([]);
            component.updateDynamicColumns();

            expect(component.tableColumns.map((c) => c.key)).not.toContain('body');
        });

        it('should render image fields as thumbnails rather than raw URLs', () => {
            useArticleType([COVER_FIELD]);

            const cover = component.tableColumns.find((c) => c.key === 'coverImage');
            expect(cover?.type).toBe('image');
            expect(cover?.imageConfig?.height).toBe(40);
        });

        it('should keep ordinary fields as text columns', () => {
            useArticleType([AUTHOR_FIELD]);

            const author = component.tableColumns.find((c) => c.key === 'author');
            expect(author?.type).toBe('text');
        });

        it('should still resolve values for the columns it keeps', () => {
            useArticleType([AUTHOR_FIELD]);

            const author = component.tableColumns.find((c) => c.key === 'author');
            expect(author?.transformFn?.({ customFields: { author: 'Ada' } })).toBe('Ada');
        });

        it('should render icon fields as the glyph rather than the stored token', () => {
            useArticleType([ICON_FIELD]);

            const icon = component.tableColumns.find((c) => c.key === 'card_icon');
            // A text column here stringifies the token to "[object Object]".
            expect(icon?.type).toBe('icon');
            expect(icon?.classFn?.({ customFields: { card_icon: ICON_TOKEN } }))
                .toBe('fa-solid fa-trophy');
        });

        it('should fall back to the label as an icon column text value', () => {
            useArticleType([ICON_FIELD]);

            const icon = component.tableColumns.find((c) => c.key === 'card_icon');
            expect(icon?.transformFn?.({ customFields: { card_icon: ICON_TOKEN } }))
                .toBe('Trophy');
        });

        it('should leave an icon cell empty when nothing is picked', () => {
            useArticleType([ICON_FIELD]);

            const icon = component.tableColumns.find((c) => c.key === 'card_icon');
            expect(icon?.classFn?.({ customFields: {} })).toBe('');
            expect(icon?.classFn?.({})).toBe('');
        });

        it('should drop repeating fields, whose rows cannot fit a table cell', () => {
            useArticleType([CARDS_FIELD, AUTHOR_FIELD]);

            // A row array stringifies to "[object Object]" in a text cell, and
            // there is no useful one-cell summary of four cards.
            expect(component.tableColumns.map((c) => c.key)).not.toContain('info_cards');
            expect(component.availableColumns().map((c) => c.key)).not.toContain('info_cards');
        });

        it('should drop a repeating field even when a saved preference lists it', () => {
            mockContentTypesStore.items.set([
                { id: 'ct1', name: 'Article', slug: 'article', fields: [CARDS_FIELD, AUTHOR_FIELD], listColumns: ['info_cards', 'author'] },
            ]);
            component.contentTypeSlug = 'article';
            component.visibleColumnKeys.set([]);
            component.updateDynamicColumns();

            expect(component.tableColumns.map((c) => c.key)).not.toContain('info_cards');
        });

        it('should still render an icon stored as a bare class string', () => {
            useArticleType([ICON_FIELD]);

            // Defensive: a hand-written or imported document may hold the class
            // list directly rather than the token the picker writes.
            const icon = component.tableColumns.find((c) => c.key === 'card_icon');
            expect(icon?.classFn?.({ customFields: { card_icon: 'fa-solid fa-star' } }))
                .toBe('fa-solid fa-star');
        });
    });

    describe('Status column (three states)', () => {
        function statusColumn(): any {
            component.contentTypeSlug = 'article';
            component.visibleColumnKeys.set([]);
            component.updateDynamicColumns();
            return component.tableColumns.find((c) => c.key === 'publishedStatus');
        }

        const PUBLISHED_AT = new Date('2026-07-20T10:00:00Z');
        const LATER = new Date('2026-07-21T10:00:00Z');

        it('should label an unpublished item Draft', () => {
            const col = statusColumn();
            const row = { publishedStatus: false };
            expect(col.badgeConfig.textFn(row)).toBe('Draft');
            expect(col.classFn(row)).toBe('inactive');
        });

        it('should label an in-sync item Published', () => {
            const col = statusColumn();
            const row = { publishedStatus: true, lastPublishedAt: PUBLISHED_AT, modifiedAt: PUBLISHED_AT };
            expect(col.badgeConfig.textFn(row)).toBe('Published');
            expect(col.classFn(row)).toBe('active');
        });

        it('should label a published item with newer draft changes Edited', () => {
            const col = statusColumn();
            const row = { publishedStatus: true, lastPublishedAt: PUBLISHED_AT, modifiedAt: LATER };
            expect(col.badgeConfig.textFn(row)).toBe('Edited');
            expect(col.classFn(row)).toBe('pending');
        });

        it('should explain each state on hover', () => {
            const col = statusColumn();
            expect(col.titleFn({ publishedStatus: true, lastPublishedAt: PUBLISHED_AT, modifiedAt: LATER }))
                .toContain('not live yet');
        });
    });
});
