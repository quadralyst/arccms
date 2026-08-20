import { ComponentFixture, TestBed } from '@angular/core/testing';
import { headerTestProviders } from '../../../../../test/header-test-providers';
import ContentTypesPage from './index.page';
import { MatDialog } from '@angular/material/dialog';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { signal } from '@angular/core';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ContentTypesStore } from './content-types.store';

describe('ContentTypesPage', () => {
    let component: ContentTypesPage;
    let fixture: ComponentFixture<ContentTypesPage>;
    let mockRouter: any;
    let mockActivatedRoute: any;

    const mockStore = {
        items: signal([]),
        getAll: vi.fn(() => of([])),
        unsubscribeStore: () => { },
        isLoading: vi.fn().mockReturnValue(false),
        totalRecords: vi.fn().mockReturnValue(100),
    };

    beforeEach(async () => {
        mockRouter = {
            navigate: vi.fn().mockResolvedValue(true),
        };

        mockActivatedRoute = {
            paramMap: of({ keys: [], get: () => null }),
            queryParams: of({ sort: 'name', order: 'asc' })
        };

        await TestBed.configureTestingModule({
            imports: [ContentTypesPage, NoopAnimationsModule],
            providers: [
                ...headerTestProviders(),
                { provide: ContentTypesStore, useValue: mockStore },
                { provide: MatDialog, useValue: {} },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute }
            ]
        })
            .compileComponents();

        fixture = TestBed.createComponent(ContentTypesPage);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    describe('Sorting functionality', () => {
        it('should initialize with default sort parameters from URL', () => {
            expect(component.sortField()).toBe('name');
            expect(component.sortOrder()).toBe('asc');
        });

        it('should call store.getAll with sort parameters on init', () => {
            expect(mockStore.getAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    orderByField: 'name',
                    orderByDirection: 'asc'
                })
            );
        });

        it('should toggle sort order when clicking same field', () => {
            component.sortField.set('name');
            component.sortOrder.set('asc');

            component.setSortField('name');

            expect(component.sortOrder()).toBe('desc');
        });

        it('should set to asc when clicking a new field', () => {
            component.sortField.set('name');
            component.sortOrder.set('desc');

            component.setSortField('slug');

            expect(component.sortField()).toBe('slug');
            expect(component.sortOrder()).toBe('asc');
        });

        it('should update URL when sort field changes', () => {
            component.setSortField('slug');

            expect(mockRouter.navigate).toHaveBeenCalledWith(
                [],
                expect.objectContaining({
                    queryParams: expect.objectContaining({
                        sort: 'slug',
                        order: 'asc',
                        page: 0,
                        size: 10
                    }),
                    queryParamsHandling: 'merge'
                })
            );
        });

        it('should return correct sort icon for active field ascending', () => {
            component.sortField.set('name');
            component.sortOrder.set('asc');

            expect(component.getSortIcon('name')).toBe('arrow_upward');
        });

        it('should return correct sort icon for active field descending', () => {
            component.sortField.set('name');
            component.sortOrder.set('desc');

            expect(component.getSortIcon('name')).toBe('arrow_downward');
        });

        it('should return neutral icon for inactive field', () => {
            component.sortField.set('name');

            expect(component.getSortIcon('slug')).toBe('unfold_more');
        });

        it('should correctly identify sorted field', () => {
            component.sortField.set('name');

            expect(component.isSortedBy('name')).toBe(true);
            expect(component.isSortedBy('slug')).toBe(false);
        });
    });

    describe('Pagination functionality', () => {
        it('should initialize with default pagination from URL', () => {
            expect(component.currentPage()).toBe(0);
            expect(component.pageSize()).toBe(10);
        });

        it('should handle page change events', () => {
            const pageEvent = { pageIndex: 2, pageSize: 25, length: 100 };

            component.onPageChange(pageEvent as any);

            expect(component.currentPage()).toBe(2);
            expect(component.pageSize()).toBe(25);
            expect(mockRouter.navigate).toHaveBeenCalledWith(
                [],
                expect.objectContaining({
                    queryParams: expect.objectContaining({
                        page: 2,
                        size: 25
                    })
                })
            );
        });

        /**
         * The loaded array is the count now, not a server total: content types
         * are fetched unpaginated so the editor can resolve every one of them.
         */
        const loadTypes = (count: number) =>
            mockStore.items.set(Array.from({ length: count }, (_, i) => ({ id: `t${i}` })) as any);

        // The mock store is shared, and `items` is a signal — without this one
        // test's data silently answers the next one's assertions.
        beforeEach(() => loadTypes(0));

        it('should calculate correct start record', () => {
            loadTypes(50);
            component.currentPage.set(0);
            component.pageSize.set(10);

            expect(component.getStartRecord()).toBe(1);
        });

        it('should show only the current page of types', () => {
            loadTypes(50);
            component.currentPage.set(1);
            component.pageSize.set(10);

            // Paging is client-side over the fully loaded set.
            expect(component.pagedContentTypes()).toHaveLength(10);
            expect(component.pagedContentTypes()[0].id).toBe('t10');
            expect(component.totalContentTypes()).toBe(50);
        });

        it('should show every type when they fit on one page', () => {
            loadTypes(13);
            component.currentPage.set(0);
            component.pageSize.set(25);

            expect(component.pagedContentTypes()).toHaveLength(13);
        });

        it('should calculate correct end record for full page', () => {
            loadTypes(50);
            component.currentPage.set(0);
            component.pageSize.set(10);

            expect(component.getEndRecord()).toBe(10);
        });

        it('should calculate correct end record for last partial page', () => {
            loadTypes(23);
            component.currentPage.set(2); // Page 3
            component.pageSize.set(10);

            expect(component.getEndRecord()).toBe(23);
        });

        it('should return 0 for start record when no data', () => {
            loadTypes(0);

            expect(component.getStartRecord()).toBe(0);
        });
    });

    describe('Filter functionality', () => {
        it('should handle filter changes', () => {
            const event = { target: { value: 'test' } };

            component.onFilterChange('name', event);

            expect(component.filters()['name']).toBe('test');
            expect(component.currentPage()).toBe(0); // Reset to first page
        });

        it('should remove filter when value is empty', () => {
            component.filters.set({ name: 'test' });
            const event = { target: { value: '' } };

            component.onFilterChange('name', event);

            expect(component.filters()['name']).toBeUndefined();
        });

        it('should clear all filters', () => {
            component.filters.set({ name: 'test', slug: 'blog' });

            component.clearFilters();

            expect(component.filters()).toEqual({});
            expect(component.currentPage()).toBe(0);
        });

        it('should detect active filters', () => {
            component.filters.set({});
            expect(component.hasActiveFilters()).toBe(false);

            component.filters.set({ name: 'test' });
            expect(component.hasActiveFilters()).toBe(true);
        });

        it('should update URL when filters change', () => {
            const event = { target: { value: 'blog' } };

            component.onFilterChange('name', event);

            expect(mockRouter.navigate).toHaveBeenCalledWith(
                [],
                expect.objectContaining({
                    queryParams: expect.objectContaining({
                        filter_name: 'blog'
                    })
                })
            );
        });
    });

    describe('Data fetching', () => {
        it('should call store.getAll with correct params on page change', () => {
            mockStore.getAll.mockClear();
            const pageEvent = { pageIndex: 1, pageSize: 10, length: 50 };

            component.onPageChange(pageEvent as any);
            // Wait for URL to update and trigger queryParams subscription
            fixture.detectChanges();

            // The navigate call will trigger queryParams which calls fetchData
            expect(mockRouter.navigate).toHaveBeenCalled();
        });

        it('should convert filters to Firestore where conditions', () => {
            component.filters.set({ name: 'blog' });
            component.currentPage.set(0);
            component.pageSize.set(10);
            component.sortField.set('name');
            component.sortOrder.set('asc');

            // Call private method via type assertion
            (component as any).fetchData();

            expect(mockStore.getAll).toHaveBeenCalledWith(
                expect.objectContaining({
                    whereConditions: expect.arrayContaining([
                        expect.objectContaining({ field: 'name', operator: '>=', value: 'blog' }),
                        expect.objectContaining({ field: 'name', operator: '<=', value: 'blog\uf8ff' })
                    ])
                })
            );
        });
    });
});
