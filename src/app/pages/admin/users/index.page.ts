/**
 * Users Management Page
 * 
 * Admin page for managing users with list, add, edit, view, and delete functionality.
 * Uses MatDrawer pattern for add/edit/view side panels.
 */

import { RouteMeta } from '@analogjs/router';
import { CommonModule, DatePipe } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, computed, effect, inject, OnDestroy, signal, ViewChild, TemplateRef } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { ActivatedRoute, Router } from '@angular/router';
import { Subscription } from 'rxjs';

import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConstantVariables } from '../../../../shared/constants';
import { followLandedPage } from '../../../../shared/services/generic-store.service';
import { ToastService } from '../../../../shared/services/toast.service';

import AddUserComponent from './(add-user)/add.page';
import EditUserComponent from './(edit-user)/edit.[userId].page';
import ViewUserComponent from './(view-user)/view.[userId].page';
import { ACCOUNT_KINDS, AccountKind, accountKindConditions, IUser, isAppAccount, matchesUserSearch, MAX_SEARCHED_USERS, roleLabel, userActionError } from './user.model';
import { UserService } from './user.service';
import { injectT } from '../../../core/i18n/inject-t';
import { UserStore } from './user.store';
import { roleGuard } from '../../../guards/role.guard';
import { AuthState } from '../../(auth)/auth.store';
import { escapeHtml } from '../../../../shared/utils/escape-html';
import { isLockedAppAccount } from '../../../core/app-accounts/app-account-lock';
import { LoaderComponent } from '../../../../shared/components/loader/loader.component';

export const routeMeta: RouteMeta = {
    title: 'Users',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'arc-users',
    standalone: true,
    imports: [
        LoaderComponent, CommonModule,
        ReactiveFormsModule,
        MatSidenavModule,
        MatFormFieldModule,
        MatIconModule,
        MatInputModule,
        MatButtonModule,
        MatButtonToggleModule,
        MatPaginatorModule,
        MatDialogModule,
        AddUserComponent,
        EditUserComponent,
        ViewUserComponent,
        GlobalTableComponent,
        PageHeaderComponent,
        TranslocoPipe
    ],
    providers: [DatePipe, ConstantVariables],
    templateUrl: './users.html',
    styleUrl: './users.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class UsersComponent implements OnDestroy {
    @ViewChild('drawer') drawer!: MatDrawer;

    userStore = inject(UserStore);
    private userService = inject(UserService);
    private t = injectT();
    private authStore = inject(AuthState);
    dialog = inject(MatDialog);
    datePipe = inject(DatePipe);
    toastService = inject(ToastService);
    route = inject(ActivatedRoute);
    router = inject(Router);
    constantVariables = inject(ConstantVariables);

    // State signals
    currentId = signal('');
    currentAction = signal('');
    currentPage = signal(0);
    pageSize = signal(10);
    filters = signal<Record<string, string>>({});
    sortField = signal('createdAt');
    sortOrder = signal<'asc' | 'desc'>('desc');
    /** Only accounts whose last email or number moved to another account (kept, cannot sign in). */
    showDetached = signal(false);
    /** Everyone (the default), only people, or only app accounts (`by: 'app'`). */
    accountKind = signal<AccountKind>('all');
    readonly accountKinds = ACCOUNT_KINDS;
    /** Whether older records were checked for a missing `by` in this visit (checkOlderAccounts). */
    private olderAccountsChecked = false;

    /** What was typed in the search box, and the page of its matches. */
    searchTerm = signal('');
    searchPage = signal(0);
    readonly searching = computed(() => !!this.searchTerm().trim());
    /**
     * The accounts the search looks through, read when the first character is typed and
     * kept current while the search stays open: typing more reads nothing. Firestore
     * cannot search inside a field and these records keep no search keys.
     */
    private readonly searchable = signal<IUser[]>([]);
    readonly searchLoading = signal(false);
    /** More accounts exist than a search looks through. */
    readonly searchCapped = signal(false);
    readonly maxSearched = MAX_SEARCHED_USERS;
    private searchRead?: Subscription;
    private searchReadKey = '';
    private readonly matches = computed(() => this.searchable().filter((user) => matchesUserSearch(user, this.searchTerm())));

    // Role from route params
    role: string | null | undefined;

    // Computed values
    allUserList = computed(() => this.userStore.items() || []);

    /** The page of matches to show: never past the last one, should a match go while it is open. */
    private readonly lastMatchPage = computed(() => Math.min(this.searchPage(), Math.max(0, Math.ceil(this.matches().length / this.pageSize()) - 1)));

    /** What the table and the paginator show: the list as Firestore pages it, or the matches of a search. */
    readonly rows = computed(() => {
        if (!this.searching()) return this.userStore.items();
        const start = this.lastMatchPage() * this.pageSize();
        return this.matches().slice(start, start + this.pageSize());
    });
    readonly total = computed(() => (this.searching() ? this.matches().length : this.userStore.totalRecords()));
    readonly page = computed(() => (this.searching() ? this.lastMatchPage() : this.currentPage()));
    readonly loading = computed(() => (this.searching() ? this.searchLoading() : this.userStore.isLoading()));
    /** The search's own read failed; typing again or Retry reads again. */
    readonly searchFailed = signal(false);
    /**
     * The list did not load: the table says so in a plain sentence with Retry. The
     * store keeps Firestore's own message, which stays in the console.
     */
    readonly loadError = computed<string | boolean | null>(() => {
        if (this.searching()) return this.searchFailed() ? 'admin.users.search_failed' : null;
        // A record not found by the drawer leaves an error with isSuccess true: the list itself is fine.
        return this.userStore.error() && !this.userStore.isSuccess() ? true : null;
    });
    readonly roleName = (role: string) => roleLabel(role, (key) => this.t(key));

    // Table Config
    tableColumns: TableColumn[] = [];
    @ViewChild('indexTemplate', { static: true }) indexTemplate!: TemplateRef<any>;
    @ViewChild('nameTemplate', { static: true }) nameTemplate!: TemplateRef<any>;
    @ViewChild('emailTemplate', { static: true }) emailTemplate!: TemplateRef<any>;
    @ViewChild('dateTemplate', { static: true }) dateTemplate!: TemplateRef<any>;

    constructor() {
        // The page the list landed on, which a reload or a removed record can change.
        followLandedPage(this.userStore.currentPageNumber, this.currentPage);

        // Load data on init - use effect to watch store state
        effect(() => {
            this.allUserList();
        });

        // Retry fetch when auth becomes available after an error.
        // On page refresh, stores may query Firestore before Firebase Auth
        // has restored the session, causing permission errors. This effect
        // re-fetches once auth is ready.
        effect(() => {
            const authenticated = this.authStore.isAuthenticated();
            const hasError = this.userStore.error();
            if (authenticated && hasError) {
                this.fetchData();
            }
        });
    }

    ngOnInit(): void {
        this.route.params.subscribe((params) => {
            this.role = params['role'];
        });

        // A list opens on its first page: a page in the middle cannot be reached without the
        // ones before it (page-cursors.ts), so the address keeps only the size and the order.
        const params = this.route.snapshot.queryParams;
        if (params['pageSize']) this.pageSize.set(+params['pageSize']);
        if (params['sortField']) this.sortField.set(params['sortField']);
        if (params['sortOrder']) this.sortOrder.set(params['sortOrder']);

        this.initColumns();
        this.fetchData();
    }

    /**
     * Fetch data with current filter, sort, and pagination settings
     */
    fetchData(): void {
        this.userStore.getAll({
            limitCount: this.pageSize(),
            currentPageNumber: this.currentPage(),
            previousPageNumber: this.currentPage() - 1,
            orderByField: this.sortField(),
            orderByDirection: this.sortOrder(),
            whereConditions: this.listConditions(),
        });
        if (this.searching()) this.openSearchRead();
    }

    /** The current filters, as query conditions. */
    private listConditions(): any[] {
        const whereConditions: any[] = [];

        // Add filter conditions
        Object.entries(this.filters()).forEach(([field, value]) => {
            if (value && value.trim()) {
                whereConditions.push({
                    field,
                    operator: '>=',
                    value: value.trim(),
                });
                whereConditions.push({
                    field,
                    operator: '<=',
                    value: value.trim() + '\uf8ff',
                });
            }
        });

        if (this.showDetached()) {
            whereConditions.push({ field: 'status', operator: '==', value: 'Detached' });
        }

        whereConditions.push(...accountKindConditions(this.accountKind()));

        // Add role filter if set
        if (this.role) {
            whereConditions.push({
                field: 'role',
                operator: '==',
                value: this.role,
            });
        }

        return whereConditions;
    }

    // Search
    onSearch(typed: string): void {
        const wasSearching = this.searching();
        this.searchTerm.set(typed);
        this.searchPage.set(0);
        if (this.searching()) this.openSearchRead();
        else if (wasSearching) {
            this.closeSearchRead();
            // A page size chosen while searching applies to the list too.
            this.fetchData();
        }
    }

    /** Reads the accounts to look through, once for each set of filters and order. */
    private openSearchRead(): void {
        const whereConditions = this.listConditions();
        const key = JSON.stringify([whereConditions, this.sortField(), this.sortOrder()]);
        if (this.searchRead && key === this.searchReadKey) return;
        this.closeSearchRead();
        this.searchReadKey = key;
        this.searchLoading.set(true);
        this.searchFailed.set(false);
        this.searchRead = this.userService.getAll({
            limitCount: MAX_SEARCHED_USERS,
            currentPageNumber: 0,
            previousPageNumber: -1,
            orderByField: this.sortField(),
            orderByDirection: this.sortOrder(),
            whereConditions,
        }).subscribe({
            next: (result) => {
                this.searchable.set(result.collectionData);
                this.searchCapped.set(result.totalCount > result.collectionData.length);
                this.searchLoading.set(false);
            },
            error: (error) => {
                console.error('Could not read the accounts to search:', error);
                this.searchLoading.set(false);
                // Typing again tries again.
                this.searchRead = undefined;
                this.searchReadKey = '';
                this.searchFailed.set(true);
            },
        });
    }

    private closeSearchRead(): void {
        this.searchRead?.unsubscribe();
        this.searchRead = undefined;
        this.searchReadKey = '';
        this.searchable.set([]);
        this.searchCapped.set(false);
    }

    ngOnDestroy(): void {
        this.closeSearchRead();
    }

    // Drawer actions
    openAdd(): void {
        this.currentAction.set('add');
        this.currentId.set('');
        this.drawer?.open();
    }

    openEdit(id: string): void {
        this.currentAction.set('edit');
        this.currentId.set(id);
        this.drawer?.open();
    }

    openView(id: string): void {
        this.currentAction.set('view');
        this.currentId.set(id);
        this.drawer?.open();
    }

    closeDrawer(): void {
        this.drawer?.close();
        this.currentAction.set('');
        this.currentId.set('');
        this.fetchData();
    }

    // Pagination
    onPageChange(event: PageEvent): void {
        if (this.searching()) {
            // Matches are already here: nothing to read.
            this.searchPage.set(event.pageIndex);
            this.pageSize.set(event.pageSize);
            return;
        }
        this.currentPage.set(event.pageIndex);
        this.pageSize.set(event.pageSize);

        // Update URL with pagination params
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {
                page: null,
                pageSize: event.pageSize,
            },
            queryParamsHandling: 'merge',
        });

        this.fetchData();
    }

    // Sorting
    onSort(column: string): void {
        if (this.sortField() === column) {
            this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
        } else {
            this.sortField.set(column);
            this.sortOrder.set('asc');
        }
        this.currentPage.set(0);
        this.fetchData();
    }

    getSortIconClass(column: string): string {
        if (this.sortField() !== column) return '';
        return this.sortOrder() === 'asc' ? 'arrow_drop_up' : 'arrow_drop_down';
    }

    // Filtering
    onFilterChange(field: string, event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.filters.update((f) => ({ ...f, [field]: value }));
        this.currentPage.set(0);
        this.fetchData();
    }

    toggleDetached(): void {
        this.showDetached.update((on) => !on);
        this.currentPage.set(0);
        this.fetchData();
    }

    setAccountKind(kind: AccountKind): void {
        if (!this.accountKinds.includes(kind) || kind === this.accountKind()) return;
        this.accountKind.set(kind);
        this.currentPage.set(0);
        this.fetchData();
        if (kind === 'people') void this.checkOlderAccounts();
    }

    /**
     * Records made before Arc CMS recorded how an account was made have no `by`, and
     * Firestore leaves them out of the People query. When the counts show some, give
     * them one on the server (fillAccountSources), once per visit, and list again.
     */
    async checkOlderAccounts(): Promise<void> {
        if (this.olderAccountsChecked) return;
        this.olderAccountsChecked = true;
        try {
            const counts = await this.userService.countByKind();
            if (counts.all <= counts.people + counts.app) return;
            const { filled } = await this.userService.fillAccountSources();
            if (filled && this.accountKind() === 'people') this.fetchData();
        } catch (error) {
            console.warn('Could not check older accounts for the People filter:', error);
        }
    }

    clearFilters(): void {
        this.filters.set({});
        this.currentPage.set(0);
        this.fetchData();
    }

    /** Clear filters in the table's "Nothing matches": the search, Detached and the kind, all back to everyone. */
    clearAllFilters(): void {
        if (this.searching()) {
            this.searchTerm.set('');
            this.searchPage.set(0);
            this.closeSearchRead();
        }
        this.showDetached.set(false);
        this.accountKind.set('all');
        this.clearFilters();
    }

    /** Retry in the table's error state: the search reads again, or the list does. */
    retryLoad(): void {
        if (this.searching()) {
            this.closeSearchRead();
            this.openSearchRead();
        } else {
            this.fetchData();
        }
    }

    hasActiveFilters(): boolean {
        return this.searching() || this.showDetached() || this.accountKind() !== 'all' || Object.values(this.filters()).some((v) => v && v.trim());
    }

    // Record count helpers
    getStartRecord(): number {
        if (this.total() === 0) return 0;
        return this.page() * this.pageSize() + 1;
    }

    getEndRecord(): number {
        const end = (this.page() + 1) * this.pageSize();
        return Math.min(end, this.total());
    }

    /** The admin's own row: they cannot block or delete themselves here (another admin can). */
    isMe(row: Pick<IUser, 'id' | 'uid'>): boolean {
        const me = this.authStore.currentUser() as { id?: string; uid?: string } | null;
        if (!me) return false;
        return (!!me.uid && row.uid === me.uid) || (!!me.id && row.id === me.id);
    }

    // User actions: through the server, which keeps the site an active admin (adminUserAccess.ts).
    deleteItem(item: IUser): void {
        const name = `<strong>${escapeHtml(item.name || item.email || item.phone || '')}</strong>`;
        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            width: '400px',
            data: {
                dialogType: 'Delete',
                titleKey: 'admin.users.delete_title',
                dialogMessage: this.t('admin.users.delete_message', { name }),
                btnText: this.t('common.actions.delete'),
                panelType: 'warn',
            },
        });

        dialogRef.afterClosed().subscribe(async (result: boolean) => {
            if (!result) return;
            try {
                await this.userService.deleteUser(item.id);
                this.toastService.success(this.t('admin.users.deleted', { name: item.name || item.email || item.phone || '' }));
                this.fetchData();
            } catch (error) {
                console.error('Error deleting user:', error);
                this.toastService.error(userActionError(error, this.t, 'admin.users.delete_failed'));
            }
        });
    }

    onActiveDeactivate(item: IUser): void {
        const blocking = item.isActive !== false;
        const name = `<strong>${escapeHtml(item.name || item.email || item.phone || '')}</strong>`;
        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            width: '400px',
            data: {
                dialogType: 'Confirm',
                titleKey: blocking ? 'admin.users.block_title' : 'admin.users.unblock_title',
                dialogMessage: this.t(blocking ? 'admin.users.block_message' : 'admin.users.unblock_message', { name }),
                btnText: this.t(blocking ? 'admin.users.block' : 'admin.users.unblock'),
                panelType: blocking ? 'warn' : '',
            },
        });

        dialogRef.afterClosed().subscribe(async (result: boolean) => {
            if (!result) return;
            const shown = item.name || item.email || item.phone || '';
            try {
                await this.userService.setBlocked(item.id, blocking);
                this.toastService.success(this.t(blocking ? 'admin.users.blocked' : 'admin.users.unblocked', { name: shown }));
                this.fetchData();
            } catch (error) {
                console.error(`Error ${blocking ? 'blocking' : 'unblocking'} user:`, error);
                this.toastService.error(userActionError(error, this.t, blocking ? 'admin.users.block_failed' : 'admin.users.unblock_failed'));
            }
        });
    }

    initColumns() {
        this.tableColumns = [
            {
                key: 'index',
                header: 'common.table.index',
                type: 'index'
            },
            {
                key: 'name',
                header: 'common.table.name',
                clickable: true,
                classFn: () => 'fw-bold cursor-pointer text-primary'
            },
            {
                key: 'email',
                header: 'common.table.email',
                type: 'text',
                // An app account has no email: say what it is instead (docs/app/app-accounts.html).
                transformFn: (row: IUser) => (isAppAccount(row) && !row.email ? this.t('admin.users.app_account') : row.email),
                classFn: (row: IUser) => (isAppAccount(row) && !row.email ? 'badge bg-light text-secondary border' : ''),
            },
            {
                key: 'phone',
                header: 'common.table.phone',
                type: 'text'
            },
            {
                key: 'role',
                header: 'common.table.role',
                type: 'text',
                transformFn: (row: IUser) => (row.role ? this.roleName(row.role) : ''),
            },
            {
                key: 'isActive',
                header: 'common.table.status',
                type: 'badge',
                badgeConfig: {
                    trueClass: 'active',
                    falseClass: 'inactive',
                    // Read at each render, so a change of language shows at once.
                    textFn: (row: IUser) => this.t(row.isActive !== false ? 'admin.users.status_active' : 'admin.users.status_blocked'),
                },
                classFn: (row: IUser) => (row.isActive !== false ? 'active' : 'inactive'),
            },
            {
                key: 'createdAt', // Using creationTime directly
                header: 'common.table.joined',
                type: 'date',
                dateFormat: 'EEE, MMM d, y'
            },
            {
                key: 'actions',
                header: 'common.table.actions',
                type: 'actions',
                actions: [
                    {
                        action: 'view',
                        icon: 'fas fa-eye text-secondary',
                        label: 'common.actions.view',
                        class: 'view',
                        onAction: (row) => this.openView(row.id)
                    },
                    {
                        action: 'edit',
                        icon: 'fas fa-pen text-primary',
                        label: 'common.actions.edit',
                        class: 'edit',
                        onAction: (row) => this.openEdit(row.id)
                    },
                    {
                        action: 'toggleActive',
                        icon: 'fas fa-ban', // Default icon
                        iconFn: (row) => row.isActive !== false ? 'fas fa-ban' : 'fas fa-check',
                        labelFn: (row) => row.isActive !== false ? 'admin.users.block' : 'admin.users.unblock',
                        class: 'edit', // or custom class
                        // Never on your own row: another admin blocks you (the server refuses it too).
                        // Not on a detached record: unblocking it could not let it sign in.
                        hide: (row) => this.isMe(row) || row.status === 'Detached',
                        onAction: (row) => this.onActiveDeactivate(row)
                    },
                    {
                        action: 'delete',
                        icon: 'fas fa-trash text-danger',
                        label: 'common.actions.delete',
                        class: 'delete',
                        // A locked app account is its app's to delete (the server refuses it too).
                        hide: (row) => this.isMe(row) || isLockedAppAccount(row),
                        onAction: (row) => this.deleteItem(row)
                    }
                ]
            }
        ];
    }

    onCellClick(event: { key: string, row: any }) {
        if (event.key === 'name') {
            this.openView(event.row.id);
        }
    }

    // Set sort field from table event
    setSortField(field: string): void {
        this.onSort(field);
    }
}
