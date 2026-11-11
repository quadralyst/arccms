/**
 * Form tags page
 *
 * The tags of one form, which label its sign-ups.
 */

import { RouteMeta } from '@analogjs/router';
import { CommonModule, DatePipe } from '@angular/common';
import { Component, Injector, inject, runInInjectionContext, signal, ViewChild, OnInit } from '@angular/core';
import { Firestore, collection, getCountFromServer, query, where } from '@angular/fire/firestore';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ActivatedRoute, Router } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { MatDrawer, MatSidenavModule } from '@angular/material/sidenav';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { followLandedPage } from '../../../../../shared/services/generic-store.service';
import { ConfirmService } from '../../../../../shared/components/confirmation-popup/confirm.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { escapeHtml } from '../../../../../shared/utils/escape-html';
import { WaitlistUserTagsStore } from '../joined-users/waitlist-user-tags.store';
import { IWaitlistUserTag } from '../joined-users/waitlist-user-tags.model';
import { ConstantVariables } from '../../../../../shared/constants/common-constants';
import { GlobalTableComponent, TableColumn } from '../../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../../shared/components/page-header/page-header.component';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
    title: 'Form tags',
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
        GlobalTableComponent,
        PageHeaderComponent,
        TranslocoPipe
    ],
    templateUrl: './tags.page.html',
    styleUrls: ['./tags.page.scss'],
    providers: [DatePipe],
})
export default class WaitlistTagsComponent implements OnInit {
    @ViewChild('drawer') drawer!: MatDrawer;

    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private firestore = inject(Firestore);
    private injector = inject(Injector);
    private confirmDialog = inject(ConfirmService);
    private notify = inject(NotifyService);
    private transloco = inject(TranslocoService);
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

    constructor() {
        followLandedPage(this.tagsStore.currentPageNumber, this.currentPage);
    }

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
                header: 'admin.forms.tags.col.color',
                type: 'tags',
                transformFn: (row) => [{ color: row.color, label: '' }],
                tagConfig: { class: 'color-badge' }
            },
            {
                key: 'label',
                header: 'admin.forms.tags.col.tag',
                type: 'tags',
                transformFn: (row) => [row],
                tagConfig: { class: 'tag-label' }
            },
            { key: 'usageCount', header: 'admin.forms.tags.col.used' },
            { key: 'createdAt', header: 'admin.forms.tags.col.created', type: 'date', dateFormat: 'MMM d, y' },
            {
                key: 'actions',
                header: 'common.table.actions',
                type: 'actions',
                actions: [
                    {
                        action: 'edit',
                        icon: 'fas fa-pen text-primary',
                        label: 'common.actions.edit',
                        onAction: (row) => this.openEdit(row)
                    },
                    {
                        action: 'delete',
                        icon: 'fas fa-trash text-danger',
                        label: 'common.actions.delete',
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
            error: (error) => {
                console.error('Adding a tag failed:', error);
                this.notify.error('admin.forms.tags.add_failed');
                this.fetchData();
            },
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
                console.error('Saving a tag failed:', error);
                this.notify.error('admin.forms.tags.save_failed');
                this.fetchData();
            },
        });
    }

    selectColor(color: string): void {
        this.editColor.set(color);
    }

    /** How many of this form's sign-ups have the tag; null when the count cannot be read. */
    async signupsWithTag(tagId: string): Promise<number | null> {
        if (!this.waitlistId) return null;
        try {
            const signups = runInInjectionContext(this.injector, () =>
                query(collection(this.firestore, 'Waitlists', this.waitlistId, 'users'), where('tags', 'array-contains', tagId)));
            const snap = await runInInjectionContext(this.injector, () => getCountFromServer(signups));
            return snap.data().count;
        } catch (error) {
            console.error('Counting the sign-ups with a tag failed:', error);
            return null;
        }
    }

    /** Delete a tag, saying first how many sign-ups lose it. */
    async deleteItem(item: IWaitlistUserTag): Promise<void> {
        const count = await this.signupsWithTag(item.id);
        const key = count === null ? 'admin.forms.tag_delete_confirm_unknown'
            : count === 0 ? 'admin.forms.tag_delete_confirm_none'
                : count === 1 ? 'admin.forms.tag_delete_confirm_one'
                    : 'admin.forms.tag_delete_confirm';
        const confirmed = await this.confirmDialog.ask({
            titleKey: 'common.dialog.delete',
            dialogMessage: this.transloco.translate(key, { name: escapeHtml(item.label), count }),
            btnText: this.transloco.translate('common.actions.delete'),
            panelType: 'warn',
        });
        if (!confirmed) return;

        this.tagsStore.delete(item.id).subscribe({
            next: () => this.fetchData(),
            error: (error) => {
                console.error('Error deleting tag:', error);
                this.notify.error('admin.forms.tag_delete_failed');
                // Reading the list again clears the store's error, so the table
                // shows "did not load" only when the list itself failed.
                this.fetchData();
            },
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
