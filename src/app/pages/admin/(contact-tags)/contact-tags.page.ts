import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatTooltipModule } from '@angular/material/tooltip';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Router } from '@angular/router';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { AudienceService } from '../(audience)/audience.service';
import { ITag } from '../(audience)/audience.model';
import { TagDrawerComponent, TagDrawerMode } from './(tag-drawer)/tag-drawer.component';

export const routeMeta: RouteMeta = {
    title: 'Tags | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatDialogModule,
        MatSidenavModule, MatTooltipModule, GlobalTableComponent, TagDrawerComponent, PageHeaderComponent,
    ],
    templateUrl: './contact-tags.page.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class ContactTagsPageComponent implements OnInit {
    @ViewChild('drawer') drawer!: MatDrawer;

    private audience = inject(AudienceService);
    private toast = inject(ToastService);
    private dialog = inject(MatDialog);
    private sanitizer = inject(DomSanitizer);
    private destroyRef = inject(DestroyRef);
    private router = inject(Router);

    tags = signal<ITag[]>([]);
    loading = signal(true);
    busy = signal(false);

    currentAction = signal<TagDrawerMode | ''>('');
    currentTag = signal<ITag | null>(null);

    columns: TableColumn[] = [
        // `tags` type renders label+colour through Angular bindings, so labels
        // never need hand-escaping into markup.
        {
            key: 'label', header: 'Tag', type: 'tags',
            transformFn: (r) => [r],
            tagConfig: { class: 'tag-label' },
        },
        { key: 'id', header: 'ID', type: 'code', classFn: () => 'small text-muted' },
        {
            key: 'usageCount', header: 'Contacts', type: 'text',
            transformFn: (r) => r.usageCount || 0,
        },
        {
            key: 'actions', header: 'Actions', type: 'actions',
            actions: [
                {
                    action: 'view', icon: 'fas fa-user-group text-primary', label: 'View contacts', class: 'edit',
                    hide: (row) => !row.usageCount, onAction: (row) => this.viewContacts(row),
                },
                {
                    action: 'edit', icon: 'fas fa-pen text-primary', label: 'Edit', class: 'edit',
                    isRowClick: true, onAction: (row) => this.openEdit(row),
                },
                {
                    action: 'delete', icon: 'fas fa-trash text-danger', label: 'Delete', class: 'delete',
                    onAction: (row) => this.confirmDelete(row),
                },
            ],
        },
    ];

    ngOnInit(): void {
        this.audience.getTags().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((tags) => {
            this.tags.set(tags);
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
     * Import per-waitlist tags into the global layer. Idempotent, so it is safe
     * to re-run after new contacts are backfilled.
     */
    async runMigration(): Promise<void> {
        this.busy.set(true);
        try {
            const res: any = await this.audience.migrateTagsToContacts();
            const d = res?.data || {};
            this.toast.success(
                `Imported ${(d.tagsCreated || 0) + (d.tagsMerged || 0)} tags (${d.tagsCreated || 0} new), ` +
                `${d.assignmentsCopied || 0} assignments across ${d.contactsTagged || 0} contacts`,
            );
        } catch (e) {
            console.error(e);
            this.toast.error('Failed to import waitlist tags');
        } finally {
            this.busy.set(false);
        }
    }

    confirmDelete(tag: ITag): void {
        const used = tag.usageCount || 0;
        const warning = used
            ? `<br><br>It is currently on <strong>${used}</strong> contact${used === 1 ? '' : 's'}, and will be removed from them.`
            : '';
        // Label is admin-authored, but it still goes through the same escape as
        // any other value bound into trusted HTML.
        const label = (tag.label || '').replace(/[&<>"']/g, (c) => (
            { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
        ));
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Are you sure you want to delete <strong>${label}</strong>?${warning}`,
        );
        this.dialog.open(ConfirmationPopupComponent, {
            width: '350px',
            data: { dialogType: 'Delete', dialogMessage: msg, btnText: 'Delete', panelType: 'warn' },
        }).afterClosed().subscribe(async (result: boolean) => {
            if (!result) return;
            try {
                await this.audience.deleteTag(tag.id);
                this.toast.success('Tag deleted');
            } catch (e) {
                console.error(e);
                this.toast.error('Failed to delete tag');
            }
        });
    }
}
