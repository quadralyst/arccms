/**
 * Users Page Component Tests
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { TranslocoPipe } from '@jsverse/transloco';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Component, signal } from '@angular/core';
import { BrowserAnimationsModule, NoopAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { of, Subject } from 'rxjs';
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
        isSuccess: signal(true),
        totalRecords: signal(1),
        getAll: vi.fn(),
        delete: vi.fn().mockReturnValue(of({})),
        update: vi.fn().mockReturnValue(of({})),
        currentItem: signal(null),
        getById: vi.fn(),
        currentPageNumber: signal(0),
    };

    const mockUserService = {
        countByKind: vi.fn(),
        fillAccountSources: vi.fn(),
        getAll: vi.fn(),
        deleteUser: vi.fn(),
        setBlocked: vi.fn(),
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
                    // needs and which NO_ERRORS_SCHEMA cannot stand in for:
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

    describe('load error, Retry and Clear filters (RF5)', () => {
        afterEach(() => {
            mockUserStore.error.set('');
            mockUserStore.isSuccess.set(true);
        });

        it('passes a failed load to the table as a plain sentence, never Firestore\'s text', () => {
            expect(component.loadError()).toBeNull();
            mockUserStore.error.set('Missing or insufficient permissions.');
            mockUserStore.isSuccess.set(false);
            expect(component.loadError()).toBe(true);
        });

        it('does not call the list failed when the drawer could not find one user', () => {
            mockUserStore.error.set('Item not found');
            mockUserStore.isSuccess.set(true);
            expect(component.loadError()).toBeNull();
        });

        it('wires error, retry, filtered and clearFilters on the table', () => {
            const html = readFileSync(join(__dirname, 'users.html'), 'utf8');
            expect(html).toMatch(/\[error\]="loadError\(\)"/);
            expect(html).toMatch(/\(retry\)="retryLoad\(\)"/);
            expect(html).toMatch(/\[filtered\]="hasActiveFilters\(\)"/);
            expect(html).toMatch(/\(clearFilters\)="clearAllFilters\(\)"/);
        });

        it('Retry reads the list again', () => {
            mockUserStore.getAll.mockClear();
            component.retryLoad();
            expect(mockUserStore.getAll).toHaveBeenCalledTimes(1);
        });

        it('Clear filters goes back to everyone: no search, no Detached, All', () => {
            mockUserService.getAll.mockReturnValue(new Subject());
            component.onSearch('pat');
            component.toggleDetached();
            component.setAccountKind('app');
            expect(component.hasActiveFilters()).toBe(true);
            component.clearAllFilters();
            expect(component.searching()).toBe(false);
            expect(component.showDetached()).toBe(false);
            expect(component.accountKind()).toBe('all');
            expect(component.hasActiveFilters()).toBe(false);
        });

        it('shows Active or Blocked in the admin\'s language, and the role by its name', () => {
            component.initColumns();
            const status = component.tableColumns.find((c) => c.key === 'isActive')!;
            expect(status.badgeConfig!.textFn!({ isActive: true })).toBe('Active');
            expect(status.badgeConfig!.textFn!({ isActive: false })).toBe('Blocked');
            const role = component.tableColumns.find((c) => c.key === 'role')!;
            expect(role.transformFn!({ role: 'admin' })).toBe('Admin');
        });

        it('opens the user when their name is pressed', () => {
            const view = vi.spyOn(component, 'openView').mockImplementation(() => undefined);
            component.onCellClick({ key: 'name', row: { id: 'user-1' } });
            expect(view).toHaveBeenCalledWith('user-1');
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

    describe('delete and block go through the server, which keeps an active admin (RF4)', () => {
        const sampleUser = {
            id: 'user-1',
            uid: 'uid-1',
            name: 'Test <b>User</b>',
            email: 'test@example.com',
            isActive: true,
        } as any;
        const flush = () => new Promise((resolve) => setTimeout(resolve));
        const lastDialog = () => mockDialog.open.mock.calls.at(-1)![1].data;

        beforeEach(() => {
            mockToastService.success.mockClear();
            mockToastService.error.mockClear();
            mockUserStore.delete.mockClear();
            mockUserStore.update.mockClear();
            mockUserService.deleteUser.mockReset().mockResolvedValue({ deleted: true });
            mockUserService.setBlocked.mockReset().mockResolvedValue({ blocked: true });
            mockDialog.open.mockReturnValue({ afterClosed: () => of(true) } as any);
            mockAuthStore.currentUser.mockReturnValue({ id: 'me-doc', uid: 'me-uid' });
        });

        it('says what a delete removes, with the name escaped, and deletes through adminDeleteUser', async () => {
            component.deleteItem(sampleUser);
            const data = lastDialog();
            expect(data.titleKey).toBe('admin.users.delete_title');
            expect(data.dialogMessage).toContain('<strong>Test &lt;b&gt;User&lt;/b&gt;</strong>');
            expect(data.dialogMessage).toContain('sign-in (unless another app shares it)');
            expect(data.dialogMessage).toContain("can't be undone");
            await flush();
            expect(mockUserService.deleteUser).toHaveBeenCalledWith('user-1');
            expect(mockUserStore.delete).not.toHaveBeenCalled();
            expect(mockToastService.success).toHaveBeenCalledWith('Test <b>User</b> is deleted.');
            expect(mockToastService.error).not.toHaveBeenCalled();
        });

        it('shows why the server refused, in plain words, never only the console', async () => {
            mockUserService.deleteUser.mockRejectedValue(Object.assign(new Error('x'), { details: { reason: 'last-admin' } }));
            component.deleteItem(sampleUser);
            await flush();
            expect(mockToastService.error).toHaveBeenCalledWith('This is the only active admin. Make someone else an admin first.');
            mockUserService.deleteUser.mockRejectedValue(new Error('Missing or insufficient permissions.'));
            component.deleteItem(sampleUser);
            await flush();
            expect(mockToastService.error).toHaveBeenLastCalledWith('Could not delete this user. Please try again.');
            expect(mockToastService.success).not.toHaveBeenCalled();
        });

        it('deletes nothing when the admin cancels', async () => {
            mockDialog.open.mockReturnValue({ afterClosed: () => of(undefined) } as any);
            component.deleteItem(sampleUser);
            await flush();
            expect(mockUserService.deleteUser).not.toHaveBeenCalled();
        });

        it('blocks and unblocks through adminSetUserBlocked, never a browser write', async () => {
            component.onActiveDeactivate(sampleUser);
            expect(lastDialog().titleKey).toBe('admin.users.block_title');
            await flush();
            expect(mockUserService.setBlocked).toHaveBeenCalledWith('user-1', true);
            expect(mockToastService.success).toHaveBeenCalledWith('Test <b>User</b> is blocked.');
            component.onActiveDeactivate({ ...sampleUser, isActive: false });
            await flush();
            expect(mockUserService.setBlocked).toHaveBeenLastCalledWith('user-1', false);
            expect(mockUserStore.update).not.toHaveBeenCalled();
        });

        it('hides Block and Delete on your own row only, and offers no Verify', () => {
            component.initColumns();
            const actions = component.tableColumns.find((c) => c.key === 'actions')!.actions!;
            const named = (name: string) => actions.find((a) => a.action === name)!;
            expect(named('toggleActive').hide!({ id: 'me-doc', uid: 'me-uid' })).toBe(true);
            expect(named('delete').hide!({ id: 'other', uid: 'me-uid' })).toBe(true);
            expect(named('delete').hide!({ id: 'other', uid: 'other-uid' })).toBe(false);
            expect(named('toggleActive').hide!({ id: 'other', uid: 'other-uid' })).toBe(false);
            expect(actions.some((a) => a.action === 'verify')).toBe(false);
            expect(named('toggleActive').labelFn!({ isActive: true })).toBe('admin.users.block');
            expect(named('toggleActive').labelFn!({ isActive: false })).toBe('admin.users.unblock');
            // Unblocking a detached record could not let it in; a locked app account is its app's to delete.
            expect(named('toggleActive').hide!({ id: 'other', uid: 'other-uid', status: 'Detached' })).toBe(true);
            expect(named('delete').hide!({ id: 'till', uid: 'till-uid', by: 'app' })).toBe(true);
            expect(named('delete').hide!({ id: 'open', uid: 'open-uid', by: 'app', selfService: true })).toBe(false);
        });
    });

    describe('search', () => {
        const people = Array.from({ length: 23 }, (_, i) => ({ id: `u${i}`, name: `Person ${i}`, email: `p${i}@example.com`, phone: i === 7 ? '+919876543210' : '' }));
        let live: Subject<any>;
        const ready = (total = people.length) => live.next({ collectionData: people, totalCount: total, firstVisible: null, lastVisible: null });

        beforeEach(() => {
            live = new Subject();
            mockUserService.getAll.mockReset();
            mockUserService.getAll.mockReturnValue(live);
            mockUserStore.getAll.mockClear();
        });

        it('reads the accounts once, however much is typed, and keeps to the page\'s filters and order', () => {
            component.setAccountKind('app');
            mockUserStore.getAll.mockClear();
            component.onSearch('p');
            component.onSearch('pe');
            component.onSearch('per');
            expect(mockUserService.getAll).toHaveBeenCalledTimes(1);
            expect(mockUserService.getAll).toHaveBeenCalledWith(expect.objectContaining({
                limitCount: 5000, orderByField: 'createdAt', orderByDirection: 'desc',
                whereConditions: [{ field: 'by', operator: '==', value: 'app' }],
            }));
            expect(mockUserStore.getAll).not.toHaveBeenCalled();
        });

        it('shows the matches a page at a time, turning pages without reading', () => {
            component.onSearch('person');
            ready();
            expect(component.total()).toBe(23);
            expect(component.rows().map((u) => u.id).slice(0, 2)).toEqual(['u0', 'u1']);
            component.onPageChange({ pageIndex: 2, pageSize: 10, length: 23 });
            expect(component.rows().map((u) => u.id)).toEqual(['u20', 'u21', 'u22']);
            expect(component.getStartRecord()).toBe(21);
            expect(component.getEndRecord()).toBe(23);
            expect(mockUserService.getAll).toHaveBeenCalledTimes(1);
            expect(mockUserStore.getAll).not.toHaveBeenCalled();
        });

        it('goes back to the first page of matches when the search changes', () => {
            component.onSearch('person');
            ready();
            component.onPageChange({ pageIndex: 1, pageSize: 10, length: 23 });
            component.onSearch('98765');
            expect(component.page()).toBe(0);
            expect(component.rows().map((u) => u.id)).toEqual(['u7']);
        });

        it('shuts the read when the box is cleared, and goes back to the list', () => {
            component.onSearch('person');
            ready();
            expect(live.observed).toBe(true);
            component.onSearch('');
            expect(live.observed).toBe(false);
            expect(component.searching()).toBe(false);
            expect(component.rows()).toEqual(mockUserStore.items());
            expect(mockUserStore.getAll).toHaveBeenCalledTimes(1);
        });

        it('shuts the read when the page closes', () => {
            component.onSearch('person');
            component.ngOnDestroy();
            expect(live.observed).toBe(false);
        });

        it('reads again only when the filters change, and says when there are more accounts than it looks through', () => {
            component.onSearch('person');
            ready(6000);
            expect(component.searchCapped()).toBe(true);
            component.toggleDetached();
            expect(mockUserService.getAll).toHaveBeenCalledTimes(2);
            expect(mockUserService.getAll.mock.calls[1][0].whereConditions).toContainEqual({ field: 'status', operator: '==', value: 'Detached' });
        });

        it('tells the admin when the read fails, and typing again tries again', () => {
            component.onSearch('person');
            live.error(new Error('denied'));
            expect(component.searchLoading()).toBe(false);
            // Said in the table, with Retry, not in a toast.
            expect(component.loadError()).toBe('admin.users.search_failed');
            live = new Subject();
            mockUserService.getAll.mockReturnValue(live);
            component.onSearch('persons');
            expect(mockUserService.getAll).toHaveBeenCalledTimes(2);
        });

        it('stays on a page that exists when a match goes while the search is open', () => {
            component.onSearch('person');
            ready();
            component.onPageChange({ pageIndex: 2, pageSize: 10, length: 23 });
            live.next({ collectionData: people.slice(0, 15), totalCount: 15, firstVisible: null, lastVisible: null });
            expect(component.page()).toBe(1);
            expect(component.rows()).toHaveLength(5);
        });
    });

    describe('pages (no reload can reach the middle of a list)', () => {
        it('opens on the first page whatever the address says, keeping its size and order', () => {
            mockActivatedRoute.snapshot.queryParams = { page: '3', pageSize: '25', sortField: 'name', sortOrder: 'asc' };
            mockUserStore.getAll.mockClear();
            component.ngOnInit();
            mockActivatedRoute.snapshot.queryParams = {};
            expect(mockUserStore.getAll).toHaveBeenCalledWith(expect.objectContaining({ currentPageNumber: 0, limitCount: 25, orderByField: 'name', orderByDirection: 'asc' }));
        });

        it('takes the page out of the address', () => {
            component.onPageChange({ pageIndex: 2, pageSize: 10, length: 30 });
            expect(mockRouter.navigate).toHaveBeenLastCalledWith([], expect.objectContaining({ queryParams: { page: null, pageSize: 10 } }));
        });

        it('a new order starts on the first page', () => {
            component.currentPage.set(3);
            component.onSort('name');
            expect(component.currentPage()).toBe(0);
        });
    });
});
