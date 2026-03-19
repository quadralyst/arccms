/**
 * Tests for GlobalTableComponent
 * 
 * Comprehensive tests for the reusable table component.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GlobalTableComponent, TableColumn, TableAction } from './global-table.component';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CommonModule } from '@angular/common';

describe('GlobalTableComponent', () => {
    let component: GlobalTableComponent;
    let fixture: ComponentFixture<GlobalTableComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [GlobalTableComponent, CommonModule]
        }).compileComponents();

        fixture = TestBed.createComponent(GlobalTableComponent);
        component = fixture.componentInstance;
        // Don't call detectChanges() here - let individual tests set up component state first
    });

    it('should create', () => {
        fixture.detectChanges();
        expect(component).toBeTruthy();
    });

    describe('default values', () => {
        beforeEach(() => {
            fixture.detectChanges();
        });

        it('should have empty data by default', () => {
            expect(component.data).toEqual([]);
        });

        it('should have empty columns by default', () => {
            expect(component.columns).toEqual([]);
        });

        it('should have loading as false by default', () => {
            expect(component.loading).toBe(false);
        });

        it('should have pageIndex as 0 by default', () => {
            expect(component.pageIndex).toBe(0);
        });

        it('should have pageSize as 10 by default', () => {
            expect(component.pageSize).toBe(10);
        });

        it('should have default empty state values', () => {
            expect(component.emptyTitle).toBe('No Items Yet');
            expect(component.emptyDescription).toBe('Create your first item to get started.');
            expect(component.emptyIcon).toBe('fas fa-list-alt');
            expect(component.showEmptyAction).toBe(true);
            expect(component.emptyActionLabel).toBe('Create Item');
        });
    });

    describe('resolveDate', () => {
        beforeEach(() => {
            fixture.detectChanges();
        });

        it('should return null for null input', () => {
            expect(component.resolveDate(null)).toBeNull();
        });

        it('should return null for undefined input', () => {
            expect(component.resolveDate(undefined)).toBeNull();
        });

        it('should return Date object as-is for Date input', () => {
            const date = new Date('2025-01-15');
            expect(component.resolveDate(date)).toEqual(date);
        });

        it('should handle Firestore Timestamp with toDate method', () => {
            const mockTimestamp = {
                toDate: () => new Date('2025-01-15T00:00:00Z')
            };
            const result = component.resolveDate(mockTimestamp);
            expect(result).toEqual(new Date('2025-01-15T00:00:00Z'));
        });

        it('should handle Firestore Timestamp with seconds property', () => {
            const timestamp = { seconds: 1705312800 }; // Jan 15, 2024
            const result = component.resolveDate(timestamp);
            expect(result).toBeInstanceOf(Date);
            expect(result.getTime()).toBe(1705312800 * 1000);
        });

        it('should return string dates as-is', () => {
            const dateString = '2025-01-15';
            expect(component.resolveDate(dateString)).toBe(dateString);
        });
    });

    describe('onActionClick', () => {
        beforeEach(() => {
            fixture.detectChanges();
        });

        it('should emit actionClick event with action name and row', () => {
            const spy = vi.spyOn(component.actionClick, 'emit');
            const action: TableAction = { action: 'edit', icon: 'fas fa-edit' };
            const row = { id: '1', name: 'Test' };

            component.onActionClick(action, row);

            expect(spy).toHaveBeenCalledWith({ action: 'edit', row });
        });

        it('should call onAction callback if provided', () => {
            const onActionSpy = vi.fn();
            const action: TableAction = {
                action: 'edit',
                icon: 'fas fa-edit',
                onAction: onActionSpy
            };
            const row = { id: '1', name: 'Test' };

            component.onActionClick(action, row);

            expect(onActionSpy).toHaveBeenCalledWith(row);
        });

        it('should not emit actionClick if onAction callback is provided', () => {
            const spy = vi.spyOn(component.actionClick, 'emit');
            const action: TableAction = {
                action: 'edit',
                icon: 'fas fa-edit',
                onAction: vi.fn()
            };

            component.onActionClick(action, { id: '1' });

            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('onCellClick', () => {
        beforeEach(() => {
            fixture.detectChanges();
        });

        it('should emit cellClick event when column is clickable', () => {
            const spy = vi.spyOn(component.cellClick, 'emit');
            const col: TableColumn = { key: 'name', header: 'Name', clickable: true };
            const row = { id: '1', name: 'Test' };

            component.onCellClick(col, row);

            expect(spy).toHaveBeenCalledWith({ key: 'name', row });
        });

        it('should not emit cellClick event when column is not clickable', () => {
            const spy = vi.spyOn(component.cellClick, 'emit');
            const col: TableColumn = { key: 'name', header: 'Name', clickable: false };
            const row = { id: '1', name: 'Test' };

            component.onCellClick(col, row);

            expect(spy).not.toHaveBeenCalled();
        });

        it('should not emit cellClick event when clickable is undefined', () => {
            const spy = vi.spyOn(component.cellClick, 'emit');
            const col: TableColumn = { key: 'name', header: 'Name' };
            const row = { id: '1', name: 'Test' };

            component.onCellClick(col, row);

            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('onHeaderClick', () => {
        beforeEach(() => {
            fixture.detectChanges();
        });

        it('should emit sortChange event when column is sortable', () => {
            const spy = vi.spyOn(component.sortChange, 'emit');
            const col: TableColumn = { key: 'name', header: 'Name', sortable: true };

            component.onHeaderClick(col);

            expect(spy).toHaveBeenCalledWith('name');
        });

        it('should not emit sortChange event when column is not sortable', () => {
            const spy = vi.spyOn(component.sortChange, 'emit');
            const col: TableColumn = { key: 'name', header: 'Name', sortable: false };

            component.onHeaderClick(col);

            expect(spy).not.toHaveBeenCalled();
        });
    });

    describe('onEmptyActionClick', () => {
        beforeEach(() => {
            fixture.detectChanges();
        });

        it('should emit emptyActionClick event', () => {
            const spy = vi.spyOn(component.emptyActionClick, 'emit');

            component.onEmptyActionClick();

            expect(spy).toHaveBeenCalled();
        });
    });

    describe('rendering', () => {
        it('should show loading state when loading is true', () => {
            component.loading = true;
            component.data = [];
            fixture.detectChanges();

            const loadingState = fixture.nativeElement.querySelector('.loading-state');
            expect(loadingState).toBeTruthy();
        });

        it('should show empty state when not loading and no data', () => {
            component.loading = false;
            component.data = [];
            fixture.detectChanges();

            const emptyState = fixture.nativeElement.querySelector('.empty-state');
            expect(emptyState).toBeTruthy();
        });

        it('should show table when not loading and has data', () => {
            component.loading = false;
            component.data = [{ id: '1', name: 'Test' }];
            component.columns = [{ key: 'name', header: 'Name' }];
            fixture.detectChanges();

            const table = fixture.nativeElement.querySelector('table');
            expect(table).toBeTruthy();
        });

        it('should display custom empty state title', () => {
            component.loading = false;
            component.data = [];
            component.emptyTitle = 'No Users Found';
            fixture.detectChanges();

            const title = fixture.nativeElement.querySelector('.empty-state h3');
            expect(title.textContent).toBe('No Users Found');
        });

        it('should hide empty action button when showEmptyAction is false', () => {
            component.loading = false;
            component.data = [];
            component.showEmptyAction = false;
            fixture.detectChanges();

            const button = fixture.nativeElement.querySelector('.empty-state button');
            expect(button).toBeNull();
        });
    });

    describe('column types', () => {
        it('should render index type with correct row number', () => {
            component.loading = false;
            component.pageIndex = 0;
            component.pageSize = 10;
            component.data = [{ id: '1' }, { id: '2' }];
            component.columns = [{ key: 'index', header: '#', type: 'index' }];
            fixture.detectChanges();

            const cells = fixture.nativeElement.querySelectorAll('td');
            expect(cells[0].textContent.trim()).toBe('1');
            expect(cells[1].textContent.trim()).toBe('2');
        });

        it('should render index type with pagination offset', () => {
            component.loading = false;
            component.data = [{ id: '1' }];
            component.columns = [{ key: 'index', header: '#', type: 'index' }];
            component.pageIndex = 2;
            component.pageSize = 10;
            fixture.detectChanges();

            const cell = fixture.nativeElement.querySelector('td');
            expect(cell.textContent.trim()).toBe('21'); // (2 * 10) + 0 + 1
        });

        it('should render code type in code block', () => {
            component.loading = false;
            component.data = [{ slug: 'test-slug' }];
            component.columns = [{ key: 'slug', header: 'Slug', type: 'code' }];
            fixture.detectChanges();

            const code = fixture.nativeElement.querySelector('td code');
            expect(code).toBeTruthy();
            expect(code.textContent).toBe('test-slug');
        });

        it('should render badge type with correct text', () => {
            component.loading = false;
            component.data = [{ isActive: true }];
            component.columns = [{
                key: 'isActive',
                header: 'Status',
                type: 'badge',
                badgeConfig: { trueText: 'Active', falseText: 'Inactive' }
            }];
            fixture.detectChanges();

            const badge = fixture.nativeElement.querySelector('.status-badge');
            expect(badge).toBeTruthy();
            expect(badge.textContent.trim()).toBe('Active');
        });

        it('should apply transformFn to text columns', () => {
            component.loading = false;
            component.data = [{ firstName: 'John', lastName: 'Doe' }];
            component.columns = [{
                key: 'fullName',
                header: 'Name',
                transformFn: (row: any) => `${row.firstName} ${row.lastName}`
            }];
            fixture.detectChanges();

            const cell = fixture.nativeElement.querySelector('td span');
            expect(cell.textContent.trim()).toBe('John Doe');
        });

        it('should apply classFn to text columns', () => {
            component.loading = false;
            component.data = [{ name: 'Test' }];
            component.columns = [{
                key: 'name',
                header: 'Name',
                classFn: () => 'custom-class'
            }];
            fixture.detectChanges();

            const span = fixture.nativeElement.querySelector('td span');
            expect(span.classList.contains('custom-class')).toBe(true);
        });
    });

    describe('actions rendering', () => {
        it('should render action buttons', () => {
            component.loading = false;
            component.data = [{ id: '1' }];
            component.columns = [{
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    { action: 'edit', icon: 'fas fa-edit' },
                    { action: 'delete', icon: 'fas fa-trash' }
                ]
            }];
            fixture.detectChanges();

            const buttons = fixture.nativeElement.querySelectorAll('.action-btn');
            expect(buttons.length).toBe(2);
        });

        it('should hide action button when hide function returns true', () => {
            component.loading = false;
            component.data = [{ id: '1', isProtected: true }];
            component.columns = [{
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    { action: 'delete', icon: 'fas fa-trash', hide: (row: any) => row.isProtected }
                ]
            }];
            fixture.detectChanges();

            const buttons = fixture.nativeElement.querySelectorAll('.action-btn');
            expect(buttons.length).toBe(0);
        });

        it('should show action button when hide function returns false', () => {
            component.loading = false;
            component.data = [{ id: '1', isProtected: false }];
            component.columns = [{
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    { action: 'delete', icon: 'fas fa-trash', hide: (row: any) => row.isProtected }
                ]
            }];
            fixture.detectChanges();

            const buttons = fixture.nativeElement.querySelectorAll('.action-btn');
            expect(buttons.length).toBe(1);
        });
    });

    describe('sorting UI', () => {
        it('should show sort icon for sortable columns', () => {
            component.loading = false;
            component.data = [{ name: 'Test' }];
            component.columns = [{ key: 'name', header: 'Name', sortable: true }];
            component.sortField = 'name';
            component.sortOrder = 'asc';
            fixture.detectChanges();

            const sortIcon = fixture.nativeElement.querySelector('th .fa-arrow-up');
            expect(sortIcon).toBeTruthy();
        });

        it('should show descending icon when sortOrder is desc', () => {
            component.loading = false;
            component.data = [{ name: 'Test' }];
            component.columns = [{ key: 'name', header: 'Name', sortable: true }];
            component.sortField = 'name';
            component.sortOrder = 'desc';
            fixture.detectChanges();

            const sortIcon = fixture.nativeElement.querySelector('th .fa-arrow-down');
            expect(sortIcon).toBeTruthy();
        });

        it('should show neutral sort icon for non-active sortable columns', () => {
            component.loading = false;
            component.data = [{ name: 'Test' }];
            component.columns = [{ key: 'name', header: 'Name', sortable: true }];
            component.sortField = 'other';
            fixture.detectChanges();

            const sortIcon = fixture.nativeElement.querySelector('th .fa-sort');
            expect(sortIcon).toBeTruthy();
        });
    });

    describe('onRowClick', () => {
        it('should call first action when row is clicked', () => {
            const onActionSpy = vi.fn();
            component.loading = false;
            component.data = [{ id: '1', name: 'Test' }];
            component.columns = [{
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    { action: 'view', icon: 'fas fa-eye', onAction: onActionSpy }
                ]
            }];

            const mockEvent = { stopPropagation: vi.fn() } as any;
            component.onRowClick(component.data[0], mockEvent);

            expect(onActionSpy).toHaveBeenCalledWith({ id: '1', name: 'Test' });
            expect(mockEvent.stopPropagation).toHaveBeenCalled();
        });

        it('should call action with isRowClick: true even if it is not first', () => {
            const viewSpy = vi.fn();
            const editSpy = vi.fn();
            component.loading = false;
            component.data = [{ id: '1', name: 'Test' }];
            component.columns = [{
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    { action: 'view', icon: 'fas fa-eye', onAction: viewSpy },
                    { action: 'edit', icon: 'fas fa-pen', isRowClick: true, onAction: editSpy }
                ]
            }];

            const mockEvent = { stopPropagation: vi.fn() } as any;
            component.onRowClick(component.data[0], mockEvent);

            expect(viewSpy).not.toHaveBeenCalled();
            expect(editSpy).toHaveBeenCalledWith({ id: '1', name: 'Test' });
        });

        it('should fallback to first visible action if isRowClick action is hidden', () => {
            const viewSpy = vi.fn();
            const editSpy = vi.fn();
            component.loading = false;
            component.data = [{ id: '1', name: 'Test', isProtected: true }];
            component.columns = [{
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    { action: 'view', icon: 'fas fa-eye', onAction: viewSpy },
                    { action: 'edit', icon: 'fas fa-pen', isRowClick: true, hide: (row: any) => row.isProtected, onAction: editSpy }
                ]
            }];

            const mockEvent = { stopPropagation: vi.fn() } as any;
            component.onRowClick(component.data[0], mockEvent);

            expect(editSpy).not.toHaveBeenCalled();
            expect(viewSpy).toHaveBeenCalledWith({ id: '1', name: 'Test', isProtected: true });
        });

        it('should skip hidden actions and call first visible one', () => {
            const hiddenSpy = vi.fn();
            const visibleSpy = vi.fn();
            component.loading = false;
            component.data = [{ id: '1', isProtected: true }];
            component.columns = [{
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    { action: 'delete', icon: 'fas fa-trash', hide: (row: any) => row.isProtected, onAction: hiddenSpy },
                    { action: 'view', icon: 'fas fa-eye', onAction: visibleSpy }
                ]
            }];

            const mockEvent = { stopPropagation: vi.fn() } as any;
            component.onRowClick(component.data[0], mockEvent);

            expect(hiddenSpy).not.toHaveBeenCalled();
            expect(visibleSpy).toHaveBeenCalled();
        });

        it('should not call any action if no actions column exists', () => {
            component.loading = false;
            component.data = [{ id: '1' }];
            component.columns = [{ key: 'name', header: 'Name' }];

            const mockEvent = { stopPropagation: vi.fn() } as any;
            component.onRowClick(component.data[0], mockEvent);

            expect(mockEvent.stopPropagation).not.toHaveBeenCalled();
        });

        it('should not call any action if all actions are hidden', () => {
            const actionSpy = vi.fn();
            component.loading = false;
            component.data = [{ id: '1' }];
            component.columns = [{
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    { action: 'delete', icon: 'fas fa-trash', hide: () => true, onAction: actionSpy }
                ]
            }];

            const mockEvent = { stopPropagation: vi.fn() } as any;
            component.onRowClick(component.data[0], mockEvent);

            expect(actionSpy).not.toHaveBeenCalled();
        });

        it('should trigger row click on tr element click', () => {
            const onActionSpy = vi.fn();
            component.loading = false;
            component.data = [{ id: '1' }];
            component.columns = [{
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [{ action: 'view', icon: 'fas fa-eye', onAction: onActionSpy }]
            }];
            fixture.detectChanges();

            const row = fixture.nativeElement.querySelector('tbody tr');
            row.click();

            expect(onActionSpy).toHaveBeenCalled();
        });
    });
});
