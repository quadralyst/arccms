import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, OnInit, signal, ViewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { roleGuard } from '../../../guards/role.guard';
import { ToastService } from '../../../../shared/services/toast.service';
import { GlobalTableComponent, TableColumn } from '../../../../shared/components/global-table/global-table.component';
import { ConfirmationPopupComponent } from '../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { AudienceService } from '../(audience)/audience.service';
import { IList } from '../(audience)/audience.model';
import { ListDrawerComponent, ListDrawerMode } from './(list-drawer)/list-drawer.component';

export const routeMeta: RouteMeta = {
    title: 'Lists | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatDialogModule,
        MatSidenavModule, GlobalTableComponent, ListDrawerComponent,
    ],
    templateUrl: './lists.page.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
})
export default class ListsPageComponent implements OnInit {
    @ViewChild('drawer') drawer!: MatDrawer;

    private audience = inject(AudienceService);
    private toast = inject(ToastService);
    private dialog = inject(MatDialog);
    private sanitizer = inject(DomSanitizer);
    private destroyRef = inject(DestroyRef);

    lists = signal<IList[]>([]);
    loading = signal(true);

    currentAction = signal<ListDrawerMode | ''>('');
    currentList = signal<IList | null>(null);

    columns: TableColumn[] = [
        { key: 'name', header: 'Name', type: 'text', classFn: () => 'fw-medium' },
        { key: 'description', header: 'Description', type: 'text', classFn: () => 'small text-muted', transformFn: (r) => r.description || '—' },
        {
            key: 'type', header: 'Type', type: 'html',
            transformFn: (r) => `<span class="status-badge ${r.type === 'system' ? 'is-info' : 'is-neutral'}">${r.type}</span>`,
        },
        { key: 'memberCount', header: 'Members', type: 'text', transformFn: (r) => r.memberCount || 0 },
        {
            key: 'actions', header: 'Actions', type: 'actions',
            actions: [
                {
                    action: 'edit', icon: 'fas fa-pen text-primary', label: 'Edit', class: 'edit',
                    isRowClick: true, hide: (row) => row.type === 'system', onAction: (row) => this.openEdit(row),
                },
                {
                    action: 'delete', icon: 'fas fa-trash text-danger', label: 'Delete', class: 'delete',
                    hide: (row) => row.type === 'system', onAction: (row) => this.confirmDelete(row),
                },
            ],
        },
    ];

    ngOnInit(): void {
        this.audience.getLists().pipe(takeUntilDestroyed(this.destroyRef)).subscribe((lists) => {
            this.lists.set(lists);
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

    closeDrawer(): void {
        this.drawer?.close();
        this.currentAction.set('');
        this.currentList.set(null);
    }

    confirmDelete(list: IList): void {
        if (list.type === 'system') {
            this.toast.error('System lists cannot be deleted');
            return;
        }
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Are you sure you want to delete <strong>${list.name}</strong>?`,
        );
        this.dialog.open(ConfirmationPopupComponent, {
            width: '350px',
            data: { dialogType: 'Delete', dialogMessage: msg, btnText: 'Delete', panelType: 'warn' },
        }).afterClosed().subscribe(async (result: boolean) => {
            if (!result) return;
            try {
                await this.audience.deleteList(list.id);
                this.toast.success('List deleted');
            } catch (e) {
                console.error(e);
                this.toast.error('Failed to delete list');
            }
        });
    }
}
