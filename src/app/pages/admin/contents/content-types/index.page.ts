import { RouteMeta } from '@analogjs/router';
import { CommonModule, DatePipe } from '@angular/common';
import { Component, inject, signal, ViewChild, TemplateRef } from '@angular/core';
import { MatSidenavModule, MatDrawer } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDialog } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { ContentTypesStore } from './content-types.store';
import { ContentType } from './content-types.model';
import { ToastService } from '../../../../../shared/services/toast.service';
import AddContentTypeComponent from './(add-content-type)/add.page';
import EditContentTypeComponent from './(edit-content-type)/edit.[contentTypeId].page';
import { ViewContentTypeComponent } from './(view-content-type)/view.[contentTypeId].page';
import { ConfirmationPopupComponent } from '../../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { GlobalTableComponent, TableColumn } from '../../../../../shared/components/global-table/global-table.component';
import { PageHeaderComponent } from '../../../../../shared/components/page-header/page-header.component';
import { roleGuard } from '../../../../guards/role.guard';

export const routeMeta: RouteMeta = {
  title: 'Content Types | Arc CMS',
  canActivate: [roleGuard],
  data: { allowedRoles: ['admin'] },
};

@Component({
  selector: 'arc-content-types',
  standalone: true,
  imports: [
    CommonModule,
    MatSidenavModule,
    MatIconModule,
    MatButtonModule,
    MatPaginatorModule,
    AddContentTypeComponent,
    EditContentTypeComponent,
    ViewContentTypeComponent,
    GlobalTableComponent,
    PageHeaderComponent
  ],
  providers: [DatePipe],
  templateUrl: './content-types.html',
  styleUrl: './content-types.scss',
})
export default class ContentTypeComponent {
  contentTypesStore = inject(ContentTypesStore);
  dialog = inject(MatDialog);
  sanitizer = inject(DomSanitizer);
  datePipe = inject(DatePipe);
  route = inject(ActivatedRoute);
  router = inject(Router);
  toastService = inject(ToastService);
  @ViewChild('drawer') drawer!: MatDrawer;

  currentAction = signal<'add' | 'edit' | 'view' | ''>('');
  currentId = signal<string>('');
  sortField = signal<string>('name');
  sortOrder = signal<'asc' | 'desc'>('asc');

  // Pagination
  pageSize = signal<number>(10);
  currentPage = signal<number>(0);

  // Filters
  filters = signal<{ [key: string]: string }>({});
  filterableColumns = [
    { label: 'Name', field: 'name' },
    { label: 'Slug', field: 'slug' }
  ];

  // Table Config
  tableColumns: TableColumn[] = [];


  constructor() {
  }

  ngOnInit(): void {
    this.initColumns();

    // Read all parameters from URL
    this.route.queryParams.subscribe(params => {
      const sortField = params['sort'] || 'name';
      const sortOrder = (params['order'] || 'asc') as 'asc' | 'desc';
      const page = parseInt(params['page'] || '0', 10);
      const size = parseInt(params['size'] || '10', 10);

      // Read filters
      const filters: { [key: string]: string } = {};
      this.filterableColumns.forEach(col => {
        const filterValue = params[`filter_${col.field}`];
        if (filterValue) {
          filters[col.field] = filterValue;
        }
      });

      // Update signals
      this.sortField.set(sortField);
      this.sortOrder.set(sortOrder);
      this.currentPage.set(page);
      this.pageSize.set(size);
      this.filters.set(filters);

      // Fetch data
      this.fetchData();
    });
  }

  formatDate(date: Date | any | undefined): string {
    if (!date) return '--';

    try {
      // Handle Firestore Timestamp - try multiple ways
      if (date && typeof date === 'object') {
        // Check for toDate method (Firestore Timestamp)
        if (typeof date.toDate === 'function') {
          date = date.toDate();
        }
        // Check for seconds property (Firestore Timestamp has {seconds, nanoseconds})
        else if ('seconds' in date && typeof date.seconds === 'number') {
          date = new Date(date.seconds * 1000);
        }
      }

      // Now try to format with MMM dd, yyyy format
      const result = this.datePipe.transform(date, 'MMM dd, yyyy');
      return result || '--';
    } catch (error) {
      console.error('[formatDate] Error formatting date:', error, 'Input was:', date);
      return '--';
    }
  }

  openAdd() {
    this.currentAction.set('add');
    this.currentId.set('');
    this.drawer.open();
  }

  openEdit(id: string) {
    this.currentAction.set('edit');
    this.currentId.set(id);
    this.drawer.open();
  }

  openView(id: string) {
    this.currentAction.set('view');
    this.currentId.set(id);
    this.drawer.open();
  }

  deleteItem(item: ContentType) {
    const msg = this.sanitizer.bypassSecurityTrustHtml(`Are you sure you want to delete "${item.name}"?`);
    const dialogRef = this.dialog.open(ConfirmationPopupComponent, {
      width: '350px',
      data: {
        dialogType: 'Delete',
        dialogMessage: msg,
        btnText: 'Delete',
        panelType: 'warn',
      },
    });
    dialogRef.afterClosed().subscribe((result: any) => {
      if (result) {
        this.contentTypesStore.delete(item.id!).subscribe({
          next: () => {
            this.toastService.success('Content type deleted successfully.');
          },
          error: (error) => {
            console.error('Error deleting content type:', error);
            this.toastService.error('Failed to delete content type. Please try again.');
          },
        });
      }
    });
  }

  /**
   * Open tags management for a content type
   */
  openTags(item: ContentType): void {
    this.router.navigate(['/admin/contents/content-types/tags'], {
      queryParams: {
        contentTypeSlug: item.slug,
        contentTypeName: item.name
      }
    });
  }

  closeDrawer() {
    this.drawer.close();
    this.currentAction.set('');
    this.currentId.set('');
  }

  /**
   * Fetch data with current filter, sort, and pagination settings
   */
  private fetchData(): void {
    // Convert filters to Firestore where conditions
    const whereConditions: any[] = [];
    Object.entries(this.filters()).forEach(([field, value]) => {
      if (value && value.trim()) {
        // Firestore prefix matching
        whereConditions.push({
          field,
          operator: '>=',
          value: value.trim()
        });
        whereConditions.push({
          field,
          operator: '<=',
          value: value.trim() + '\uf8ff'
        });
      }
    });

    this.contentTypesStore.getAll({
      orderByField: this.sortField(),
      orderByDirection: this.sortOrder(),
      limitCount: this.pageSize(),
      currentPageNumber: this.currentPage(),
      previousPageNumber: this.currentPage() - 1,
      whereConditions
    });
  }

  /**
   * Update URL with current state
   */
  private updateUrl(): void {
    const queryParams: any = {
      sort: this.sortField(),
      order: this.sortOrder(),
      page: this.currentPage(),
      size: this.pageSize()
    };

    // Add filter params
    Object.entries(this.filters()).forEach(([field, value]) => {
      if (value) {
        queryParams[`filter_${field}`] = value;
      }
    });

    this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      queryParamsHandling: 'merge'
    });
  }

  /**
   * Handle pagination change events
   */
  onPageChange(event: PageEvent): void {
    this.currentPage.set(event.pageIndex);
    this.pageSize.set(event.pageSize);
    this.updateUrl();
  }

  /**
   * Handle filter input changes
   */
  onFilterChange(field: string, event: any): void {
    const value = event.target.value;
    const currentFilters = { ...this.filters() };

    if (value) {
      currentFilters[field] = value;
    } else {
      delete currentFilters[field];
    }

    this.filters.set(currentFilters);
    this.currentPage.set(0); // Reset to first page on filter change
    this.updateUrl();
  }

  /**
   * Clear all filters
   */
  clearFilters(): void {
    this.filters.set({});
    this.currentPage.set(0);
    this.updateUrl();
  }

  /**
   * Check if any filters are active
   */
  hasActiveFilters(): boolean {
    return Object.keys(this.filters()).length > 0;
  }

  /**
   * Get starting record number for display
   */
  getStartRecord(): number {
    const total = this.contentTypesStore.totalRecords();
    if (total === 0) return 0;
    return this.currentPage() * this.pageSize() + 1;
  }

  /**
   * Get ending record number for display
   */
  getEndRecord(): number {
    const total = this.contentTypesStore.totalRecords();
    const end = (this.currentPage() + 1) * this.pageSize();
    return Math.min(end, total);
  }

  /**
   * Set sort field and update URL parameters
   */
  setSortField(field: string): void {
    let newOrder: 'asc' | 'desc' = 'asc';

    // If clicking the same field, toggle the order
    if (this.sortField() === field) {
      newOrder = this.sortOrder() === 'asc' ? 'desc' : 'asc';
    }

    this.sortField.set(field);
    this.sortOrder.set(newOrder);

    this.updateUrl();
  }

  private initColumns() {
    this.tableColumns = [
      {
        key: 'index',
        header: '#',
        type: 'index'
      },
      {
        key: 'name',
        header: 'Name',
        type: 'text',
        sortable: true
      },
      {
        key: 'slug',
        header: 'Slug',
        type: 'text',
        sortable: true
      },
      {
        key: 'fields',
        header: 'Fields',
        transformFn: (row: ContentType) => (row.fields && row.fields.length || 0) + ' field(s)'
      },
      {
        key: 'hasPublicUrl',
        header: 'Public Pages',
        type: 'html',
        transformFn: (row: ContentType) => row.hasPublicUrl !== false
          ? '<span class="badge bg-success-subtle text-success"><i class="fas fa-globe me-1"></i>Yes</span>'
          : '<span class="badge bg-secondary-subtle text-secondary"><i class="fas fa-lock me-1"></i>No</span>'
      },
      {
        key: 'modifiedAt',
        header: 'Last Updated',
        sortable: true,
        transformFn: (row: ContentType) => this.formatDate(row.modifiedAt)
      },
      {
        key: 'actions',
        header: 'Actions',
        type: 'actions',
        actions: [
          {
            action: 'view',
            icon: 'fas fa-eye text-secondary',
            label: 'View',
            class: 'view',
            onAction: (row) => this.openView(row.id)
          },
          {
            action: 'edit',
            icon: 'fas fa-pen text-primary',
            label: 'Edit',
            class: 'edit',
            onAction: (row) => this.openEdit(row.id)
          },
          {
            action: 'tags',
            icon: 'fas fa-tags text-warning',
            label: 'Manage Tags',
            class: 'edit',
            onAction: (row) => this.openTags(row)
          },
          {
            action: 'delete',
            icon: 'fas fa-trash text-danger',
            label: 'Delete',
            class: 'delete',
            onAction: (row) => this.deleteItem(row)
          }
        ]
      }
    ];
  }



  /**
   * Get sort icon for a column header
   */
  getSortIcon(field: string): string {
    if (this.sortField() !== field) {
      return 'unfold_more'; // Neutral icon when not sorted by this field
    }
    return this.sortOrder() === 'asc' ? 'arrow_upward' : 'arrow_downward';
  }

  /**
   * Check if a field is currently being sorted
   */
  isSortedBy(field: string): boolean {
    return this.sortField() === field;
  }
}
