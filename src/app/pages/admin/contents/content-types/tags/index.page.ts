import { RouteMeta } from '@analogjs/router';
import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, signal, ViewChild, Input, computed, effect } from '@angular/core';
import { MatSidenavModule, MatDrawer } from '@angular/material/sidenav';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';

import { TagsStore } from './tags.store';
import { ITag } from './tags.model';
import { ConfirmationPopupComponent } from '../../../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { GlobalTableComponent, TableColumn } from '../../../../../../shared/components/global-table/global-table.component';

import AddTagComponent from './(add-tag)/add.page';
import EditTagComponent from './(edit-tag)/edit.[tagId].page';
import { ViewTagComponent } from './(view-tag)/view.[tagId].page';
import { roleGuard } from '../../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Tags Management | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    selector: 'arc-tags-page',
    standalone: true,
    imports: [
        CommonModule,
        FormsModule,
        MatSidenavModule,
        MatPaginatorModule,
        MatIconModule,
        MatButtonModule,
        MatDialogModule,
        AddTagComponent,
        EditTagComponent,
        ViewTagComponent,
        GlobalTableComponent
    ],
    templateUrl: './index.html',
    styleUrl: './index.scss',
    providers: [DatePipe],
})
export default class TagsPageComponent {
    tagsStore = inject(TagsStore);
    dialog = inject(MatDialog);
    sanitizer = inject(DomSanitizer);
    datePipe = inject(DatePipe);
    route = inject(ActivatedRoute);
    router = inject(Router);

    @ViewChild('drawer') drawer!: MatDrawer;

    // Content type slug received from parent/route
    private _contentTypeSlug = signal<string>('');

    @Input() set contentTypeSlug(value: string) {
        if (value && value !== this._contentTypeSlug()) {
            this._contentTypeSlug.set(value);
            this.tagsStore.setContentTypeSlug(value);
            this.fetchData();
        }
    }
    get contentTypeSlug(): string {
        return this._contentTypeSlug();
    }

    // Content type name for display
    @Input() contentTypeName: string = '';

    // Drawer state
    currentAction = signal<'add' | 'edit' | 'view' | ''>('');
    currentId = signal<string>('');

    // Pagination state
    currentPage = signal<number>(0);
    pageSize = signal<number>(10);

    // Sorting state
    sortField = signal<string>('label');
    sortDirection = signal<'asc' | 'desc'>('asc');

    // Filtering state
    filters = signal<{ [key: string]: string }>({});
    filterableColumns = [
        { field: 'label', label: 'Label' },
    ];

    // Inline tag creation
    newTagLabel = '';

    tableColumns: TableColumn[] = [];

    constructor() {
        effect(() => {
            // Re-fetch when pagination/sorting changes
            this.currentPage();
            this.pageSize();
            this.sortField();
            this.sortDirection();
        });
    }

    ngOnInit(): void {
        // Get content type slug from route params if not set via Input
        this.route.queryParams.subscribe(params => {
            if (params['contentTypeSlug'] && !this._contentTypeSlug()) {
                this._contentTypeSlug.set(params['contentTypeSlug']);
                this.tagsStore.setContentTypeSlug(params['contentTypeSlug']);
                this.contentTypeName = params['contentTypeName'] || params['contentTypeSlug'];
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
                        action: 'view',
                        icon: 'fas fa-eye',
                        label: 'View',
                        onAction: (row) => this.openView(row.id)
                    },
                    {
                        action: 'edit',
                        icon: 'fas fa-pen text-primary',
                        label: 'Edit',
                        onAction: (row) => this.openEdit(row.id)
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

    formatDate(date: Date | any | undefined): string {
        if (!date) return '--';
        try {
            if (date?.seconds) {
                // Firestore Timestamp
                const d = new Date(date.seconds * 1000);
                return this.datePipe.transform(d, 'MMM d, yyyy') || '--';
            } else if (date instanceof Date) {
                return this.datePipe.transform(date, 'MMM d, yyyy') || '--';
            } else if (typeof date === 'string') {
                return this.datePipe.transform(new Date(date), 'MMM d, yyyy') || '--';
            }
        } catch {
            return '--';
        }
        return '--';
    }

    // Drawer actions
    openAdd(): void {
        this.currentAction.set('add');
        this.currentId.set('');
        this.drawer?.open();
    }

    openEdit(id: string): void {
        this.currentAction.set('edit');
        this.currentId.set(id);
        this.drawer?.open();
    }

    openView(id: string): void {
        this.currentAction.set('view');
        this.currentId.set(id);
        this.drawer?.open();
    }

    closeDrawer(): void {
        this.drawer?.close();
        this.currentAction.set('');
        this.currentId.set('');
        this.fetchData(); // Refresh after close
    }

    // Delete with confirmation
    deleteItem(item: ITag): void {
        const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
            `Are you sure you want to delete the tag <strong>"${item.label}"</strong>?`
        );

        const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
            width: '400px',
            data: {
                dialogType: 'Delete',
                dialogMessage: msg,
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

    // Inline quick add
    quickAddTag(): void {
        const label = this.newTagLabel?.trim();
        if (!label) return;

        // Get auto-assigned color
        const { color } = this.tagsStore.addTagWithAutoColor(label);

        const newTag = {
            label,
            color,
            contentTypeSlug: this._contentTypeSlug(),
            usageCount: 0,
        } as ITag;

        this.tagsStore.add(newTag).subscribe({
            next: () => {
                this.newTagLabel = '';
                this.fetchData();
            },
            error: (error) => console.error('Error adding tag:', error),
        });
    }

    // Data fetching
    fetchData(): void {
        const params: any = {
            limit: this.pageSize(),
            orderByField: this.sortField(),
            orderByDirection: this.sortDirection(),
        };

        // Add filters as where conditions
        const filterEntries = Object.entries(this.filters());
        if (filterEntries.length > 0) {
            params.whereConditions = filterEntries.map(([field, value]) => ({
                field,
                operator: '>=',
                value: value,
            }));
        } else {
            params.whereConditions = [];
        }

        this.tagsStore.getAll(params);
        this.tagsStore.updateUsedColors();
    }

    // Pagination
    onPageChange(event: PageEvent): void {
        this.currentPage.set(event.pageIndex);
        this.pageSize.set(event.pageSize);
        this.fetchData();
    }

    // Filtering
    onFilterChange(field: string, event: any): void {
        const value = event.target.value;
        this.filters.update(f => {
            if (value) {
                return { ...f, [field]: value };
            } else {
                const { [field]: _, ...rest } = f;
                return rest;
            }
        });
        this.currentPage.set(0);
        this.fetchData();
    }

    clearFilters(): void {
        this.filters.set({});
        this.currentPage.set(0);
        this.fetchData();
    }

    hasActiveFilters(): boolean {
        return Object.keys(this.filters()).length > 0;
    }

    // Sorting
    setSortField(field: string): void {
        if (this.sortField() === field) {
            this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
        } else {
            this.sortField.set(field);
            this.sortDirection.set('asc');
        }
        this.fetchData();
    }



    // Pagination display helpers
    getStartRecord(): number {
        if (this.tagsStore.totalRecords() === 0) return 0;
        return this.currentPage() * this.pageSize() + 1;
    }

    getEndRecord(): number {
        const end = (this.currentPage() + 1) * this.pageSize();
        return Math.min(end, this.tagsStore.totalRecords());
    }
}
