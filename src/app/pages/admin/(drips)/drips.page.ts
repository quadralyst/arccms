import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { ActivatedRoute } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoPipe } from '@jsverse/transloco';
import { Subscription } from 'rxjs';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { statusBadgeClass, statusBadgeLabel } from '../../../../shared/utils/status-badge';
import { escapeHtml } from '../../../../shared/utils/escape-html';
import { injectT } from '../../../core/i18n/inject-t';
import { isTranslationKey } from '../../../core/i18n/translatable.pipe';
import { DripService, DripCampaign, TemplateOption } from './drip.service';
import { AudienceService } from '../(audience)/audience.service';
import { IList } from '../(audience)/audience.model';
import { DripDrawerComponent, DripDrawerMode } from './(drip-drawer)/drip-drawer.component';
import { MAX_APP_USERS } from '../(app-users)/app-users-limit';

export const routeMeta: RouteMeta = {
    title: 'Drip campaigns',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, MatButtonModule, MatIconModule, MatSidenavModule,
        GlobalTableComponent, DripDrawerComponent, PageHeaderComponent, TranslocoPipe,
    ],
    templateUrl: './drips.page.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class DripsPageComponent implements OnInit, AfterViewInit {
    @ViewChild('drawer') drawer!: MatDrawer;

    private service = inject(DripService);
    private audience = inject(AudienceService);
    private toast = inject(ToastService);
    private destroyRef = inject(DestroyRef);
    private route = inject(ActivatedRoute);
    private readonly t = injectT();

    campaigns = signal<DripCampaign[]>([]);
    lists = signal<IList[]>([]);
    templates = signal<TemplateOption[]>([]);
    loading = signal(true);
    /** Set when the campaigns did not load: the table says so and offers Retry. */
    loadError = signal<string | boolean | null>(null);
    private campaignsSub?: Subscription;

    currentAction = signal<DripDrawerMode | ''>('');
    currentCampaign = signal<DripCampaign | null>(null);

    columns: TableColumn[] = [
        { key: 'name', header: 'admin.drips.col_campaign', type: 'text', classFn: () => 'fw-medium' },
        {
            key: 'status', header: 'common.table.status', type: 'html',
            transformFn: (r) => `<span class="${statusBadgeClass(r.status)}">${escapeHtml(this.statusText(r.status))}</span>`,
        },
        { key: 'listId', header: 'admin.drips.col_list', type: 'text', classFn: () => 'small', transformFn: (r) => this.listName(r.listId) },
        {
            key: 'counts', header: 'admin.drips.col_enrollment', type: 'text', classFn: () => 'small',
            transformFn: (r) => this.t('admin.drips.enrollment', {
                enrolled: r.counts?.enrolled || 0, completed: r.counts?.completed || 0, exited: r.counts?.exited || 0,
            }),
        },
        { key: 'steps', header: 'admin.drips.col_steps', type: 'text', transformFn: (r) => (r.steps || []).length },
        {
            key: 'actions', header: 'common.table.actions', type: 'actions',
            actions: [
                {
                    action: 'edit', icon: 'fas fa-pen text-primary', label: 'common.actions.edit', class: 'edit',
                    isRowClick: true, onAction: (row) => this.openEdit(row),
                },
                {
                    action: 'activate', slot: 'status', icon: 'fas fa-play text-success', label: 'admin.drips.activate', class: 'edit',
                    hide: (row) => row.status !== 'draft', onAction: (row) => this.activate(row),
                },
                {
                    action: 'resume', slot: 'status', icon: 'fas fa-play text-success', label: 'admin.drips.resume', class: 'edit',
                    hide: (row) => row.status !== 'paused', onAction: (row) => this.resume(row),
                },
                {
                    action: 'pause', slot: 'status', icon: 'fas fa-pause', label: 'admin.drips.pause', class: 'edit',
                    hide: (row) => row.status !== 'active', onAction: (row) => this.pause(row),
                },
                {
                    action: 'archive', icon: 'fas fa-box-archive text-danger', label: 'admin.drips.archive', class: 'delete',
                    hide: (row) => row.status === 'archived', onAction: (row) => this.archive(row),
                },
            ],
        },
    ];

    /** Set when arriving from a list hub's "New sequence for this list" (U4). */
    private presetListId = '';

    ngOnInit(): void {
        this.load();
        this.audience.getLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((l) => this.lists.set(l));
        this.service.watchTemplates().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((t) => this.templates.set(t));

        this.presetListId = this.route.snapshot.queryParamMap.get('listId') || '';
    }

    /** Read the campaigns (live). Retry calls it again after a failed read. */
    load(): void {
        this.campaignsSub?.unsubscribe();
        this.loading.set(true);
        this.loadError.set(null);
        this.campaignsSub = this.service.watchCampaigns({ surfaceErrors: true })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe({
                next: (c) => {
                    this.campaigns.set(c);
                    this.loadError.set(null);
                    this.loading.set(false);
                },
                error: () => {
                    // The service logged the detail.
                    this.loadError.set(true);
                    this.loading.set(false);
                },
            });
    }

    /** A campaign's status in the admin's language. */
    statusText(status: string): string {
        const key = `admin.drips.status.${status}`;
        return isTranslationKey(key) ? this.t(key) : statusBadgeLabel(status);
    }

    ngAfterViewInit(): void {
        // Deferred to here because @ViewChild('drawer') is not resolved during
        // ngOnInit, so opening it there would silently do nothing.
        if (this.presetListId) {
            this.openAdd(this.presetListId);
            this.presetListId = '';
        }
    }

    listName(id: string): string {
        return this.lists().find((l) => l.id === id)?.name || id;
    }

    // Drawer
    openAdd(presetListId = ''): void {
        this.currentAction.set('add');
        // A partial campaign is enough to preselect the list: the drawer seeds
        // its form from `campaign.listId`.
        this.currentCampaign.set(presetListId ? ({ listId: presetListId } as DripCampaign) : null);
        this.drawer?.open();
    }

    openEdit(c: DripCampaign): void {
        this.currentAction.set('edit');
        this.currentCampaign.set(c);
        this.drawer?.open();
    }

    closeDrawer(): void {
        this.drawer?.close();
        this.currentAction.set('');
        this.currentCampaign.set(null);
    }

    // Status transitions (live-updated via watchCampaigns)
    async activate(c: DripCampaign): Promise<void> {
        try {
            const res: any = await this.service.activate(c.id);
            const enrolled = res?.data?.enrolled;
            this.toast.success(enrolled ? this.t('admin.drips.activated_count', { count: enrolled }) : this.t('admin.drips.activated'));
            // A live list read only the first app users: the rest join when their record changes (review C2).
            if (res?.data?.appUsersCapped) {
                this.toast.warning(this.t('admin.drips.app_users_capped', { count: MAX_APP_USERS.toLocaleString() }));
            }
        } catch (e) { console.error(e); this.toast.error(this.t('admin.drips.activate_failed')); }
    }

    async pause(c: DripCampaign): Promise<void> {
        try { await this.service.setStatus(c.id, 'paused'); this.toast.success(this.t('admin.drips.paused')); }
        catch (e) { console.error(e); this.toast.error(this.t('admin.drips.pause_failed')); }
    }

    async resume(c: DripCampaign): Promise<void> {
        try { await this.service.setStatus(c.id, 'active'); this.toast.success(this.t('admin.drips.resumed')); }
        catch (e) { console.error(e); this.toast.error(this.t('admin.drips.resume_failed')); }
    }

    async archive(c: DripCampaign): Promise<void> {
        try { await this.service.archive(c.id); this.toast.success(this.t('admin.drips.archived')); }
        catch (e) { console.error(e); this.toast.error(this.t('admin.drips.archive_failed')); }
    }
}
