import { CommonModule, DatePipe, LowerCasePipe } from '@angular/common';
import {
  Component,
  computed,
  effect,
  inject,
  Input,
  OnChanges,
  OnInit,
  signal,
  SimpleChanges,
  ViewChild,
  TemplateRef,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { ContentsStore } from '../content-store/published-contents.store';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';
import { ContentTypesStore } from '../content-types/content-types.store';
import { ContentTypesService } from '../content-types/content-types.service';
import { ContentType } from '../content-types/content-types.model';
import { ConfirmationPopupComponent } from '../../../../../shared/components/confirmation-popup/confirmation-popup.component';
import {
  GlobalTableComponent,
  TableColumn,
} from '../../../../../shared/components/global-table/global-table.component';
import { BulkImportDialogComponent } from '../bulk-import/bulk-import-dialog.component';
import { PageHeaderComponent } from '../../../../../shared/components/page-header/page-header.component';

import { PreviewContentComponent } from './preview-content/preview-content.component';
import { PublishQueueService } from '../publish-queue/publish-queue.service';

@Component({
  selector: 'arc-draft-contents-table',
  standalone: true,
  imports: [
    MatIconModule,
    MatButtonModule,
    MatSidenavModule,
    MatPaginatorModule,
    MatDialogModule,
    MatMenuModule,
    MatCheckboxModule,
    CommonModule,
    FormsModule,
    RouterLink,
    GlobalTableComponent,
    PreviewContentComponent,
    PageHeaderComponent
  ],
  providers: [DatePipe],
  templateUrl: './draft-contents-table.component.html',
  styleUrl: './draft-contents-table.component.scss',
})
export class DraftContentsTableComponent
  extends BaseComponent
  implements OnInit, OnChanges
{
  public draftContentStore = inject(DraftContentsStore);
  public contentsStore = inject(ContentsStore);
  public contentTypesStore = inject(ContentTypesStore);
  private contentTypesService = inject(ContentTypesService);
  private publishQueueService = inject(PublishQueueService);
  private datePipe = inject(DatePipe);
  private route = inject(ActivatedRoute);

  historyOpened: any;
  modifiedData: any[] = [];

  // Input for content type slug from parent route
  @Input() contentTypeSlug: string = '';

  // Sorting signals
  sortField = signal<string>('modifiedAt');
  sortOrder = signal<'asc' | 'desc'>('desc');

  // Pagination signals
  pageSizeSignal = signal<number>(10);
  currentPageNum = signal<number>(0);

  // Filters
  filters = signal<{ [key: string]: string }>({});
  statusFilter = signal<string>(''); // '', 'published', 'draft'
  filterableColumns = [{ label: 'Title', field: 'title' }];
  
  // Preview
  previewItem = signal<any>(null);

  private dialogService = inject(MatDialog);

  // Get the content type name from the slug (fallback for compatibility)
  getContentTypeName(): string {
    if (!this.contentTypeSlug) return 'Contents';
    const contentTypes = this.contentTypesStore.items();
    const found = contentTypes.find(
      (ct: ContentType) => ct.slug === this.contentTypeSlug,
    );
    return found ? found.name : this.formatSlugAsName(this.contentTypeSlug);
  }

  // Get the singular name for the content type (e.g., "Article")
  getContentTypeSingularName(): string {
    if (!this.contentTypeSlug) return 'Content';
    const contentTypes = this.contentTypesStore.items();
    const found = contentTypes.find(
      (ct: ContentType) => ct.slug === this.contentTypeSlug,
    );
    if (found) {
      return (
        found.singularName ||
        found.name ||
        this.formatSlugAsName(this.contentTypeSlug)
      );
    }
    return this.formatSlugAsName(this.contentTypeSlug);
  }

  // Get the plural name for the content type (e.g., "Articles") - uses 'name' field
  getContentTypePluralName(): string {
    if (!this.contentTypeSlug) return 'Contents';
    const contentTypes = this.contentTypesStore.items();
    const found = contentTypes.find(
      (ct: ContentType) => ct.slug === this.contentTypeSlug,
    );
    if (found) {
      return found.name || this.formatSlugAsName(this.contentTypeSlug);
    }
    return this.formatSlugAsName(this.contentTypeSlug);
  }
  
  currentContentType = computed(() => {
    if (!this.contentTypeSlug) return null;
    return this.contentTypesStore.items().find(ct => ct.slug === this.contentTypeSlug) || null;
  });

  // Check if the content type slug is valid
  isValidSlug = computed(() => {
    if (!this.contentTypeSlug) return true; // No slug means all contents
    const contentTypes = this.contentTypesStore.items();
    const isLoading = this.contentTypesStore.isLoading();

    // If still loading OR empty (might not have started loading), assume valid
    // Only show error when we have loaded content types and slug doesn't match
    if (isLoading || contentTypes.length === 0) {
      return true; // Assume valid while loading or empty
    }

    // Content types loaded, check if slug exists
    return contentTypes.some(
      (ct: ContentType) => ct.slug === this.contentTypeSlug,
    );
  });

  // Get error message for invalid slug
  invalidSlugMessage = computed(() => {
    if (this.isValidSlug()) return '';
    return `Content type "${this.contentTypeSlug}" does not exist. Please check the URL or create this content type first.`;
  });

  // Format slug as title case
  private formatSlugAsName(slug: string): string {
    if (!slug) return '';
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  }

  // Filter contents by content type and status (client-side).
  // Status filtering is done client-side to avoid requiring per-collection
  // composite Firestore indexes (publishedStatus + modifiedAt) for every
  // dynamically-created content type collection.
  public draftContentsData = computed(() => {
    let items = this.draftContentStore.items() || [];
    if (this.contentTypeSlug) {
      items = items.filter((item: any) => item.type === this.contentTypeSlug);
    }

    // Apply status filter client-side
    const status = this.statusFilter();
    if (status === 'published') {
      items = items.filter((item: any) => item.publishedStatus === true);
    } else if (status === 'draft') {
      items = items.filter((item: any) => !item.publishedStatus);
    }

    return items;
  });

  /**
   * Total records count that reflects client-side status filtering.
   * When a status filter is active, the count is the filtered data length;
   * otherwise it falls through to the store's server-side count.
   */
  public filteredTotalRecords = computed(() => {
    if (this.statusFilter()) {
      return this.draftContentsData().length;
    }
    return this.draftContentStore.totalRecords();
  });

  searchTerm = signal<string>('');

  // Table Config
  tableColumns: TableColumn[] = [];
  
  // Column Selection State
  visibleColumnKeys = signal<string[]>([]);
  availableColumns = signal<{ key: string; label: string; checked: boolean }[]>([]);
  isSavingColumns = signal<boolean>(false);

  // Define base columns that are always present
  baseColumns: TableColumn[] = [
    {
      key: 'title',
      header: 'Title',
      clickable: true,
      classFn: () => 'text-primary fw-bold cursor-pointer',
    },
  ];

  // Define standard end columns
  endColumns: TableColumn[] = [
    {
      key: 'publishedStatus',
      header: 'Status',
      type: 'badge',
      badgeConfig: {
        trueText: 'Published',
        falseText: 'Draft',
        trueClass: 'active',
        falseClass: 'inactive',
      },
    },
    {
      key: 'modifiedAt',
      header: 'Last Updated',
      type: 'date',
      sortable: true,
    },
    {
      key: 'actions',
      header: 'Actions',
      type: 'actions',
      sortable: false,
      actions: [
        {
          action: 'preview',
          icon: 'fa-solid fa-eye text-muted',
          label: 'Preview',
          class: 'preview',
          onAction: (row) => this.previewItem.set(row),
        },
        {
          action: 'edit',
          icon: 'fa-solid fa-pen text-primary',
          label: 'Edit',
          class: 'edit',
          isRowClick: true,
          onAction: (row) => this.openContent(row.id),
        },
        {
          action: 'unpublish',
          icon: 'fa-solid fa-eye-slash text-warning',
          label: 'Unpublish',
          class: 'edit',
          hide: (row) => !row.publishedStatus,
          onAction: (row) => this.confirmUnpublishContent(row.id),
        },
        {
          action: 'history',
          icon: 'fa-solid fa-clock-rotate-left text-info',
          label: 'View History',
          class: 'edit',
          hide: (row) => !row.publishedStatus,
          onAction: (row) => this.openPublishHistory(row),
        },
        {
          action: 'delete',
          icon: 'fa-solid fa-trash text-danger',
          label: 'Delete',
          class: 'delete',
          onAction: (row) => this.deleteItem(row),
        },
      ],
    },
  ];

    constructor() {
    super();

    effect(() => {
      // Ensure Content Types are loaded
      const types = this.contentTypesStore.items();
      const isLoading = this.contentTypesStore.isLoading();
      // If we have no types and aren't loading, we probably need to fetch them
      // This handles the hard refresh case where the store is empty
      if (types.length === 0 && !isLoading && !this.contentTypesStore.isSuccess()) {
        // We use the service directly or trigger the store.
        // Since generic store has getAll, we can try that:
        this.contentTypesStore.getAll();
      }

      // Update columns whenever content type or slug changes
      this.updateDynamicColumns();

      this.draftContentsData();
      this.updatePaginationMessage(this.draftContentsData().length);
    }, { allowSignalWrites: true });
  }

  ngOnInit(): void {
    // Initial data fetch
    this.fetchData();
  }

  onCellClick(event: { key: string, row: any }) {
    if (event.key === 'title') {
      this.openContent(event.row.id);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['contentTypeSlug']) {
      // Reset pagination when switching content types
      this.currentPageNum.set(0);
      this.filters.set({});
      // Re-fetch data for the new content type (or initial type)
      this.fetchData();
    }
  }

  /**
   * Update table columns based on the current content type
   */
  /**
   * Update table columns based on the current content type
   */
  updateDynamicColumns() {
    if (!this.contentTypeSlug) {
      this.tableColumns = [...this.baseColumns, ...this.endColumns];
      return;
    }

    const contentTypes = this.contentTypesStore.items();
    const currentType = contentTypes.find(
      (ct) => ct.slug === this.contentTypeSlug,
    );

    if (!currentType || !currentType.fields) {
      this.tableColumns = [...this.baseColumns, ...this.endColumns];
      return;
    }

    // 1. Identify all potential columns (excluding Title and Actions which are fixed)
    const potentialColumns: { key: string; label: string }[] = [];

    // Custom Fields
    currentType.fields.forEach(field => {
      potentialColumns.push({ key: field.key, label: field.label });
    });

    // Standard End Columns (excluding Actions)
    this.endColumns.forEach(col => {
      if (col.key !== 'actions') {
        potentialColumns.push({ key: col.key, label: col.header });
      }
    });

    // 2. Initialize visible columns if not set
    // If we haven't loaded preferences for this type yet, load from ContentType
    // We use a small heuristic: if visibleColumnKeys is empty OR we switched types, reload.
    // Since we can't easily track "switched types" inside this method without extra state,
    // we rely on the effect that calls this.
    // However, to ensure we don't overwrite user's temporary toggles, we need to be careful.
    // For simplicity, we sync with ContentType.listColumns whenever content type changes.
    // BUT this method is called in an effect.

    // Let's compute the desired columns based on preference or default
    let targetKeys: string[] = [];

    // Check if we have a persisted preference matching the current type
    if (currentType.listColumns && currentType.listColumns.length > 0) {
      targetKeys = currentType.listColumns;
    } else {
      // Default: All potential columns
      targetKeys = potentialColumns.map(c => c.key);
    }

    // Update signal only if it's empty (first load) or we assume logic elsewhere resets it.
    // Actually, creating a separate "initColumnsState" method might be cleaner,
    // but we can do it here by checking if the available columns don't match the current type.
    
    // We update availableColumns signal
    const availCols = potentialColumns.map(col => ({
      key: col.key,
      label: col.label,
      checked: this.visibleColumnKeys().includes(col.key)
    }));
    
    // Force update visibleColumnKeys if it looks like we are on a new type (mismatch)
    // or if it is empty.
    const currentVisible = this.visibleColumnKeys();
    const isMismatch = currentVisible.length > 0 && !potentialColumns.find(c => c.key === currentVisible[0]) && !this.endColumns.find(c => c.key === currentVisible[0]);
    
    if (this.visibleColumnKeys().length === 0 || isMismatch) {
       this.visibleColumnKeys.set(targetKeys);
       // Re-map checked status
       availCols.forEach(c => c.checked = targetKeys.includes(c.key));
    }
    this.availableColumns.set(availCols);

    // 3. Filter and Build Table Columns
    const activeKeys = this.visibleColumnKeys();
    
    // Generate Custom Columns definitions
    const customColumnDefs: TableColumn[] = currentType.fields.map((field) => {
      return {
        key: field.key,
        header: field.label,
        type: 'text',
        transformFn: (row: any) => {
          // 1. Handle Collection References
          if (field.useCollectionRef && field.collectionRef) {
            const refKey = `_ref_${field.key}`;
            const refData = row.customFields?.[refKey];
            const displayField = field.collectionRef.displayField || 'title';

            if (Array.isArray(refData)) {
              return refData
                .map((item: any) => item[displayField] || item.id)
                .join(', ');
            } else if (refData && typeof refData === 'object') {
              return refData[displayField] || refData.id || '';
            }
            return ''; 
          }

          // 2. Handle Standard Fields
          if (row.customFields && row.customFields[field.key] !== undefined) {
            return row.customFields[field.key];
          }
          return '';
        },
      };
    });

    // Combine all
    const allMiddleAndEnd = [...customColumnDefs, ...this.endColumns];
    const filteredMiddleAndEnd = allMiddleAndEnd.filter(col => {
       if (col.key === 'actions') return true; // Always show actions
       return activeKeys.includes(col.key);
    });

    this.tableColumns = [
      ...this.baseColumns, // Always Title
      ...filteredMiddleAndEnd
    ];
  }

  toggleColumn(key: string) {
    const currentKeys = this.visibleColumnKeys();
    let newKeys: string[];
    
    if (currentKeys.includes(key)) {
      newKeys = currentKeys.filter(k => k !== key);
    } else {
      newKeys = [...currentKeys, key];
    }
    
    this.visibleColumnKeys.set(newKeys);
    this.updateDynamicColumns();
    this.saveColumnPreferences(newKeys);
  }

  saveColumnPreferences(newKeys: string[]) {
    if (!this.contentTypeSlug) return;
    const contentTypes = this.contentTypesStore.items();
    const currentType = contentTypes.find(ct => ct.slug === this.contentTypeSlug);
    
    if (currentType) {
      this.isSavingColumns.set(true);
      this.contentTypesService.update(currentType.id, {
        listColumns: newKeys
      }).subscribe({
        next: () => {
          // Silent success or maybe a small indicator?
          // this.toastService.success('View saved.');
          this.isSavingColumns.set(false);
        },
        error: (err) => {
          console.error('Error saving column preferences:', err);
          this.toastService.error('Failed to save view preferences.');
          this.isSavingColumns.set(false);
        }
      });
    }
  }

  resetColumnPreferences() {
    // Reset to showing all columns
    const allKeys = this.availableColumns().map(c => c.key);
    this.visibleColumnKeys.set(allKeys);
    this.updateDynamicColumns();
    this.saveColumnPreferences(allKeys);
  }

  /**
   * Fetch data with current filter, sort, and pagination settings
   */
  private fetchData(): void {
    // Convert filters to Firestore where conditions
    const whereConditions: any[] = [];

    // When contentTypeSlug is set, we query the per-type collection directly
    // (no need for a type WHERE filter — the collection itself is type-specific).
    // When contentTypeSlug is empty, fall back to the legacy collection with no type filter.

    // Status filter (publishedStatus) is applied client-side in draftContentsData()
    // to avoid requiring composite Firestore indexes for every content type collection.

    // Add text filters (prefix matching)
    Object.entries(this.filters()).forEach(([field, value]) => {
      if (value && value.trim()) {
        whereConditions.push({
          field,
          operator: '>=',
          value: value.trim(),
        });
        whereConditions.push({
          field,
          operator: '<=',
          value: value.trim() + '\uf8ff',
        });
      }
    });

    this.draftContentStore.getAll({
      orderByField: this.sortField(),
      orderByDirection: this.sortOrder(),
      limitCount: this.pageSizeSignal(),
      currentPageNumber: this.currentPageNum(),
      previousPageNumber: this.currentPageNum() - 1,
      whereConditions,
    }, this.contentTypeSlug || undefined);
  }

  /**
   * Update URL with current state
   */
  private updateUrl(): void {
    const queryParams: any = {
      sort: this.sortField(),
      order: this.sortOrder(),
      page: this.currentPageNum(),
      size: this.pageSizeSignal(),
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
      queryParamsHandling: 'merge',
    });
  }

  /**
   * Handle pagination change events
   */
  onPageChange(event: PageEvent): void {
    this.currentPageNum.set(event.pageIndex);
    this.pageSizeSignal.set(event.pageSize);
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
    this.currentPageNum.set(0); // Reset to first page on filter change
    this.updateUrl();
  }

  /**
   * Clear all filters
   */
  clearFilters(): void {
    this.filters.set({});
    this.statusFilter.set('');
    this.currentPageNum.set(0);
    this.updateUrl();
    this.fetchData();
  }

  /**
   * Check if any filters are active
   */
  hasActiveFilters(): boolean {
    return Object.keys(this.filters()).length > 0 || this.statusFilter() !== '';
  }

  /**
   * Handle status filter change
   */
  onStatusFilterChange(event: any): void {
    const value = event.target.value;
    this.statusFilter.set(value);
    this.currentPageNum.set(0); // Reset to first page on filter change
    this.fetchData();
  }

  /**
   * Get starting record number for display
   */
  getStartRecord(): number {
    const total = this.filteredTotalRecords();
    if (total === 0) return 0;
    return this.currentPageNum() * this.pageSizeSignal() + 1;
  }

  /**
   * Get ending record number for display
   */
  getEndRecord(): number {
    const total = this.filteredTotalRecords();
    const end = (this.currentPageNum() + 1) * this.pageSizeSignal();
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

  /**
   * Format date consistently (handles Firestore timestamps)
   */
  override formatDate(date: Date | any | undefined): string {
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
      console.error(
        '[formatDate] Error formatting date:',
        error,
        'Input was:',
        date,
      );
      return '--';
    }
  }

  public deleteItem(item: any) {
    const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
      `Are you sure you want to remove "${item.title}"?`,
    );
    const dialogRef = this.dialogService.open(ConfirmationPopupComponent, {
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
        this.draftContentStore.delete(item.id, this.contentTypeSlug || undefined).subscribe({
          next: () => {
            // If the item was published, enqueue delete to remove from published collection
            if (item.publishedStatus || item.status === this.constantVariables.PUBLISH) {
              this.publishQueueService.enqueue('delete', this.contentTypeSlug, item.id);
            }
            this.toastService.success('Content deleted successfully.');
          },
          error: (error) => {
            console.error('Error deleting content:', error);
            this.toastService.error(
              'Failed to delete content. Please try again.',
            );
          },
        });
      }
    });
  }

  public openBulkImport() {
    if (!this.contentTypeSlug) {
      this.toastService.error('Cannot determine content type for import.');
      return;
    }

    const dialogRef = this.dialogService.open(BulkImportDialogComponent, {
      width: '90vw',
      maxWidth: '1200px',
      height: '85vh',
      disableClose: true,
      data: {
        contentTypeSlug: this.contentTypeSlug,
      },
    });

    dialogRef.afterClosed().subscribe((result) => {
      if (result) {
        // Refresh data if import was successful
        this.fetchData();
      }
    });
  }

  public openContent(contentId: string) {
    if (contentId) {
      // Navigate to the edit page for this content type
      if (this.contentTypeSlug) {
        this.router.navigate([
          `/admin/contents/${this.contentTypeSlug}/edit`,
          contentId,
        ]);
      } else {
        this.toastService.error('Cannot determine content type for editing.');
      }
    } else {
      // Navigate to add page for this content type
      if (this.contentTypeSlug) {
        this.router.navigate([`/admin/contents/${this.contentTypeSlug}/add`]);
      } else {
        this.router.navigate(['/admin/contents/create-content']);
      }
    }
  }

  public confirmUnpublishContent(contentId: string) {
    const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
      'Are you sure you want to unpublish this content?',
    );
    const dialogRef = this.dialogService.open(ConfirmationPopupComponent, {
      width: '350px',
      data: {
        dialogType: 'Unpublish',
        dialogMessage: msg,
        btnText: 'Unpublish',
        panelType: 'warn',
      },
    });
    dialogRef.afterClosed().subscribe((result: any) => {
      if (result) {
        this.makeContentsUnpublished(contentId);
      }
    });
  }

  private makeContentsUnpublished(contentId: string) {
    const draftStatus = this.constantVariables.DRAFT as 'draft' | 'publish';
    // Update the draft to reflect unpublished status
    this.draftContentStore
      .update(contentId, { status: draftStatus, publishedStatus: false })
      .subscribe({
        next: () => {
          // Enqueue unpublish so the Cloud Function removes the published doc
          this.publishQueueService.enqueue('unpublish', this.contentTypeSlug, contentId);
          this.toastService.success('Content unpublished.');
          this.fetchData();
        },
        error: (error) => {
          console.error('Error unpublishing content:', error);
          this.toastService.error('Failed to unpublish content.');
        },
      });
  }

  public openPublishHistory(item: any) {
    this.historyOpened = {
      contentId: item.id,
      urlSlug: item.urlSlug,
    };
    this.openView(this.historyOpened);
  }

  public makeItemFeatured(item: any) {
    const isCurrentlyFeatured = item.isFeatured;
    const actionText = isCurrentlyFeatured
      ? 'remove from featured'
      : 'add to featured';

    const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
      `Are you sure you want to ${actionText}?`,
    );
    const dialogRef = this.dialogService.open(ConfirmationPopupComponent, {
      width: '350px',
      data: {
        dialogType: isCurrentlyFeatured ? 'Remove Featured' : 'Add Featured',
        dialogMessage: msg,
        btnText: isCurrentlyFeatured ? 'Remove' : 'Add',
        panelType: 'primary',
      },
    });
    dialogRef.afterClosed().subscribe((result: any) => {
      if (result) {
        this.draftContentStore
          .update(item.id, { isFeatured: !isCurrentlyFeatured })
          .subscribe(() => {
            const successMessage = !isCurrentlyFeatured
              ? 'Content added to featured successfully.'
              : 'Content removed from featured successfully.';
            this.toastService.success(successMessage);
          });
      }
    });
  }

  trackByContentId(index: number, item: any): string {
    return item.id;
  }
}
