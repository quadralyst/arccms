/**
 * Users Management Page
 * 
 * Admin page for managing users with list, add, edit, view, and delete functionality.
 * Uses MatDrawer pattern for add/edit/view side panels.
 */

import { RouteMeta } from '@analogjs/router';
import { CommonModule, DatePipe } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal, ViewChild, TemplateRef } from '@angular/core';
import { ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';

import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConstantVariables } from '../../../../shared/constants';
import { ToastService } from '../../../../shared/services/toast.service';

import AddUserComponent from './(add-user)/add.page';
import EditUserComponent from './(edit-user)/edit.[userId].page';
import ViewUserComponent from './(view-user)/view.[userId].page';
import { IUser } from './user.model';
import { UserStore } from './user.store';
import { roleGuard } from '../../../guards/role.guard';
import { AuthService } from '../../(auth)/auth.service';
import { AuthState } from '../../(auth)/auth.store';

export const routeMeta: RouteMeta = {
    title: 'Users Management | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'arc-users',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatSidenavModule,
        MatIconModule,
        MatButtonModule,
        MatPaginatorModule,
        MatDialogModule,
        AddUserComponent,
        EditUserComponent,
        ViewUserComponent,
        GlobalTableComponent,
        PageHeaderComponent
    ],
    providers: [DatePipe, ConstantVariables],
    templateUrl: './users.html',
    styleUrl: './users.scss',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class UsersComponent {
    @ViewChild('drawer') drawer!: MatDrawer;

    userStore = inject(UserStore);
    private authStore = inject(AuthState);
    private authService = inject(AuthService);
    dialog = inject(MatDialog);
    sanitizer = inject(DomSanitizer);
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

    // Role from route params
    role: string | null | undefined;

    // Computed values
    allUserList = computed(() => this.userStore.items() || []);

    // Table Config
    tableColumns: TableColumn[] = [];
    @ViewChild('indexTemplate', { static: true }) indexTemplate!: TemplateRef<any>;
    @ViewChild('nameTemplate', { static: true }) nameTemplate!: TemplateRef<any>;
    @ViewChild('emailTemplate', { static: true }) emailTemplate!: TemplateRef<any>;
    @ViewChild('dateTemplate', { static: true }) dateTemplate!: TemplateRef<any>;

    constructor() {
        // Initialize with route params if present
        effect(() => {
            const params = this.route.snapshot.queryParams;
            if (params['page']) this.currentPage.set(+params['page']);
            if (params['pageSize']) this.pageSize.set(+params['pageSize']);
            if (params['sortField']) this.sortField.set(params['sortField']);
            if (params['sortOrder']) this.sortOrder.set(params['sortOrder']);
        });

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

        this.initColumns();
        this.fetchData();
    }

    /**
     * Fetch data with current filter, sort, and pagination settings
     */
    private fetchData(): void {
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

        // Add role filter if set
        if (this.role) {
            whereConditions.push({
                field: 'role',
                operator: '==',
                value: this.role,
            });
        }

        this.userStore.getAll({
            limitCount: this.pageSize(),
            currentPageNumber: this.currentPage(),
            previousPageNumber: this.currentPage() - 1,
            orderByField: this.sortField(),
            orderByDirection: this.sortOrder(),
            whereConditions,
        });
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
        this.currentPage.set(event.pageIndex);
        this.pageSize.set(event.pageSize);

        // Update URL with pagination params
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: {
                page: event.pageIndex,
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

    clearFilters(): void {
        this.filters.set({});
        this.fetchData();
    }

    hasActiveFilters(): boolean {
        return Object.values(this.filters()).some((v) => v && v.trim());
    }

    // Record count helpers
    getStartRecord(): number {
        const total = this.userStore.totalRecords();
        if (total === 0) return 0;
        return this.currentPage() * this.pageSize() + 1;
    }

    getEndRecord(): number {
        const total = this.userStore.totalRecords();
        const end = (this.currentPage() + 1) * this.pageSize();
        return Math.min(end, total);
    }

    // User actions
    deleteItem(item: IUser): void {
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Are you sure you want to delete <strong>${item.name}</strong>?`
        );

        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            width: '350px',
            data: {
                dialogType: 'Delete',
                dialogMessage: msg,
                btnText: 'Delete',
                panelType: 'warn',
            },
        });

        dialogRef.afterClosed().subscribe((result: boolean) => {
            if (result) {
                this.userStore.delete(item.id).subscribe({
                    next: () => {
                        // Clean up hashed email from email_lookup collection
                        if (item.email) {
                            this.authService.removeEmailLookup(item.email).catch((err) =>
                                console.error('Failed to remove email lookup:', err)
                            );
                        }
                        this.toastService.success('User deleted successfully.');
                        this.fetchData();
                    },
                    error: (error) => {
                        console.error('Error deleting user:', error);
                        this.toastService.error('Failed to delete user.');
                    },
                });
            }
        });
    }

    onActiveDeactivate(item: IUser): void {
        const action = item.isActive ? 'block' : 'unblock';
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Are you sure you want to ${action} <strong>${item.name}</strong>?`
        );

        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            width: '350px',
            data: {
                dialogType: 'Confirm',
                dialogMessage: msg,
                btnText: 'Confirm',
                panelType: 'warn',
            },
        });

        dialogRef.afterClosed().subscribe((result: boolean) => {
            if (result) {
                this.userStore.update(item.id, { isActive: !item.isActive }).subscribe({
                    next: () => {
                        this.toastService.success(`User ${action}ed successfully.`);
                        this.fetchData();
                    },
                    error: (error) => {
                        console.error(`Error ${action}ing user:`, error);
                        this.toastService.error(`Failed to ${action} user.`);
                    },
                });
            }
        });
    }

    openVerify(item: IUser): void {
        // Placeholder for email verification functionality
        this.toastService.info('Email verification not yet implemented.');
    }

    initColumns() {
        this.tableColumns = [
            {
                key: 'index',
                header: '#',
                type: 'index'
            },
            {
                key: 'name',
                header: 'Name',
                clickable: true,
                classFn: () => 'fw-bold cursor-pointer text-primary'
            },
            {
                key: 'email',
                header: 'Email',
                type: 'text'
            },
            {
                key: 'role',
                header: 'Role',
                type: 'text'
            },
            {
                key: 'isActive',
                header: 'Status',
                type: 'badge',
                badgeConfig: {
                    trueClass: 'active',
                    falseClass: 'inactive',
                    trueText: 'Active',
                    falseText: 'Inactive'
                }
            },
            {
                key: 'createdAt', // Using creationTime directly
                header: 'Joined',
                type: 'date',
                dateFormat: 'EEE, MMM d, y'
            },
            {
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    {
                        action: 'view',
                        icon: 'fas fa-eye text-secondary',
                        label: 'View',
                        class: 'view',
                        onAction: (row) => this.openView(row.id)
                    },
                    {
                        action: 'edit',
                        icon: 'fas fa-pen text-primary',
                        label: 'Edit',
                        class: 'edit',
                        onAction: (row) => this.openEdit(row.id)
                    },
                    {
                        action: 'toggleActive',
                        icon: 'fas fa-ban', // Default icon
                        iconFn: (row) => row.isActive ? 'fas fa-ban' : 'fas fa-check',
                        labelFn: (row) => row.isActive ? 'Block' : 'Unblock',
                        class: 'edit', // or custom class
                        onAction: (row) => this.onActiveDeactivate(row)
                    },
                    {
                        action: 'verify',
                        icon: 'fas fa-user-check',
                        label: 'Verify',
                        class: 'verify',
                        hide: (row) => !!row.emailVerified,
                        onAction: (row) => this.openVerify(row)
                    },
                    {
                        action: 'delete',
                        icon: 'fas fa-trash text-danger', // Using fas as in Waitlists
                        label: 'Delete',
                        class: 'delete',
                        onAction: (row) => this.deleteItem(row)
                    }
                ]
            }
        ];
    }

    onCellClick(event: { key: string, row: any }) {
        if (event.key === 'displayName') {
            this.openView(event.row.id);
        }
    }

    // Date formatting
    formatNewDate(date: any): string {
        if (!date) return 'N/A';
        const newDate = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
        return this.datePipe.transform(newDate, 'EEE, MMM d, y') || 'N/A';
    }

    // Set sort field from table event
    setSortField(field: string): void {
        this.onSort(field);
    }
}
