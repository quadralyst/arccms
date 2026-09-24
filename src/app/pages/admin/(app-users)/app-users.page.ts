/**
 * Audience, App users (docs/coexistence-spec.md section 5b, CO6.3).
 *
 * The host app's users, read live from its own collection through the App
 * audience settings. They are not ArcCMS users and nothing about them is copied
 * here: the list is fetched on open, filtered in the browser (a host app has
 * hundreds of users), and a row opens every field of that one document.
 */
import { ChangeDetectionStrategy, Component, OnInit, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { Functions } from '@angular/fire/functions';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { DatePipe } from '@angular/common';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { TranslocoPipe } from '@jsverse/transloco';
import { arcCallable } from '../../../core/config/arc-functions';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { statusBadgeClass } from '../../../../shared/utils/status-badge';

/** Mirrors functions/src/app-audience/listAppUsers.ts. */
export interface AppUserRow {
    docId: string;
    key: string;
    email: string;
    phone: string;
    name: string;
    consent: 'subscribed' | 'unsubscribed';
}

interface AppUserList {
    rows: AppUserRow[];
    scanned: number;
    withoutKey: number;
    truncated: boolean;
}

/** Mirrors AppUserActivity in functions/src/app-audience/listAppUsers.ts. */
export interface AppUserActivity {
    id: string;
    type: string;
    at: string;
    field?: string;
    from?: string;
    to?: string;
    status: string;
}

interface AppUserDetail {
    person: Omit<AppUserRow, 'consent'>;
    fields: Record<string, string>;
    state: { consent: AppUserRow['consent'] };
    activity: AppUserActivity[];
}

/** Event bus outcomes with a label; anything else shows as it is. */
const ACTIVITY_STATUSES = ['ok', 'no_mapping', 'disabled', 'no_matching_rule', 'error'];

interface AppUsersLocation {
    configured: boolean;
    path: string;
}

/** Mirrors MAX_APP_USERS in functions/src/app-audience/listAppUsers.ts. */
export const MAX_APP_USERS = 2000;

@Component({
    standalone: true,
    imports: [
        DatePipe, FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule,
        MatPaginatorModule, MatSidenavModule, GlobalTableComponent, PageHeaderComponent, TranslocoPipe,
    ],
    templateUrl: './app-users.page.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class AppUsersPageComponent implements OnInit {
    @ViewChild('drawer') drawer?: MatDrawer;

    private functions = inject(Functions);

    readonly maxAppUsers = MAX_APP_USERS;
    loading = signal(true);
    error = signal('');
    location = signal<AppUsersLocation | null>(null);
    list = signal<AppUserList | null>(null);
    search = signal('');
    currentPage = signal(0);
    pageSize = signal(25);

    detail = signal<AppUserDetail | null>(null);
    detailLoading = signal(false);
    detailError = signal('');

    filtered = computed(() => {
        const term = this.search().trim().toLowerCase();
        const rows = this.list()?.rows ?? [];
        if (!term) return rows;
        return rows.filter((r) => [r.key, r.email, r.phone, r.name].some((v) => v.toLowerCase().includes(term)));
    });
    total = computed(() => this.filtered().length);
    paged = computed(() => {
        const start = this.currentPage() * this.pageSize();
        return this.filtered().slice(start, start + this.pageSize());
    });
    detailFields = computed(() => Object.entries(this.detail()?.fields ?? {}).sort(([a], [b]) => a.localeCompare(b)));

    columns: TableColumn[] = [
        { key: 'name', header: 'admin.audience.app_users.name', type: 'text', transformFn: (r) => r.name || '-' },
        { key: 'email', header: 'admin.audience.app_users.email', type: 'text', transformFn: (r) => r.email || '-' },
        { key: 'phone', header: 'admin.audience.app_users.phone', type: 'text', transformFn: (r) => r.phone || '-' },
        { key: 'key', header: 'admin.audience.app_users.key', type: 'code' },
        {
            key: 'consent', header: 'admin.audience.app_users.consent', type: 'html',
            transformFn: (r) => `<span class="${statusBadgeClass(r.consent)}">${r.consent}</span>`,
        },
        {
            key: 'actions', header: 'common.table.actions', type: 'actions',
            actions: [{
                action: 'view', icon: 'fas fa-eye text-secondary', label: 'common.actions.view', class: 'view',
                isRowClick: true, onAction: (row) => this.openDetail(row),
            }],
        },
    ];

    badge = statusBadgeClass;

    /** The translation key for an event's outcome. */
    activityStatusKey(status: string): string {
        const known = status === '' ? 'pending' : ACTIVITY_STATUSES.includes(status) ? status : 'other';
        return `admin.audience.app_users.activity_status.${known}`;
    }
    trackRow = (_: number, row: AppUserRow) => row.docId;

    ngOnInit(): void {
        void this.load();
    }

    async load(): Promise<void> {
        this.loading.set(true);
        this.error.set('');
        try {
            const status = await arcCallable<unknown, { location: AppUsersLocation }>(this.functions, 'appAudienceStatus')();
            this.location.set(status.data.location);
            if (status.data.location.configured) {
                const res = await arcCallable<unknown, AppUserList>(this.functions, 'listAppUsers')({});
                this.list.set(res.data);
            }
        } catch (e: any) {
            this.error.set(e?.message || String(e));
        } finally {
            this.loading.set(false);
        }
    }

    onSearch(term: string): void {
        this.search.set(term);
        this.currentPage.set(0);
    }

    onPageChange(e: PageEvent): void {
        this.currentPage.set(e.pageIndex);
        this.pageSize.set(e.pageSize);
    }

    startRecord = computed(() => (this.total() === 0 ? 0 : this.currentPage() * this.pageSize() + 1));
    endRecord = computed(() => Math.min((this.currentPage() + 1) * this.pageSize(), this.total()));

    async openDetail(row: AppUserRow): Promise<void> {
        this.detail.set(null);
        this.detailError.set('');
        this.detailLoading.set(true);
        this.drawer?.open();
        try {
            const res = await arcCallable<{ docId: string }, AppUserDetail>(this.functions, 'getAppUser')({ docId: row.docId });
            this.detail.set(res.data);
        } catch (e: any) {
            this.detailError.set(e?.message || String(e));
        } finally {
            this.detailLoading.set(false);
        }
    }

    closeDetail(): void {
        this.drawer?.close();
    }
}
