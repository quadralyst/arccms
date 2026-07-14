import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { statusBadgeClass } from '../../../../shared/utils/status-badge';
import { DripService, DripCampaign, TemplateOption } from './drip.service';
import { AudienceService } from '../(audience)/audience.service';
import { IList } from '../(audience)/audience.model';
import { DripDrawerComponent, DripDrawerMode } from './(drip-drawer)/drip-drawer.component';

export const routeMeta: RouteMeta = {
    title: 'Drip Campaigns | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, MatButtonModule, MatIconModule, MatSidenavModule,
        GlobalTableComponent, DripDrawerComponent, PageHeaderComponent,
    ],
    templateUrl: './drips.page.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class DripsPageComponent implements OnInit {
    @ViewChild('drawer') drawer!: MatDrawer;

    private service = inject(DripService);
    private audience = inject(AudienceService);
    private toast = inject(ToastService);
    private destroyRef = inject(DestroyRef);

    campaigns = signal<DripCampaign[]>([]);
    lists = signal<IList[]>([]);
    templates = signal<TemplateOption[]>([]);
    loading = signal(true);

    currentAction = signal<DripDrawerMode | ''>('');
    currentCampaign = signal<DripCampaign | null>(null);

    columns: TableColumn[] = [
        { key: 'name', header: 'Campaign', type: 'text', classFn: () => 'fw-medium' },
        {
            key: 'status', header: 'Status', type: 'html',
            transformFn: (r) => `<span class="${statusBadgeClass(r.status)}">${r.status}</span>`,
        },
        { key: 'listId', header: 'List', type: 'text', classFn: () => 'small', transformFn: (r) => this.listName(r.listId) },
        {
            key: 'counts', header: 'Enrollment', type: 'text', classFn: () => 'small',
            transformFn: (r) => `${r.counts?.enrolled || 0} enrolled · ${r.counts?.completed || 0} completed · ${r.counts?.exited || 0} exited`,
        },
        { key: 'steps', header: 'Steps', type: 'text', transformFn: (r) => (r.steps || []).length },
        {
            key: 'actions', header: 'Actions', type: 'actions',
            actions: [
                {
                    action: 'edit', icon: 'fas fa-pen text-primary', label: 'Edit', class: 'edit',
                    isRowClick: true, onAction: (row) => this.openEdit(row),
                },
                {
                    action: 'activate', icon: 'fas fa-play text-success', label: 'Activate', class: 'edit',
                    hide: (row) => row.status !== 'draft', onAction: (row) => this.activate(row),
                },
                {
                    action: 'resume', icon: 'fas fa-play text-success', label: 'Resume', class: 'edit',
                    hide: (row) => row.status !== 'paused', onAction: (row) => this.resume(row),
                },
                {
                    action: 'pause', icon: 'fas fa-pause', label: 'Pause', class: 'edit',
                    hide: (row) => row.status !== 'active', onAction: (row) => this.pause(row),
                },
                {
                    action: 'archive', icon: 'fas fa-box-archive text-danger', label: 'Archive', class: 'delete',
                    hide: (row) => row.status === 'archived', onAction: (row) => this.archive(row),
                },
            ],
        },
    ];

    ngOnInit(): void {
        this.service.watchCampaigns().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((c) => {
            this.campaigns.set(c);
            this.loading.set(false);
        });
        this.audience.getLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((l) => this.lists.set(l));
        this.service.watchTemplates().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((t) => this.templates.set(t));
    }

    listName(id: string): string {
        return this.lists().find((l) => l.id === id)?.name || id;
    }

    // Drawer
    openAdd(): void {
        this.currentAction.set('add');
        this.currentCampaign.set(null);
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
            this.toast.success(`Activated${res?.data?.enrolled ? ` — enrolled ${res.data.enrolled}` : ''}`);
        } catch (e) { console.error(e); this.toast.error('Failed to activate'); }
    }

    async pause(c: DripCampaign): Promise<void> {
        try { await this.service.setStatus(c.id, 'paused'); this.toast.success('Paused'); }
        catch (e) { console.error(e); this.toast.error('Failed to pause'); }
    }

    async resume(c: DripCampaign): Promise<void> {
        try { await this.service.setStatus(c.id, 'active'); this.toast.success('Resumed'); }
        catch (e) { console.error(e); this.toast.error('Failed to resume'); }
    }

    async archive(c: DripCampaign): Promise<void> {
        try { await this.service.archive(c.id); this.toast.success('Archived — active enrollments exited'); }
        catch (e) { console.error(e); this.toast.error('Failed to archive'); }
    }
}
