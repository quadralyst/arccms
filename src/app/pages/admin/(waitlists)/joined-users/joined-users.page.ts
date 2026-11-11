/**
 * Sign-ups page
 *
 * The people who signed up through one form, a page at a time: each page is one
 * Firestore read of `pageSize` sign-ups, and the totals are aggregate counts, so
 * a form with many thousands of sign-ups opens as fast as a small one. A side
 * panel shows one sign-up with its tags and notes.
 */

import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, OnInit, Injector, inject, runInInjectionContext, signal, computed, ViewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Firestore, collection, getDocs, orderBy, query, doc, getDoc, writeBatch, increment, limit, startAfter, where, getCountFromServer, QueryDocumentSnapshot } from '@angular/fire/firestore';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { ViewUserDetailComponent } from './view-user-detail/view-user-detail.component';
import { IWaitlistUserTag } from './waitlist-user-tags.model';
import { WaitlistUserTagsStore } from './waitlist-user-tags.store';
import { GlobalTableComponent, TableColumn } from '../../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../../shared/components/page-header/page-header.component';
import { roleGuard } from '../../../../guards/role.guard';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ConfirmService } from '../../../../../shared/components/confirmation-popup/confirm.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { escapeHtml } from '../../../../../shared/utils/escape-html';

export const routeMeta: RouteMeta = {
    title: 'Sign-ups',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

interface WaitlistUser {
    id: string;
    email: string;
    firstName: string;
    emailVerified: boolean;
    isConfirmed: boolean;
    signupTimestamp: any;
    verifiedAt?: any;
    formData?: Record<string, any>;
    tags?: string[];
}

@Component({
    selector: 'arc-joined-users',
    templateUrl: './joined-users.page.html',
    styleUrls: ['./joined-users.page.scss'],
    standalone: true,
    imports: [
        CommonModule,
        MatSidenavModule,
        MatIconModule,
        MatButtonModule,
        MatPaginatorModule,
        ViewUserDetailComponent,
        GlobalTableComponent,
        PageHeaderComponent,
        TranslocoPipe
    ],
})
export default class JoinedUsersComponent implements OnInit {
    @ViewChild('drawer') drawer!: MatDrawer;

    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private firestore = inject(Firestore);
    private tagsStore = inject(WaitlistUserTagsStore);
    private injector = inject(Injector);
    private confirmDialog = inject(ConfirmService);
    private notify = inject(NotifyService);
    private transloco = inject(TranslocoService);

    waitlistId = signal<string>('');
    waitlistName = signal<string>('');
    loading = signal(false);
    isDeleting = signal(false);
    isExporting = signal(false);
    /** Set when the sign-ups did not load; the table shows it with Retry. */
    loadError = signal<boolean | null>(null);
    /** The sign-ups on the page shown. */
    users = signal<WaitlistUser[]>([]);

    // Drawer state
    currentUser = signal<WaitlistUser | null>(null);

    // Tags for display
    allTags = computed(() => this.tagsStore.items());

    // Stats: aggregate counts, never a read of every sign-up
    totalUsers = signal(0);
    verifiedUsers = signal(0);

    // Pagination
    pageSize = signal(10);
    currentPage = signal(0);

    /** The page's rows (kept as a name the template and specs already use). */
    paginatedUsers = computed(() => this.users());

    /** The last sign-up of each page read so far, where the next page starts. */
    private cursors: QueryDocumentSnapshot[] = [];
    /** The latest page asked for: an older read that answers late is dropped. */
    private pageTicket = 0;

    // Table Config
    tableColumns: TableColumn[] = [];

    constructor() { }

    ngOnInit(): void {
        const id = this.route.snapshot.paramMap.get('waitlistId');
        if (id) {
            this.waitlistId.set(id);
            this.loadWaitlistInfo(id);
            this.loadUsers();
            this.loadTags(id);
            this.initColumns();
        }
    }

    initColumns() {
        this.tableColumns = [
            { key: 'index', header: '#', type: 'index' },
            {
                key: 'user',
                header: 'admin.forms.signups.col.person',
                transformFn: (row: WaitlistUser) => `${row.firstName || '-'} (${row.email})`,
                classFn: () => 'fw-bold'
            },
            {
                key: 'isConfirmed',
                header: 'common.table.status',
                type: 'badge',
                badgeConfig: {
                    textFn: (row: WaitlistUser) => this.transloco.translate(row.isConfirmed ? 'admin.forms.status.confirmed' : 'admin.forms.status.pending'),
                },
                classFn: (row: WaitlistUser) => row.isConfirmed ? 'active' : 'inactive',
            },
            {
                key: 'tags',
                header: 'admin.forms.signups.col.tags',
                type: 'tags',
                transformFn: (row: WaitlistUser) => this.getUserTags(row),
                tagConfig: { class: 'tag-label' }
            },
            {
                key: 'signupTimestamp',
                header: 'admin.forms.signups.col.signed_up',
                type: 'date',
                dateFormat: 'MMM d, y, h:mm a'
            },
            {
                key: 'actions',
                header: 'common.table.actions',
                type: 'actions',
                actions: [
                    {
                        action: 'view',
                        icon: 'fas fa-eye text-primary',
                        label: 'admin.forms.signups.view',
                        onAction: (row) => this.openUserDetail(row)
                    },
                    {
                        action: 'delete',
                        icon: 'fas fa-trash text-danger',
                        label: 'common.actions.delete',
                        onAction: (row) => this.deleteUser(row)
                    }
                ]
            }
        ];
    }

    async loadWaitlistInfo(waitlistId: string): Promise<void> {
        try {
            const waitlistRef = runInInjectionContext(this.injector, () => doc(this.firestore, 'Waitlists', waitlistId));
            const waitlistSnap = await runInInjectionContext(this.injector, () => getDoc(waitlistRef));
            if (waitlistSnap.exists()) {
                const data = waitlistSnap.data();
                this.waitlistName.set(data['name'] || '');
            }
        } catch (error) {
            console.error('Error loading waitlist info:', error);
        }
    }

    private signupsRef() {
        return runInInjectionContext(this.injector, () => collection(this.firestore, `Waitlists/${this.waitlistId()}/users`));
    }

    /** Totals and the current page. Retry calls this too. */
    async loadUsers(): Promise<void> {
        await Promise.all([this.loadCounts(), this.loadPage()]);
    }

    /** All sign-ups and the confirmed ones, as two aggregate counts. */
    async loadCounts(): Promise<void> {
        try {
            const usersRef = this.signupsRef();
            const confirmedQuery = runInInjectionContext(this.injector, () => query(usersRef, where('isConfirmed', '==', true)));
            const [all, confirmed] = await Promise.all([
                runInInjectionContext(this.injector, () => getCountFromServer(usersRef)),
                runInInjectionContext(this.injector, () => getCountFromServer(confirmedQuery)),
            ]);
            this.totalUsers.set(all.data().count);
            this.verifiedUsers.set(confirmed.data().count);
        } catch (error) {
            console.error('Counting the sign-ups failed:', error);
        }
    }

    /**
     * Read one page, newest first. The next page starts after the last sign-up of
     * the page before; a jump past pages not read yet (the "last page" button)
     * reads up to that page once and keeps where each page starts.
     */
    async loadPage(): Promise<void> {
        const page = this.currentPage();
        const size = this.pageSize();
        const ticket = ++this.pageTicket;
        this.loading.set(true);
        this.loadError.set(null);
        try {
            const usersRef = this.signupsRef();
            const after = page > 0 ? this.cursors[page - 1] : undefined;
            const jump = page > 0 && !after;
            const q = runInInjectionContext(this.injector, () => jump
                ? query(usersRef, orderBy('signupTimestamp', 'desc'), limit((page + 1) * size))
                : after
                    ? query(usersRef, orderBy('signupTimestamp', 'desc'), startAfter(after), limit(size))
                    : query(usersRef, orderBy('signupTimestamp', 'desc'), limit(size)));
            const snapshot = await runInInjectionContext(this.injector, () => getDocs(q));
            if (ticket !== this.pageTicket) return;

            let docs = snapshot.docs;
            if (jump) {
                for (let p = 0; (p + 1) * size <= docs.length && p < page; p++) {
                    this.cursors[p] = docs[(p + 1) * size - 1];
                }
                docs = docs.slice(page * size);
            }
            if (docs.length) this.cursors[page] = docs[docs.length - 1];
            this.users.set(docs.map((d) => ({ id: d.id, ...d.data() } as WaitlistUser)));
        } catch (error) {
            if (ticket !== this.pageTicket) return;
            console.error('Loading the sign-ups failed:', error);
            this.loadError.set(true);
        } finally {
            if (ticket === this.pageTicket) this.loading.set(false);
        }
    }

    loadTags(waitlistId: string): void {
        this.tagsStore.setWaitlistId(waitlistId);
        this.tagsStore.getAll({
            limitCount: 100,
            currentPageNumber: 0,
            previousPageNumber: -1
        });
    }

    // Get tags for a user by their tag IDs
    getUserTags(user: WaitlistUser): IWaitlistUserTag[] {
        if (!user.tags || user.tags.length === 0) return [];
        return this.allTags().filter(tag => user.tags!.includes(tag.id));
    }

    formatDate(timestamp: any): string {
        if (!timestamp) return '';
        const date = timestamp.toDate ? timestamp.toDate() : new Date(timestamp);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    goBack(): void {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        if (returnUrl) {
            this.router.navigateByUrl(returnUrl);
        } else {
            this.router.navigate(['/admin/waitlists']);
        }
    }

    // Drawer methods
    openUserDetail(user: WaitlistUser): void {
        this.currentUser.set(user);
        this.drawer.open();
    }

    closeDrawer(): void {
        this.drawer.close();
        this.currentUser.set(null);
    }

    onUserUpdated(updatedUser: WaitlistUser): void {
        // Update the user in the list
        this.users.update(users =>
            users.map(u => u.id === updatedUser.id ? updatedUser : u)
        );
    }

    async deleteUser(user: WaitlistUser): Promise<void> {
        const confirmed = await this.confirmDialog.ask({
            titleKey: 'common.dialog.delete',
            dialogMessage: this.transloco.translate('admin.forms.signup_delete_confirm', {
                name: escapeHtml(user.firstName || user.email),
            }),
            btnText: this.transloco.translate('common.actions.delete'),
            panelType: 'warn',
        });
        if (!confirmed) return;

        this.isDeleting.set(true);
        try {
            const waitlistId = this.waitlistId();
            const batch = runInInjectionContext(this.injector, () => writeBatch(this.firestore));

            // 1. Delete the user from Waitlists/{waitlistId}/users
            const userRef = runInInjectionContext(this.injector, () => doc(this.firestore, `Waitlists/${waitlistId}/users`, user.id));
            batch.delete(userRef);

            // 2. If user was confirmed, decrement totalSignups on the waitlist
            if (user.isConfirmed) {
                const waitlistRef = runInInjectionContext(this.injector, () => doc(this.firestore, 'Waitlists', waitlistId));
                batch.update(waitlistRef, { totalSignups: increment(-1) });
            }

            await batch.commit();

            // The totals drop by one, and the page refills from where it starts:
            // where later pages start has moved, so those are read afresh.
            this.totalUsers.update((n) => Math.max(0, n - 1));
            if (user.isConfirmed) this.verifiedUsers.update((n) => Math.max(0, n - 1));
            const lastPage = Math.max(0, Math.ceil(this.totalUsers() / this.pageSize()) - 1);
            if (this.currentPage() > lastPage) this.currentPage.set(lastPage);
            this.cursors.length = this.currentPage();
            await this.loadPage();
        } catch (error) {
            console.error('Error deleting user:', error);
            this.notify.error('admin.forms.signup_delete_failed');
        } finally {
            this.isDeleting.set(false);
        }
    }

    // Pagination
    onPageChange(event: PageEvent): void {
        if (event.pageSize !== this.pageSize()) this.cursors = [];
        this.currentPage.set(event.pageIndex);
        this.pageSize.set(event.pageSize);
        this.loadPage();
    }

    getStartRecord(): number {
        return this.currentPage() * this.pageSize() + 1;
    }

    getEndRecord(): number {
        const end = this.currentPage() * this.pageSize() + this.users().length;
        return Math.min(end, this.totalUsers());
    }

    /** Every sign-up as a CSV file: the one place that reads them all, and only when asked. */
    async exportUsers(): Promise<void> {
        this.isExporting.set(true);
        try {
            const q = runInInjectionContext(this.injector, () => query(this.signupsRef(), orderBy('signupTimestamp', 'desc')));
            const snapshot = await runInInjectionContext(this.injector, () => getDocs(q));
            const all = snapshot.docs.map((d) => ({ id: d.id, ...d.data() } as WaitlistUser));
            const t = (key: string) => this.transloco.translate(key);
            const headers = [
                t('admin.forms.signups.csv.name'), t('admin.forms.signups.csv.email'), t('common.table.status'),
                t('admin.forms.signups.col.tags'), t('admin.forms.signups.col.signed_up'),
            ];
            const rows = all.map((u) => [
                u.firstName,
                u.email,
                t(u.emailVerified ? 'admin.forms.status.verified' : (u.isConfirmed ? 'admin.forms.status.confirmed' : 'admin.forms.status.pending')),
                this.getUserTags(u).map((tag) => tag.label).join(', '),
                this.formatDate(u.signupTimestamp),
            ]);
            const cell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            const csv = [headers, ...rows].map((r) => r.map(cell).join(',')).join('\n');

            const blob = new Blob([csv], { type: 'text/csv' });
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `form-${this.waitlistId()}-sign-ups.csv`;
            a.click();
            window.URL.revokeObjectURL(url);
        } catch (error) {
            console.error('Exporting the sign-ups failed:', error);
            this.notify.error('admin.forms.signups.export_failed');
        } finally {
            this.isExporting.set(false);
        }
    }
}
