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
import { roleGuard } from '../../../guards/role.guard';
import { NotifyService } from '../../../../shared/services/notify.service';
import { escapeHtml } from '../../../../shared/utils/escape-html';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { AudienceService } from '../(audience)/audience.service';
import { ITag } from '../(audience)/audience.model';
import { TagDrawerComponent, TagDrawerMode } from './(tag-drawer)/tag-drawer.component';

export const routeMeta: RouteMeta = {
    title: 'Tags',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatDialogModule,
        MatSidenavModule, MatTooltipModule, GlobalTableComponent, TagDrawerComponent, PageHeaderComponent, TranslocoPipe,
    ],
    templateUrl: './contact-tags.page.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class ContactTagsPageComponent implements OnInit {
    @ViewChild('drawer') drawer!: MatDrawer;

    private audience = inject(AudienceService);
    private notify = inject(NotifyService);
    private confirm = inject(ConfirmService);
    private transloco = inject(TranslocoService);
    private destroyRef = inject(DestroyRef);
    private router = inject(Router);

    tags = signal<ITag[]>([]);
    loading = signal(true);
    /** The tags did not load; the table shows it with Retry. */
    loadError = signal(false);
    busy = signal(false);
    private loadSub?: { unsubscribe(): void };

    currentAction = signal<TagDrawerMode | ''>('');
    currentTag = signal<ITag | null>(null);

    columns: TableColumn[] = [
        // `tags` type renders label+colour through Angular bindings, so labels
        // never need hand-escaping into markup.
        {
            key: 'label', header: 'admin.audience.tags.tag', type: 'tags',
            transformFn: (r) => [r],
            tagConfig: { class: 'tag-label' },
        },
        { key: 'id', header: 'common.table.id', type: 'code', classFn: () => 'small text-muted' },
        {
            key: 'usageCount', header: 'admin.audience.tags.contacts', type: 'text',
            transformFn: (r) => r.usageCount || 0,
        },
        {
            key: 'actions', header: 'common.table.actions', type: 'actions',
            actions: [
                {
                    action: 'view', icon: 'fas fa-user-group text-primary', label: 'admin.audience.tags.view_contacts', class: 'edit',
                    hide: (row) => !row.usageCount, onAction: (row) => this.viewContacts(row),
                },
                {
                    action: 'edit', icon: 'fas fa-pen text-primary', label: 'common.actions.edit', class: 'edit',
                    isRowClick: true, onAction: (row) => this.openEdit(row),
                },
                {
                    action: 'delete', icon: 'fas fa-trash text-danger', label: 'common.actions.delete', class: 'delete',
                    onAction: (row) => this.confirmDelete(row),
                },
            ],
        },
    ];

    ngOnInit(): void {
        this.load();
    }

    /** Listen to the tags; called again by Retry. */
    load(): void {
        this.loadSub?.unsubscribe();
        this.loading.set(true);
        this.loadError.set(false);
        let failed = false;
        this.loadSub = this.audience.getTags(() => { failed = true; })
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe((tags) => {
                this.tags.set(tags);
                this.loadError.set(failed);
                this.loading.set(false);
            });
    }

    openAdd(): void {
        this.currentAction.set('add');
        this.currentTag.set(null);
        this.drawer?.open();
    }

    openEdit(tag: ITag): void {
        this.currentAction.set('edit');
        this.currentTag.set(tag);
        this.drawer?.open();
    }

    closeDrawer(): void {
        this.drawer?.close();
        this.currentAction.set('');
        this.currentTag.set(null);
    }

    /** Show everyone carrying this tag, on the Contacts page. */
    viewContacts(tag: ITag): void {
        this.router.navigate(['/admin/contacts'], { queryParams: { tag: tag.id } });
    }

    /**
     * Import per-form tags into the global layer. Idempotent, so it is safe
     * to re-run after new contacts are backfilled.
     */
    async runMigration(): Promise<void> {
        this.busy.set(true);
        try {
            const res: any = await this.audience.migrateTagsToContacts();
            const d = res?.data || {};
            this.notify.success('admin.audience.tags.imported', {
                tags: (d.tagsCreated || 0) + (d.tagsMerged || 0),
                created: d.tagsCreated || 0,
                assignments: d.assignmentsCopied || 0,
                contacts: d.contactsTagged || 0,
            });
        } catch (e) {
            console.error('Importing form tags failed', e);
            this.notify.error('admin.audience.tags.import_failed');
        } finally {
            this.busy.set(false);
        }
    }

    async confirmDelete(tag: ITag): Promise<void> {
        const used = tag.usageCount || 0;
        // Label is admin-authored, but it still goes through the same escape as
        // any other value bound into the dialog's HTML.
        const name = escapeHtml(tag.label || '');
        const key = used === 0 ? 'admin.audience.tags.delete_confirm_none'
            : used === 1 ? 'admin.audience.tags.delete_confirm_one'
            : 'admin.audience.tags.delete_confirm';
        const ok = await this.confirm.ask({
            titleKey: 'common.dialog.delete',
            dialogMessage: this.transloco.translate(key, { name, count: used }),
            btnText: this.transloco.translate('common.actions.delete'),
            panelType: 'warn',
        });
        if (!ok) return;
        try {
            await this.audience.deleteTag(tag.id);
            this.notify.success('admin.audience.tags.deleted');
        } catch (e) {
            console.error('Deleting the tag failed', e);
            this.notify.error('admin.audience.tags.delete_failed');
        }
    }
}
