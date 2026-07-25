import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { ActivatedRoute, Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { AudienceService } from '../(audience)/audience.service';
import { IContact, IList, ITag, IContactField, MarketingConsent } from '../(audience)/audience.model';
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
        MatInputModule, MatFormFieldModule, MatPaginatorModule, MatSelectModule,
        MatTooltipModule, MatSidenavModule,
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
    tags = signal<ITag[]>([]);
    fields = signal<IContactField[]>([]);
    search = signal('');
    /** '' = any. Pending contacts are visible here but never mailable. */
    consentFilter = signal<MarketingConsent | ''>('');
    tagFilter = signal<string>('');
    busy = signal(false);
    loading = signal(true);

    tagsById = computed(() => new Map(this.tags().map((t) => [t.id, t])));

    // Drawer state
    currentAction = signal<ContactDrawerMode | ''>('');
    currentContact = signal<IContact | null>(null);

    // Pagination
    currentPage = signal(0);
    pageSize = signal(10);

    filtered = computed(() => {
        const term = this.search().trim().toLowerCase();
        const consent = this.consentFilter();
        const tag = this.tagFilter();

        return this.contacts().filter((c) => {
            if (term && !(c.email?.toLowerCase().includes(term) || c.name?.toLowerCase().includes(term))) {
                return false;
            }
            // Contacts written before U2 have no consent field; they predate the
            // pending state, so treat them as subscribed rather than hiding them
            // from a 'subscribed' filter.
            if (consent && (c.consent?.marketing || 'subscribed') !== consent) return false;
            if (tag && !(c.tags || []).includes(tag)) return false;
            return true;
        });
    });

    total = computed(() => this.filtered().length);

    /** Headline counts for the loaded audience (subscribed vs pending). */
    counts = computed(() => {
        const all = this.contacts();
        const by = (v: MarketingConsent) => all.filter((c) => (c.consent?.marketing || 'subscribed') === v).length;
        return { subscribed: by('subscribed'), pending: by('pending'), unsubscribed: by('unsubscribed') };
    });

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
            key: 'tags', header: 'Tags', type: 'tags',
            // Resolve ids to the live tag docs so labels/colours follow renames.
            transformFn: (r) => (r.tags || [])
                .map((id: string) => this.tagsById().get(id))
                .filter(Boolean),
        },
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
        // Deep-link from the Tags page ("View contacts") and the audience counts.
        if (qp['tag']) this.tagFilter.set(qp['tag']);
        if (qp['consent']) this.consentFilter.set(qp['consent']);

        this.audience.getContacts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((c) => {
            this.contacts.set(c);
            this.loading.set(false);
        });
        this.audience.getLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((l) => this.lists.set(l));
        this.audience.getTags().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((t) => this.tags.set(t));
        this.audience.getFields().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((f) => this.fields.set(f));
    }

    onSearch(term: string): void {
        this.search.set(term);
        this.currentPage.set(0);
    }

    onConsentFilter(value: MarketingConsent | ''): void {
        this.consentFilter.set(value);
        this.currentPage.set(0);
    }

    onTagFilter(value: string): void {
        this.tagFilter.set(value);
        this.currentPage.set(0);
    }

    clearFilters(): void {
        this.consentFilter.set('');
        this.tagFilter.set('');
        this.search.set('');
        this.currentPage.set(0);
    }

    hasFilters = computed(() => !!(this.consentFilter() || this.tagFilter() || this.search().trim()));

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

    /**
     * Rebuild the audience from existing data. Runs both passes in the runbook's
     * order — `backfillContacts` covers app users and verified members, then
     * `backfillPendingContacts` picks up the unverified backlog as `pending`.
     * They are complementary and both idempotent, so one button avoids the
     * footgun of running only half the migration.
     */
    async runBackfill(): Promise<void> {
        this.busy.set(true);
        try {
            const res: any = await this.audience.backfillContacts();
            const d = res?.data || {};

            const pendingRes: any = await this.audience.backfillPendingContacts();
            const p = pendingRes?.data || {};

            this.toast.success(
                `Backfill done: ${d.users || 0} users, ${d.waitlistMembers || 0} verified members, ` +
                `${p.created || 0} pending signups`,
            );
        } catch (e) {
            console.error(e);
            this.toast.error('Backfill failed');
        } finally {
            this.busy.set(false);
        }
    }
}
