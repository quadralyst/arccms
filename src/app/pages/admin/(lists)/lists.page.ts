import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialogModule } from '@angular/material/dialog';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { injectT } from '../../../core/i18n/inject-t';
import { roleGuard } from '../../../guards/role.guard';
import { NotifyService } from '../../../../shared/services/notify.service';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { AudienceService } from '../(audience)/audience.service';
import { IList } from '../(audience)/audience.model';
import { ListDrawerComponent, ListDrawerMode } from './(list-drawer)/list-drawer.component';
import { escapeHtml } from '../../../../shared/utils/escape-html';

export const routeMeta: RouteMeta = {
    title: 'Lists',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatDialogModule,
        MatSidenavModule, MatTooltipModule, GlobalTableComponent, ListDrawerComponent, PageHeaderComponent, TranslocoPipe,
    ],
    templateUrl: './lists.page.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class ListsPageComponent implements OnInit {
    @ViewChild('drawer') drawer!: MatDrawer;

    private audience = inject(AudienceService);
    private notify = inject(NotifyService);
    private confirm = inject(ConfirmService);
    private transloco = inject(TranslocoService);
    private t = injectT();
    private destroyRef = inject(DestroyRef);
    private router = inject(Router);

    lists = signal<IList[]>([]);
    loading = signal(true);
    /** Set when the lists did not load; the table shows it with Retry. */
    loadError = signal<boolean>(false);
    busy = signal(false);
    private loadSub?: { unsubscribe(): void };

    currentAction = signal<ListDrawerMode | ''>('');
    currentList = signal<IList | null>(null);

    columns: TableColumn[] = [
        { key: 'name', header: 'common.table.name', type: 'text', classFn: () => 'fw-medium' },
        { key: 'description', header: 'common.table.description', type: 'text', classFn: () => 'small text-muted', transformFn: (r) => r.description || '-' },
        {
            key: 'type', header: 'common.table.type', type: 'html',
            // Static markup only — never interpolate list-supplied values here.
            // Translated text from our own files; the list's own values never go in.
            transformFn: (r) => r.formId
                ? `<span class="status-badge is-info">${escapeHtml(this.t('admin.audience.lists.type_form'))}</span>`
                : r.type === 'app'
                    ? `<span class="status-badge is-success">${escapeHtml(this.t('admin.audience.lists.type_app'))}</span>`
                    : r.type === 'system'
                        ? `<span class="status-badge is-info">${escapeHtml(this.t('admin.audience.lists.type_system'))}</span>`
                        : `<span class="status-badge is-neutral">${escapeHtml(this.t('admin.audience.lists.type_manual'))}</span>`,
        },
        // A live list stores no members; its hub counts who matches now.
        { key: 'memberCount', header: 'admin.audience.lists.members', type: 'text', transformFn: (r) => (r.type === 'app' ? this.t('admin.audience.lists.live') : r.memberCount || 0) },
        {
            key: 'actions', header: 'common.table.actions', type: 'actions',
            actions: [
                {
                    action: 'open', icon: 'fas fa-arrow-right text-primary', label: 'common.actions.open', class: 'edit',
                    // Row click opens the hub for every list — including system
                    // lists, which have no editable settings but do have members,
                    // broadcasts and sequences worth seeing.
                    isRowClick: true, onAction: (row) => this.openHub(row),
                },
                {
                    action: 'view-form', icon: 'fas fa-arrow-up-right-from-square text-primary', label: 'admin.audience.lists.view_form', class: 'edit',
                    hide: (row) => !row.formId, onAction: (row) => this.viewForm(row),
                },
                {
                    action: 'edit', icon: 'fas fa-pen text-primary', label: 'common.actions.edit', class: 'edit',
                    hide: (row) => row.type === 'system', onAction: (row) => this.openEdit(row),
                },
                {
                    action: 'delete', icon: 'fas fa-trash text-danger', label: 'common.actions.delete', class: 'delete',
                    hide: (row) => row.type === 'system', onAction: (row) => this.confirmDelete(row),
                },
            ],
        },
    ];

    ngOnInit(): void {
        this.load();
    }

    /** Listen to the lists; called again by Retry. */
    load(): void {
        this.loadSub?.unsubscribe();
        this.loading.set(true);
        this.loadError.set(false);
        let failed = false;
        this.loadSub = this.audience.getLists(() => { failed = true; })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((lists) => {
                this.lists.set(lists);
                this.loadError.set(failed);
                this.loading.set(false);
            });
    }


    openAdd(): void {
        this.currentAction.set('add');
        this.currentList.set(null);
        this.drawer?.open();
    }

    openEdit(list: IList): void {
        this.currentAction.set('edit');
        this.currentList.set(list);
        this.drawer?.open();
    }

    /**
     * Backfill lists for signup forms created before eager list creation existed
     * (and repair names/back-pointers on lists the old lazy path left behind).
     */
    async syncFormLists(): Promise<void> {
        this.busy.set(true);
        try {
            const res = await this.audience.backfillFormLists();
            const d: any = res?.data || {};
            this.notify.success('admin.audience.lists.synced', { forms: d.forms ?? 0, created: d.created ?? 0, repaired: d.repaired ?? 0 });
        } catch (e) {
            console.error('Syncing form lists failed', e);
            this.notify.error('admin.audience.lists.sync_failed');
        } finally {
            this.busy.set(false);
        }
    }

    /** Open the list's workspace: members, broadcasts and sequence (U4). */
    openHub(list: IList): void {
        this.router.navigate(['/admin/lists', list.id]);
    }

    /** Jump from a form-fed list to the signup form that feeds it. */
    viewForm(list: IList): void {
        if (!list.formId) return;
        this.router.navigate(['/admin/waitlists/dashboard', list.formId]);
    }

    closeDrawer(): void {
        this.drawer?.close();
        this.currentAction.set('');
        this.currentList.set(null);
    }

    async confirmDelete(list: IList): Promise<void> {
        if (list.type === 'system') {
            this.notify.error('admin.audience.lists.system_no_delete');
            return;
        }
        const ok = await this.confirm.ask({
            titleKey: 'common.dialog.delete',
            dialogMessage: this.t('admin.audience.lists.delete_confirm', { name: escapeHtml(list.name) }),
            btnText: this.t('common.actions.delete'),
            panelType: 'warn',
        });
        if (!ok) return;
        try {
            await this.audience.deleteList(list.id);
            this.notify.success('admin.audience.lists.deleted');
        } catch (e) {
            console.error('Deleting the list failed', e);
            this.notify.error('admin.audience.lists.delete_failed');
        }
    }
}
