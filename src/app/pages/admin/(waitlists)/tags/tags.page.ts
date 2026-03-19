/**
 * Waitlist Tags Management Page
 * 
 * Manages tags for a specific waitlist.
 * Similar to content-type tags management.
 */

import { RouteMeta } from '@analogjs/router';
import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, signal, ViewChild, OnInit } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { ConfirmationPopupComponent } from '../../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { WaitlistUserTagsStore } from '../joined-users/waitlist-user-tags.store';
import { IWaitlistUserTag } from '../joined-users/waitlist-user-tags.model';
import { ConstantVariables } from '../../../../../shared/constants/common-constants';
import { GlobalTableComponent, TableColumn } from '../../../../../shared/components/global-table/global-table.component';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Waitlist Tags | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'arc-waitlist-tags',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatSidenavModule,
        MatPaginatorModule,
        MatIconModule,
        MatButtonModule,
        MatDialogModule,
        GlobalTableComponent
    ],
    templateUrl: './tags.page.html',
    styleUrls: ['./tags.page.scss'],
    providers: [DatePipe],
})
export default class WaitlistTagsComponent implements OnInit {
    @ViewChild('drawer') drawer!: MatDrawer;

    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private dialog = inject(MatDialog);
    private datePipe = inject(DatePipe);

    tagsStore = inject(WaitlistUserTagsStore);
    constantVariables = inject(ConstantVariables);

    // Route params
    waitlistId = '';
    waitlistName = '';

    // Drawer state
    currentAction = signal<'add' | 'edit' | 'view' | null>(null);
    currentId = signal<string>('');

    // Quick add
    newTagLabel = '';

    // Edit state
    editingTag = signal<IWaitlistUserTag | null>(null);
    editLabel = signal('');
    editColor = signal('');
    isSubmitting = signal(false);

    // Pagination
    currentPage = signal(0);
    pageSize = signal(10);

    // Sort
    sortField = signal('label');
    sortOrder = signal<'asc' | 'desc'>('asc');

    // Filters
    filters = signal<Record<string, string>>({});

    // Table Config
    tableColumns: TableColumn[] = [];

    constructor() { }

    ngOnInit(): void {
        this.route.queryParams.subscribe(params => {
            this.waitlistId = params['waitlistId'] || '';
            this.waitlistName = params['waitlistName'] || '';

            if (this.waitlistId) {
                this.tagsStore.setWaitlistId(this.waitlistId);
                this.fetchData();
            }
        });
        this.initColumns();
    }

    initColumns() {
        this.tableColumns = [
            { key: 'index', header: '#', type: 'index' },
            {
                key: 'color',
                header: 'Color',
                type: 'tags',
                transformFn: (row) => [{ color: row.color, label: '' }],
                tagConfig: { class: 'color-badge' }
            },
            {
                key: 'label',
                header: 'Label',
                type: 'tags',
                transformFn: (row) => [row],
                tagConfig: { class: 'tag-label' }
            },
            { key: 'usageCount', header: 'Usage' },
            { key: 'createdAt', header: 'Created', type: 'date', dateFormat: 'MMM d, y' },
            {
                key: 'actions',
                header: 'Actions',
                type: 'actions',
                actions: [
                    {
                        action: 'edit',
                        icon: 'fas fa-pen text-primary',
                        label: 'Edit',
                        onAction: (row) => this.openEdit(row)
                    },
                    {
                        action: 'delete',
                        icon: 'fas fa-trash text-danger',
                        label: 'Delete',
                        onAction: (row) => this.deleteItem(row)
                    }
                ]
            }
        ];
    }

    fetchData(): void {
        this.tagsStore.getAll({
            limitCount: this.pageSize(),
            currentPageNumber: this.currentPage(),
            previousPageNumber: this.currentPage() - 1,
        });
        this.tagsStore.updateUsedColors();
    }

    // Quick add tag
    quickAddTag(): void {
        const label = this.newTagLabel.trim();
        if (!label) return;

        const { color } = this.tagsStore.addTagWithAutoColor(label);

        const newTag = {
            label,
            color,
            waitlistId: this.waitlistId,
            usageCount: 0,
        } as IWaitlistUserTag;

        this.tagsStore.add(newTag).subscribe({
            next: () => {
                this.newTagLabel = '';
                this.fetchData();
            },
            error: (error) => console.error('Error adding tag:', error),
        });
    }

    // Drawer methods
    openEdit(tag: IWaitlistUserTag): void {
        this.editingTag.set(tag);
        this.editLabel.set(tag.label);
        this.editColor.set(tag.color);
        this.currentAction.set('edit');
        this.drawer.open();
    }

    closeDrawer(): void {
        this.drawer.close();
        this.currentAction.set(null);
        this.editingTag.set(null);
        this.fetchData();
    }

    saveEdit(): void {
        const tag = this.editingTag();
        if (!tag) return;

        const label = this.editLabel().trim();
        if (!label) return;

        this.isSubmitting.set(true);
        this.tagsStore.update(tag.id, {
            label,
            color: this.editColor(),
        }).subscribe({
            next: () => {
                this.isSubmitting.set(false);
                this.closeDrawer();
            },
            error: (error) => {
                this.isSubmitting.set(false);
                console.error('Error updating tag:', error);
            },
        });
    }

    selectColor(color: string): void {
        this.editColor.set(color);
    }

    deleteItem(item: IWaitlistUserTag): void {
        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            data: {
                dialogType: 'Delete Tag',
                dialogMessage: `Are you sure you want to delete the tag "<strong>${item.label}</strong>"?`,
                btnText: 'Delete',
                panelType: 'warn',
            },
        });

        dialogRef.afterClosed().subscribe(result => {
            if (result) {
                this.tagsStore.delete(item.id).subscribe({
                    next: () => this.fetchData(),
                    error: (error) => console.error('Error deleting tag:', error),
                });
            }
        });
    }

    // Pagination
    onPageChange(event: PageEvent): void {
        this.currentPage.set(event.pageIndex);
        this.pageSize.set(event.pageSize);
        this.fetchData();
    }

    getStartRecord(): number {
        if (this.tagsStore.totalRecords() === 0) return 0;
        return this.currentPage() * this.pageSize() + 1;
    }

    getEndRecord(): number {
        const end = (this.currentPage() + 1) * this.pageSize();
        return Math.min(end, this.tagsStore.totalRecords());
    }

    // Sorting
    setSortField(field: string): void {
        if (this.sortField() === field) {
            this.sortOrder.set(this.sortOrder() === 'asc' ? 'desc' : 'asc');
        } else {
            this.sortField.set(field);
            this.sortOrder.set('asc');
        }
        this.fetchData();
    }

    // Filters
    onFilterChange(field: string, event: Event): void {
        const value = (event.target as HTMLInputElement).value;
        this.filters.update(f => ({ ...f, [field]: value }));
        this.currentPage.set(0);
        this.fetchData();
    }

    hasActiveFilters(): boolean {
        return Object.values(this.filters()).some(v => v && v.trim());
    }

    clearFilters(): void {
        this.filters.set({});
        this.currentPage.set(0);
        this.fetchData();
    }

    goBack(): void {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        if (returnUrl) {
            this.router.navigateByUrl(returnUrl);
        } else {
            this.router.navigate(['/admin/waitlists']);
        }
    }
}
