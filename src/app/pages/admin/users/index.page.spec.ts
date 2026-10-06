/**
 * Users Page Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TranslocoPipe } from '@jsverse/transloco';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { BrowserAnimationsModule, NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { MatDialog } from '@angular/material/dialog';
import { NO_ERRORS_SCHEMA } from '@angular/core';

import UsersComponent from './index.page';
import { UserStore } from './user.store';
import { UserService } from './user.service';
import { ToastService } from '../../../../shared/services/toast.service';
import { ConstantVariables } from '../../../../shared/constants';
import { AuthService } from '../../(auth)/auth.service';
import { AuthState } from '../../(auth)/auth.store';

describe('UsersComponent', () => {
    let component: UsersComponent;
    let fixture: ComponentFixture<UsersComponent>;

    const mockUserStore = {
        items: signal([
            {
                id: 'user-1',
                name: 'Test User',
                email: 'test@example.com',
                status: 'Active',
                role: 'user',
                isActive: true,
                emailVerified: true,
                createdAt: { seconds: Date.now() / 1000 },
            },
        ]),
        isLoading: signal(false),
        error: signal(''),
        totalRecords: signal(1),
        getAll: vi.fn(),
        delete: vi.fn().mockReturnValue(of({})),
        update: vi.fn().mockReturnValue(of({})),
        currentItem: signal(null),
        getById: vi.fn(),
    };

    const mockUserService = {
        countByKind: vi.fn(),
        fillAccountSources: vi.fn(),
    };

    const mockToastService = {
        success: vi.fn(),
        error: vi.fn(),
        info: vi.fn(),
    };

    const mockDialog = {
        open: vi.fn().mockReturnValue({
            afterClosed: () => of(true),
        }),
    };

    const mockRouter = {
        navigate: vi.fn(),
    };

    const mockActivatedRoute = {
        params: of({}),
        snapshot: {
            queryParams: {},
        },
        queryParams: of({}),
    };

    const mockAuthService = {
        removeEmailLookup: vi.fn().mockResolvedValue(undefined),
        isFirstRun: vi.fn().mockReturnValue(of(false)),
    };

    const mockAuthStore = {
        isAuthenticated: vi.fn().mockReturnValue(false),
        isLoading: vi.fn().mockReturnValue(false),
        error: vi.fn().mockReturnValue(''),
        isSuccess: vi.fn().mockReturnValue(false),
        currentUser: vi.fn().mockReturnValue(null),
        initAuthStateListener: vi.fn().mockReturnValue(of(null)),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [NoopAnimationsModule],
            schemas: [NO_ERRORS_SCHEMA], // Ignore unknown elements/attributes
        })
            .overrideComponent(UsersComponent, {
                set: {
                    // Everything but the transloco pipe, which the template
                    // needs and which NO_ERRORS_SCHEMA cannot stand in for —
                    // an unknown *pipe* is an error, not an unknown element.
                    imports: [TranslocoPipe],
                    schemas: [NO_ERRORS_SCHEMA],
                }
            })
            .overrideProvider(UserStore, { useValue: mockUserStore })
            .overrideProvider(UserService, { useValue: mockUserService })
            .overrideProvider(AuthService, { useValue: mockAuthService })
            .overrideProvider(AuthState, { useValue: mockAuthStore })
            .overrideProvider(ToastService, { useValue: mockToastService })
            .overrideProvider(Router, { useValue: mockRouter })
            .overrideProvider(ActivatedRoute, { useValue: mockActivatedRoute })
            .overrideProvider(MatDialog, { useValue: mockDialog })
            .compileComponents();

        fixture = TestBed.createComponent(UsersComponent);
        component = fixture.componentInstance;
    });

    describe('App accounts in the list (docs/app/app-accounts.html)', () => {
        it('shows "App account" in the email column for an account an app made, and the email otherwise', () => {
            component.initColumns();
            const email = component.tableColumns.find((c) => c.key === 'email')!;
            const app = { by: 'app', email: '' };
            expect(email.transformFn!(app)).toBe('App account');
            expect(email.classFn!(app)).toContain('badge');
            expect(email.transformFn!({ by: 'phone', email: '' })).toBe('');
            expect(email.transformFn!({ by: 'admin', email: 'a@b.co' })).toBe('a@b.co');
            expect(email.classFn!({ by: 'admin', email: 'a@b.co' })).toBe('');
        });
    });

    describe('All, People, App accounts (docs/features/users-and-roles.html)', () => {
        const lastConditions = () => mockUserStore.getAll.mock.calls.at(-1)![0].whereConditions;

        beforeEach(() => {
            mockUserStore.getAll.mockClear();
            mockUserService.countByKind.mockReset().mockResolvedValue({ all: 5, people: 3, app: 2 });
            mockUserService.fillAccountSources.mockReset().mockResolvedValue({ filled: 0, total: 5 });
        });

        it('shows everyone by default, with no condition on how the account was made', () => {
            component.ngOnInit();
            expect(component.accountKind()).toBe('all');
            expect(lastConditions()).toEqual([]);
            expect(component.hasActiveFilters()).toBe(false);
        });

        it('lists only people, or only app accounts, from the first page', () => {
            component.currentPage.set(3);
            component.setAccountKind('people');
            expect(lastConditions()).toEqual([{ field: 'by', operator: '!=', value: 'app' }]);
            expect(component.currentPage()).toBe(0);
            expect(component.hasActiveFilters()).toBe(true);

            component.setAccountKind('app');
            expect(lastConditions()).toEqual([{ field: 'by', operator: '==', value: 'app' }]);

            component.setAccountKind('all');
            expect(lastConditions()).toEqual([]);
        });

        it('narrows the detached accounts the same way', () => {
            component.toggleDetached();
            component.setAccountKind('app');
            expect(lastConditions()).toEqual([
                { field: 'status', operator: '==', value: 'Detached' },
                { field: 'by', operator: '==', value: 'app' },
            ]);
        });

        it('offers the three choices, All first', () => {
            fixture.detectChanges();
            const labels = [...fixture.nativeElement.querySelectorAll('mat-button-toggle')].map((el: HTMLElement) => el.textContent!.trim());
            expect(labels).toEqual(['All', 'People', 'App accounts']);
        });

        it('gives older records a by, once, when People would miss some, and lists again', async () => {
            mockUserService.countByKind.mockResolvedValue({ all: 7, people: 3, app: 2 });
            mockUserService.fillAccountSources.mockResolvedValue({ filled: 2, total: 7 });
            component.setAccountKind('people');
            await vi.waitFor(() => expect(mockUserService.fillAccountSources).toHaveBeenCalledTimes(1));
            // Listed again once the records have their by.
            await vi.waitFor(() => expect(mockUserStore.getAll.mock.calls.length).toBeGreaterThanOrEqual(2));
            expect(lastConditions()).toEqual([{ field: 'by', operator: '!=', value: 'app' }]);

            component.setAccountKind('all');
            component.setAccountKind('people');
            await Promise.resolve();
            expect(mockUserService.countByKind).toHaveBeenCalledTimes(1);
        });

        it('leaves the records alone when the counts add up, and never checks for All or App accounts', async () => {
            component.setAccountKind('app');
            component.setAccountKind('all');
            expect(mockUserService.countByKind).not.toHaveBeenCalled();
            component.setAccountKind('people');
            await vi.waitFor(() => expect(mockUserService.countByKind).toHaveBeenCalledTimes(1));
            expect(mockUserService.fillAccountSources).not.toHaveBeenCalled();
        });
    });

    describe('Initialization', () => {
        it('should create the component', () => {
            expect(component).toBeTruthy();
        });

        it('should initialize with default pagination values', () => {
            expect(component.currentPage()).toBe(0);
            expect(component.pageSize()).toBe(10);
        });

        it('should initialize with default sort values', () => {
            expect(component.sortField()).toBe('createdAt');
            expect(component.sortOrder()).toBe('desc');
        });

        it('should initialize with empty filters', () => {
            expect(component.filters()).toEqual({});
        });
    });

    describe('Drawer Actions', () => {
        beforeEach(() => {
            // Mock the drawer
            component.drawer = {
                open: vi.fn(),
                close: vi.fn(),
            } as any;
        });

        it('should open add drawer', () => {
            component.openAdd();
            expect(component.currentAction()).toBe('add');
            expect(component.currentId()).toBe('');
        });

        it('should open edit drawer with user id', () => {
            component.openEdit('user-123');
            expect(component.currentAction()).toBe('edit');
            expect(component.currentId()).toBe('user-123');
        });

        it('should open view drawer with user id', () => {
            component.openView('user-456');
            expect(component.currentAction()).toBe('view');
            expect(component.currentId()).toBe('user-456');
        });

        it('should close drawer and reset state', () => {
            component.currentAction.set('edit');
            component.currentId.set('user-123');

            component.closeDrawer();

            expect(component.currentAction()).toBe('');
            expect(component.currentId()).toBe('');
        });
    });

    describe('Pagination', () => {
        it('should handle page change events', () => {
            const pageEvent = { pageIndex: 2, pageSize: 25, length: 100 };
            component.onPageChange(pageEvent as any);

            expect(component.currentPage()).toBe(2);
            expect(component.pageSize()).toBe(25);
            expect(mockRouter.navigate).toHaveBeenCalled();
        });

        it('should calculate correct start record', () => {
            component.currentPage.set(0);
            component.pageSize.set(10);
            expect(component.getStartRecord()).toBe(1);
        });

        it('should calculate correct end record', () => {
            component.currentPage.set(0);
            component.pageSize.set(10);
            expect(component.getEndRecord()).toBe(1); // Only 1 user in mock
        });
    });

    describe('Sorting', () => {
        it('should toggle sort order when clicking same column', () => {
            component.sortField.set('name');
            component.sortOrder.set('asc');

            component.onSort('name');

            expect(component.sortOrder()).toBe('desc');
        });

        it('should set new sort field and default to asc', () => {
            component.sortField.set('name');

            component.onSort('email');

            expect(component.sortField()).toBe('email');
            expect(component.sortOrder()).toBe('asc');
        });

        it('should return correct sort icon class', () => {
            component.sortField.set('name');
            component.sortOrder.set('asc');

            expect(component.getSortIconClass('name')).toBe('arrow_drop_up');
            expect(component.getSortIconClass('email')).toBe('');
        });
    });

    describe('Filtering', () => {
        it('should update filters on filter change', () => {
            const event = { target: { value: 'test' } } as any;
            component.onFilterChange('name', event);

            expect(component.filters()['name']).toBe('test');
        });

        it('should clear filters', () => {
            component.filters.set({ name: 'test', email: 'test@example.com' });

            component.clearFilters();

            expect(component.filters()).toEqual({});
        });

        it('should detect active filters', () => {
            expect(component.hasActiveFilters()).toBe(false);

            component.filters.set({ name: 'test' });
            expect(component.hasActiveFilters()).toBe(true);
        });
    });

    describe('Date Formatting', () => {
        it('should format date from Firebase timestamp', () => {
            const timestamp = { seconds: 1702500000 };
            const result = component.formatNewDate(timestamp);
            expect(result).toBeTruthy();
            expect(result).not.toBe('N/A');
        });

        it('should return N/A for null date', () => {
            expect(component.formatNewDate(null)).toBe('N/A');
        });

        it('should return N/A for undefined date', () => {
            expect(component.formatNewDate(undefined)).toBe('N/A');
        });
    });

    describe('User Actions', () => {
        it('should have delete method', () => {
            expect(typeof component.deleteItem).toBe('function');
        });

        it('should have onActiveDeactivate method', () => {
            expect(typeof component.onActiveDeactivate).toBe('function');
        });
    });

    describe('deleteItem', () => {
        const sampleUser = {
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com',
        } as any;

        beforeEach(() => {
            mockToastService.success.mockClear();
            mockToastService.error.mockClear();
            mockUserStore.delete.mockReset();
            mockDialog.open.mockReturnValue({ afterClosed: () => of(true) } as any);
        });

        it('shows success toast when delete succeeds', async () => {
            mockUserStore.delete.mockReturnValue(of(undefined));

            component.deleteItem(sampleUser);
            await Promise.resolve();

            expect(mockUserStore.delete).toHaveBeenCalledWith('user-1');
            expect(mockToastService.success).toHaveBeenCalledWith('User deleted successfully.');
            expect(mockToastService.error).not.toHaveBeenCalled();
        });

        it('shows error toast and NOT success when delete errors (e.g. permission denied)', async () => {
            mockUserStore.delete.mockReturnValue(
                throwError(() => new Error('Missing or insufficient permissions.'))
            );

            component.deleteItem(sampleUser);
            await Promise.resolve();

            expect(mockUserStore.delete).toHaveBeenCalledWith('user-1');
            expect(mockToastService.error).toHaveBeenCalledWith('Failed to delete user.');
            expect(mockToastService.success).not.toHaveBeenCalled();
        });
    });
});
