import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { AudienceService } from '../(audience)/audience.service';
import { IContact, IList } from '../(audience)/audience.model';
import { statusBadgeClass } from '../../../../shared/utils/status-badge';
import { ContactDrawerComponent, ContactDrawerMode } from './(contact-drawer)/contact-drawer.component';

export const routeMeta: RouteMeta = {
    title: 'Contacts | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule,
        MatInputModule, MatFormFieldModule, MatPaginatorModule, MatSidenavModule,
        GlobalTableComponent, ContactDrawerComponent, PageHeaderComponent,
    ],
    templateUrl: './contacts.page.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class ContactsPageComponent implements OnInit {
    @ViewChild('drawer') drawer!: MatDrawer;

    private audience = inject(AudienceService);
    private toast = inject(ToastService);
    private destroyRef = inject(DestroyRef);
    private route = inject(ActivatedRoute);
    private router = inject(Router);

    contacts = signal<IContact[]>([]);
    lists = signal<IList[]>([]);
    search = signal('');
    busy = signal(false);
    loading = signal(true);

    // Drawer state
    currentAction = signal<ContactDrawerMode | ''>('');
    currentContact = signal<IContact | null>(null);

    // Pagination
    currentPage = signal(0);
    pageSize = signal(10);

    filtered = computed(() => {
        const term = this.search().trim().toLowerCase();
        const all = this.contacts();
        if (!term) return all;
        return all.filter(
            (c) => c.email?.toLowerCase().includes(term) || c.name?.toLowerCase().includes(term),
        );
    });

    total = computed(() => this.filtered().length);

    paged = computed(() => {
        const start = this.currentPage() * this.pageSize();
        return this.filtered().slice(start, start + this.pageSize());
    });

    columns: TableColumn[] = [
        { key: 'email', header: 'Email', type: 'text' },
        { key: 'name', header: 'Name', type: 'text', transformFn: (r) => r.name || '—' },
        { key: 'sources', header: 'Sources', type: 'text', classFn: () => 'small', transformFn: (r) => (r.sources || []).join(', ') || '—' },
        { key: 'listIds', header: 'Lists', type: 'text', transformFn: (r) => (r.listIds || []).length },
        {
            key: 'consent',
            header: 'Consent',
            type: 'html',
            transformFn: (r) => {
                const c = r.consent?.marketing || 'pending';
                return `<span class="${statusBadgeClass(c)}">${c}</span>`;
            },
        },
        {
            key: 'actions',
            header: 'Actions',
            type: 'actions',
            actions: [
                {
                    action: 'view', icon: 'fas fa-eye text-secondary', label: 'View', class: 'view',
                    isRowClick: true, onAction: (row) => this.openView(row),
                },
            ],
        },
    ];

    ngOnInit(): void {
        const qp = this.route.snapshot.queryParams;
        if (qp['page']) this.currentPage.set(+qp['page']);
        if (qp['pageSize']) this.pageSize.set(+qp['pageSize']);

        this.audience.getContacts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((c) => {
            this.contacts.set(c);
            this.loading.set(false);
        });
        this.audience.getLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((l) => this.lists.set(l));
    }

    onSearch(term: string): void {
        this.search.set(term);
        this.currentPage.set(0);
    }

    // Drawer
    openAdd(): void {
        this.currentAction.set('add');
        this.currentContact.set(null);
        this.drawer?.open();
    }

    openImport(): void {
        this.currentAction.set('import');
        this.currentContact.set(null);
        this.drawer?.open();
    }

    openView(contact: IContact): void {
        this.currentAction.set('view');
        this.currentContact.set(contact);
        this.drawer?.open();
    }

    closeDrawer(): void {
        this.drawer?.close();
        this.currentAction.set('');
        this.currentContact.set(null);
    }

    onPageChange(e: PageEvent): void {
        this.currentPage.set(e.pageIndex);
        this.pageSize.set(e.pageSize);
        this.router.navigate([], {
            relativeTo: this.route,
            queryParams: { page: e.pageIndex, pageSize: e.pageSize },
            queryParamsHandling: 'merge',
        });
    }

    getStartRecord(): number {
        return this.total() === 0 ? 0 : this.currentPage() * this.pageSize() + 1;
    }

    getEndRecord(): number {
        return Math.min((this.currentPage() + 1) * this.pageSize(), this.total());
    }

    async runBackfill(): Promise<void> {
        this.busy.set(true);
        try {
            const res: any = await this.audience.backfillContacts();
            const d = res?.data || {};
            this.toast.success(`Backfill done: ${d.users || 0} users, ${d.waitlistMembers || 0} waitlist`);
        } catch (e) {
            console.error(e);
            this.toast.error('Backfill failed');
        } finally {
            this.busy.set(false);
        }
    }
}
