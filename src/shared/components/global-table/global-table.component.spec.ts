/**
 * Tests for GlobalTableComponent
 * 
 * Comprehensive tests for the reusable table component.
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { GlobalTableComponent, TableColumn, TableAction } from './global-table.component';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { CommonModule } from '@angular/common';
import { ArcZones } from '../../../app/core/time/arc-zones.service';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

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

        it('should render a badge from transformFn rather than the raw field', () => {
            // Regression: badge was the only column type that ignored transformFn and
            // read row[col.key] straight. An email log with status 'skipped' is a
            // truthy string, so a gated message that was never sent rendered as a
            // green "Success".
            component.loading = false;
            component.data = [{ status: 'skipped' }];
            component.columns = [{
                key: 'status',
                header: 'Status',
                type: 'badge',
                badgeConfig: { trueText: 'Success', falseText: 'Failed' },
                transformFn: (row: any) => row.status === 'sent',
            }];
            fixture.detectChanges();

            const badge = fixture.nativeElement.querySelector('.status-badge');
            expect(badge.textContent.trim()).toBe('Failed');
            expect(badge.classList.contains('active')).toBe(false);
        });

        it('should render a multi-state badge label from badgeConfig.textFn', () => {
            component.loading = false;
            component.data = [{ status: 'skipped' }];
            component.columns = [{
                key: 'status',
                header: 'Status',
                type: 'badge',
                badgeConfig: { textFn: (row: any) => row.status.toUpperCase() },
                classFn: () => 'is-neutral',
            }];
            fixture.detectChanges();

            const badge = fixture.nativeElement.querySelector('.status-badge');
            expect(badge.textContent.trim()).toBe('SKIPPED');
            expect(badge.classList.contains('is-neutral')).toBe(true);
            // textFn means more than two states, so the boolean active/inactive
            // classes must stay off and let classFn decide the tone alone.
            expect(badge.classList.contains('active')).toBe(false);
            expect(badge.classList.contains('inactive')).toBe(false);
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

describe('GlobalTableComponent date columns in a zone (specs/clock-and-zones-spec.md, T4)', () => {
    let component: GlobalTableComponent;
    let fixture: ComponentFixture<GlobalTableComponent>;
    // 20:00 UTC on 24 October 2026: 22:00 in Zurich, 01:30 the next day in Kolkata.
    const at = { seconds: Date.parse('2026-10-24T20:00:00Z') / 1000, nanoseconds: 0 };
    const cells = () => [...(fixture.nativeElement as HTMLElement).querySelectorAll('td')].map((td) => td.textContent?.replace(/\s+/g, ' ').trim());

    beforeEach(() => {
        TestBed.configureTestingModule({
            imports: [GlobalTableComponent],
            providers: [{ provide: ArcZones, useValue: { member: () => 'Asia/Kolkata', site: () => 'Europe/Zurich', device: () => 'UTC' } }],
        });
        fixture = TestBed.createComponent(GlobalTableComponent);
        component = fixture.componentInstance;
    });

    it("shows a date in the reader's zone, keeping the column's Angular pattern", () => {
        component.columns = [{ key: 'at', header: 'When', type: 'date', dateFormat: 'MMM d, y, HH:mm' }];
        component.data = [{ id: '1', at }];
        fixture.detectChanges();
        expect(cells()).toContain('Oct 25, 2026, 01:30');
    });

    it('shows it in the zone a column names, or in each row\'s own place', () => {
        component.columns = [
            { key: 'at', header: 'Site', type: 'date', dateFormat: 'HH:mm', dateZone: 'site' },
            { key: 'at', header: 'Shop', type: 'date', dateFormat: 'HH:mm', dateZone: (row: { zone: string }) => ({ zone: row.zone }) },
        ];
        component.data = [{ id: '1', at, zone: 'America/Phoenix' }];
        fixture.detectChanges();
        expect(cells()).toEqual(expect.arrayContaining(['22:00', '13:00']));
    });
});

describe('GlobalTableComponent: error, nothing matches, sorting and the actions column (RF5)', () => {
    let component: GlobalTableComponent;
    let fixture: ComponentFixture<GlobalTableComponent>;
    const el = () => fixture.nativeElement as HTMLElement;
    const text = (selector: string) => el().querySelector(selector)?.textContent?.replace(/\s+/g, ' ').trim();

    beforeEach(async () => {
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [GlobalTableComponent, translocoTestingModule()],
        }).compileComponents();
        fixture = TestBed.createComponent(GlobalTableComponent);
        component = fixture.componentInstance;
        component.columns = [{ key: 'name', header: 'Name', sortable: true }];
    });

    describe('error state', () => {
        it('shows the standard sentence instead of the empty state', () => {
            component.error = true;
            fixture.detectChanges();
            expect(el().querySelector('.error-state[role="alert"]')).toBeTruthy();
            expect(text('.error-state h3')).toBe('This list did not load');
            expect(text('.error-state p')).toBe('Check your connection and try again.');
            expect(el().querySelector('.empty-state')).toBeNull();
        });

        it("shows the page's own sentence, a key or plain text", () => {
            component.error = 'common.table.no_match_text';
            fixture.detectChanges();
            expect(text('.error-state p')).toBe('Try other words, or clear the filters.');
            fixture.componentRef.setInput('error', 'The server is busy.');
            fixture.detectChanges();
            expect(text('.error-state p')).toBe('The server is busy.');
        });

        it('has Retry only when the page listens, and Retry emits', () => {
            component.error = true;
            fixture.detectChanges();
            expect(el().querySelector('.retry-btn')).toBeNull();

            const retry = vi.fn();
            component.retry.subscribe(retry);
            fixture.componentRef.setInput('error', 'common.table.load_failed_text');
            fixture.detectChanges();
            const button = el().querySelector('.retry-btn') as HTMLButtonElement;
            expect(button.textContent?.trim()).toBe('Retry');
            button.click();
            expect(retry).toHaveBeenCalledTimes(1);
        });

        it('keeps rows already shown, with the error as a line above them', () => {
            component.data = [{ id: '1', name: 'Kept' }];
            component.error = true;
            fixture.detectChanges();
            expect(el().querySelector('.error-state.error-inline')).toBeTruthy();
            expect(el().querySelector('tbody tr')?.textContent).toContain('Kept');
        });

        it('waits while loading', () => {
            component.error = true;
            component.loading = true;
            fixture.detectChanges();
            expect(el().querySelector('.error-state')).toBeNull();
            expect(el().querySelector('.loading-state')).toBeTruthy();
        });
    });

    describe('nothing matches', () => {
        it('says "Nothing matches" when a filter is on, not "create your first"', () => {
            component.filtered = true;
            fixture.detectChanges();
            expect(text('.no-match-state h3')).toBe('Nothing matches');
            expect(text('.no-match-state p')).toBe('Try other words, or clear the filters.');
            expect(el().querySelectorAll('.empty-state').length).toBe(1);
            expect(text('.empty-state h3')).not.toBe(component.emptyTitle);
        });

        it('shows the empty state when no filter is on', () => {
            fixture.detectChanges();
            expect(el().querySelector('.no-match-state')).toBeNull();
            expect(text('.empty-state h3')).toBe('No Items Yet');
        });

        it('takes its own wording', () => {
            component.filtered = true;
            component.noMatchTitle = 'No orders match';
            component.noMatchDescription = 'common.table.load_failed_text';
            fixture.detectChanges();
            expect(text('.no-match-state h3')).toBe('No orders match');
            expect(text('.no-match-state p')).toBe('Check your connection and try again.');
        });

        it('has Clear filters only when the page listens, and it emits', () => {
            component.filtered = true;
            fixture.detectChanges();
            expect(el().querySelector('.clear-filters-btn')).toBeNull();
            const clear = vi.fn();
            component.clearFilters.subscribe(clear);
            fixture.componentRef.setInput('noMatchTitle', 'Nothing here');
            fixture.detectChanges();
            const button = el().querySelector('.clear-filters-btn') as HTMLButtonElement;
            expect(button.textContent?.trim()).toBe('Clear filters');
            button.click();
            expect(clear).toHaveBeenCalled();
        });

        it('an error wins over "nothing matches"', () => {
            component.filtered = true;
            component.error = true;
            fixture.detectChanges();
            expect(el().querySelector('.no-match-state')).toBeNull();
            expect(el().querySelector('.error-state')).toBeTruthy();
        });
    });

    describe('sortable headers', () => {
        beforeEach(() => {
            component.data = [{ id: '1', name: 'A', email: 'a@x' }];
            component.columns = [
                { key: 'name', header: 'Name', sortable: true },
                { key: 'email', header: 'Email', sortable: true },
                { key: 'note', header: 'Note' },
            ];
            component.sortField = 'name';
            component.sortOrder = 'asc';
        });

        it('are buttons, with aria-sort on the heading cell', () => {
            fixture.detectChanges();
            const ths = el().querySelectorAll('th');
            expect(ths[0].getAttribute('aria-sort')).toBe('ascending');
            expect(ths[1].getAttribute('aria-sort')).toBe('none');
            expect(ths[2].hasAttribute('aria-sort')).toBe(false);
            expect(ths[0].querySelector('button.sort-btn')?.textContent?.trim()).toBe('Name');
            expect(ths[2].querySelector('button')).toBeNull();
        });

        it('says descending, and the button sorts', () => {
            component.sortOrder = 'desc';
            fixture.detectChanges();
            expect(el().querySelector('th')?.getAttribute('aria-sort')).toBe('descending');
            const sort = vi.fn();
            component.sortChange.subscribe(sort);
            (el().querySelectorAll('th button.sort-btn')[1] as HTMLButtonElement).click();
            expect(sort).toHaveBeenCalledWith('email');
        });
    });

    describe('actions column on a phone', () => {
        it('the actions column at the end of the row is pinned', () => {
            component.data = [{ id: '1', name: 'A' }];
            component.columns = [
                { key: 'name', header: 'Name' },
                { key: 'actions', header: 'Actions', type: 'actions', actions: [{ action: 'edit', icon: 'fas fa-pen' }] },
            ];
            fixture.detectChanges();
            expect(el().querySelector('th:last-child')?.classList.contains('sticky-actions')).toBe(true);
            expect(el().querySelector('td:last-child')?.classList.contains('sticky-actions')).toBe(true);
            expect(el().querySelector('td:first-child')?.classList.contains('sticky-actions')).toBe(false);
        });

        it('an actions column that is not last is left alone', () => {
            const actions: TableColumn = { key: 'actions', header: 'Actions', type: 'actions', actions: [{ action: 'edit', icon: 'fas fa-pen' }] };
            expect(component.isStickyActions(actions, false)).toBe(false);
            expect(component.isStickyActions({ key: 'name', header: 'Name' }, true)).toBe(false);
        });

        it('an unlabelled icon action still has a name', () => {
            component.data = [{ id: '1', name: 'A' }];
            component.columns = [
                { key: 'actions', header: 'Actions', type: 'actions', actions: [{ action: 'edit', icon: 'fas fa-pen' }] },
            ];
            fixture.detectChanges();
            expect(el().querySelector('.action-btn')?.getAttribute('aria-label')).toBe('Edit');
        });
    });
});
