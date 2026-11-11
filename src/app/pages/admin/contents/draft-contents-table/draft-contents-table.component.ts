import { CommonModule, DatePipe, LowerCasePipe } from '@angular/common';
import { TranslocoPipe } from '@jsverse/transloco';
import {
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  Input,
  OnChanges,
  OnInit,
  signal,
  SimpleChanges,
  ViewChild,
  TemplateRef,
  untracked,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ActivatedRoute, Params, Router, RouterLink } from '@angular/router';
import { followLandedPage } from '../../../../../shared/services/generic-store.service';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { ContentsStore } from '../content-store/published-contents.store';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';
import { ContentTypesStore } from '../content-types/content-types.store';
import { ContentTypesService } from '../content-types/content-types.service';
import { ContentType, ContentTypeField, contentTypeName, contentTypeSingularName } from '../content-types/content-types.model';
import {
  CONTENT_STATUS_CLASS,
  CONTENT_STATUS_LABEL_KEY,
  CONTENT_STATUS_TOOLTIP_KEY,
  deriveContentStatus,
} from '../draft-content-store/content-status';
import { ConfirmationPopupComponent } from '../../../../../shared/components/confirmation-popup/confirmation-popup.component';
import {
  GlobalTableComponent,
  TableColumn,
} from '../../../../../shared/components/global-table/global-table.component';
import { BulkImportDialogComponent } from '../bulk-import/bulk-import-dialog.component';
import { ArrangeEntriesDialogComponent } from '../entry-order/arrange-entries-dialog.component';
import { entryOrderOf } from '../../../../core/utils/display-order';
import { PageHeaderComponent } from '../../../../../shared/components/page-header/page-header.component';

import { PreviewContentComponent } from './preview-content/preview-content.component';
import { PublishQueueService } from '../publish-queue/publish-queue.service';
import { iconClasses, iconLabel } from '../../../../../shared/models/icon.model';
import { isRepeaterType } from '../../../../../shared/models/repeater.model';
import { escapeHtml } from '../../../../../shared/utils/escape-html';
import { LoaderComponent } from '../../../../../shared/components/loader/loader.component';
import { DraftContentsService } from '../draft-content-store/draft-contents.service';

/** The page sizes a content list offers. */
const PAGE_SIZES = [5, 10, 25, 50];

/** What Firestore says when a query's index is missing or still building. */
const NEEDS_INDEX = /requires an index/i;
const INDEX_CONSOLE_LINK = /https:\/\/console\.firebase\.google\.com\/\S+/;
/** Needs no index of its own beside a filter. */
const RECORD_ORDER = '__name__';
/** The sort a filtered list has an index for (functions/src/content-types/contentListIndexes.ts). */
const FILTERED_SORT_FIELD = 'modifiedAt';

/** Orders two stored values for the search's matches: times, numbers, then text. */
function compareValues(a: unknown, b: unknown): number {
  const time = (v: any) => (typeof v?.toMillis === 'function' ? v.toMillis()
    : typeof v?.seconds === 'number' ? v.seconds * 1000 : v instanceof Date ? v.getTime() : null);
  const ta = time(a);
  const tb = time(b);
  if (ta !== null || tb !== null) return (ta ?? 0) - (tb ?? 0);
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a ?? '').localeCompare(String(b ?? ''));
}

@Component({
  selector: 'arc-draft-contents-table',
  standalone: true,
  imports: [
    LoaderComponent, MatIconModule,
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
    TranslocoPipe,
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
  private draftContentsService = inject(DraftContentsService);

  historyOpened: any;
  modifiedData: any[] = [];

  // Input for content type slug from parent route
  @Input() contentTypeSlug: string = '';

  // Sorting signals
  sortField = signal<string>('modifiedAt');
  sortOrder = signal<'asc' | 'desc'>('desc');

  // Pagination signals
  readonly pageSizes = PAGE_SIZES;
  pageSizeSignal = signal<number>(10);
  currentPageNum = signal<number>(0);

  // Filters
  statusFilter = signal<string>(''); // '', 'published', 'draft'
  /**
   * The type has no index for filtering and sorting yet, or it is still building, so a
   * filtered list reads in record order and offers to create it.
   */
  readonly orderPending = signal(false);
  readonly indexRequest = signal<'none' | 'creating' | 'requested' | 'failed'>('none');
  /** Firestore's own link to create the index in the Firebase console, from its error. */
  readonly indexConsoleLink = signal('');

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
    return found
      ? contentTypeName(found, this.adminLang())
      : this.formatSlugAsName(this.contentTypeSlug);
  }

  /**
   * The type's singular name for this reader.
   *
   * The admin authored these translations for the public pages (M-D19); a
   * reader who set the admin to that language gets them here too, and an
   * untranslated type keeps its authored name. Reads `adminLang` so the
   * heading re-renders when the language changes.
   */
  getContentTypeSingularName(): string {
    if (!this.contentTypeSlug) return 'Content';
    const contentTypes = this.contentTypesStore.items();
    const found = contentTypes.find(
      (ct: ContentType) => ct.slug === this.contentTypeSlug,
    );
    if (found) {
      return (
        contentTypeSingularName(found, this.adminLang()) ||
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
      return contentTypeName(found, this.adminLang()) || this.formatSlugAsName(this.contentTypeSlug);
    }
    return this.formatSlugAsName(this.contentTypeSlug);
  }
  
  currentContentType = computed(() => {
    if (!this.contentTypeSlug) return null;
    return this.contentTypesStore.items().find(ct => ct.slug === this.contentTypeSlug) || null;
  });

  /** The type is kept in its own order (SS2): the list offers Arrange. */
  isOwnOrder = computed(() => entryOrderOf(this.currentContentType()) === 'manual');

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
    this.adminLang();
    return this.transloco.translate('admin.contents.list.type_missing', { slug: this.contentTypeSlug });
  });

  // Format slug as title case
  private formatSlugAsName(slug: string): string {
    if (!slug) return '';
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  }

  /** The page of entries the server returned, for the list without a title search. */
  private pageData = computed(() => {
    const items = this.draftContentStore.items() || [];
    return this.contentTypeSlug ? items.filter((item: any) => item.type === this.contentTypeSlug) : items;
  });

  // ── Title search (specs/dev-review-fixes-spec.md, RF5 5.9) ─────────────
  // Firestore cannot search inside a title, so a search reads the type's
  // entries once and matches here, in any case and anywhere in the title.
  // The status filter and the sort apply to the matches too.
  searchTerm = signal<string>('');
  /** Every entry of the type, read for the search; null until it is needed. */
  private searchPool = signal<any[] | null>(null);
  readonly searching = signal(false);
  readonly searchFailed = signal(false);
  private searchTimer: ReturnType<typeof setTimeout> | null = null;

  /** The entries matching the search and the status filter, sorted, every page. */
  private searchMatches = computed(() => {
    const term = this.searchTerm().trim().toLowerCase();
    const pool = this.searchPool();
    if (!term || !pool) return [];
    const status = this.statusFilter();
    const field = this.sortField();
    const direction = this.sortOrder() === 'asc' ? 1 : -1;
    return pool
      .filter((item: any) => String(item.title || '').toLowerCase().includes(term))
      .filter((item: any) => !status || !!item.publishedStatus === (status === 'published'))
      .sort((a: any, b: any) => direction * compareValues(a?.[field], b?.[field]));
  });

  /** A search is narrowing the list. */
  readonly isSearching = computed(() => !!this.searchTerm().trim());

  /** The rows on screen: the server's page, or a page of the search's matches. */
  public draftContentsData = computed(() => {
    if (!this.isSearching()) return this.pageData();
    const start = this.currentPageNum() * this.pageSizeSignal();
    return this.searchMatches().slice(start, start + this.pageSizeSignal());
  });

  /** The server's count of what the list holds, filtered or not; the matches while searching. */
  public filteredTotalRecords = computed(() =>
    this.isSearching() ? this.searchMatches().length : this.draftContentStore.totalRecords());

  /** The list did not load (RF5 5.1): a plain sentence in the table, the detail in the console. */
  readonly loadFailed = signal(false);
  /** A read of the list is under way, so its outcome can be told from other store work. */
  private fetching = false;

  /** The table's error state: the search's read, or the list's. */
  readonly listError = computed<boolean | null>(() =>
    (this.isSearching() ? this.searchFailed() : this.loadFailed()) || null);

  /** Typing in the search box: matched after a short pause. */
  onSearchInput(value: string): void {
    this.searchTerm.set(value);
    this.currentPageNum.set(0);
    if (this.searchTimer) clearTimeout(this.searchTimer);
    this.searchTimer = setTimeout(() => void this.loadSearchPool(), 250);
  }

  /** Reads the type's entries for the search, once; Retry reads them again. */
  async loadSearchPool(force = false): Promise<void> {
    if (!this.isSearching() || !this.contentTypeSlug) return;
    if (this.searchPool() && !force) return;
    this.searching.set(true);
    this.searchFailed.set(false);
    try {
      this.searchPool.set(await this.draftContentsService.listForSearch(this.contentTypeSlug));
    } catch (error) {
      console.error('Reading the entries for the search failed:', error);
      this.searchFailed.set(true);
    } finally {
      this.searching.set(false);
    }
  }

  /** The search's copy of the entries is read again after a change made here (RF4 review L9). */
  private refreshSearch(): void {
    this.searchPool.set(null);
    if (this.isSearching()) void this.loadSearchPool();
  }

  /** Retry in the table's error state. */
  retryLoad(): void {
    if (this.isSearching()) void this.loadSearchPool(true);
    else this.fetchData();
  }

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
      header: 'admin.contents.list.col_title',
      clickable: true,
      classFn: () => 'text-primary fw-bold cursor-pointer',
    },
  ];

  // Define standard end columns
  endColumns: TableColumn[] = [
    {
      key: 'publishedStatus',
      header: 'common.table.status',
      type: 'badge',
      // Three states rather than a published/draft boolean — a live page whose
      // draft has moved on is neither. `textFn` puts the badge in multi-state
      // mode, leaving the tone to classFn.
      badgeConfig: {
        textFn: (row) => this.transloco.translate(CONTENT_STATUS_LABEL_KEY[deriveContentStatus(row)]),
      },
      classFn: (row) => CONTENT_STATUS_CLASS[deriveContentStatus(row)],
      titleFn: (row) => this.transloco.translate(CONTENT_STATUS_TOOLTIP_KEY[deriveContentStatus(row)]),
    },
    {
      key: 'modifiedAt',
      header: 'common.table.last_updated',
      type: 'date',
      sortable: true,
    },
    {
      key: 'actions',
      header: 'common.table.actions',
      type: 'actions',
      sortable: false,
      actions: [
        {
          action: 'preview',
          icon: 'fa-solid fa-eye text-muted',
          label: 'admin.contents.list.preview',
          class: 'preview',
          onAction: (row) => this.previewItem.set(row),
        },
        {
          action: 'edit',
          icon: 'fa-solid fa-pen text-primary',
          label: 'common.actions.edit',
          class: 'edit',
          isRowClick: true,
          onAction: (row) => this.openContent(row.id),
        },
        {
          action: 'unpublish',
          icon: 'fa-solid fa-eye-slash text-warning',
          label: 'admin.contents.list.unpublish',
          class: 'edit',
          hide: (row) => !row.publishedStatus,
          onAction: (row) => this.confirmUnpublishContent(row.id),
        },
        {
          action: 'history',
          icon: 'fa-solid fa-clock-rotate-left text-info',
          label: 'admin.contents.list.view_history',
          class: 'edit',
          hide: (row) => !row.publishedStatus,
          onAction: (row) => this.openPublishHistory(row),
        },
        {
          action: 'delete',
          icon: 'fa-solid fa-trash text-danger',
          label: 'common.actions.delete',
          class: 'delete',
          onAction: (row) => this.deleteItem(row),
        },
      ],
    },
  ];

    constructor() {
    super();

    // The page the list landed on, which a removed record can change.
    followLandedPage(this.draftContentStore.currentPageNumber, this.currentPageNum);

    this.applyAddress(this.route.snapshot.queryParams);

    effect(() => {
      const error = this.draftContentStore.error();
      untracked(() => {
        if (this.statusFilter() && !this.orderPending() && NEEDS_INDEX.test(error ?? '')) this.readWithoutIndex(error);
      });
    });

    // A read of the list that ended with an error: the table says so, with
    // Retry. A missing index is not a failure: the list reads without it.
    effect(() => {
      const loading = this.draftContentStore.isLoading();
      const error = this.draftContentStore.error();
      untracked(() => {
        if (loading || !this.fetching) return;
        this.fetching = false;
        const failed = !!error && !NEEDS_INDEX.test(error);
        if (failed) console.error('Loading the entries failed:', error);
        this.loadFailed.set(failed);
      });
    });

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

  /**
   * The admin UI language, as a signal so the headings re-render when it
   * changes rather than waiting for the next navigation.
   */
  private destroyRef = inject(DestroyRef);
  readonly adminLang = signal<string>(this.transloco.getActiveLang());

  ngOnInit(): void {
    // A search still waiting for its pause must not run after the page is gone (RF4 review L9).
    this.destroyRef.onDestroy(() => {
      if (this.searchTimer) clearTimeout(this.searchTimer);
    });
    this.transloco.langChanges$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(lang => this.adminLang.set(lang));
    // Initial data fetch
    this.fetchData();
  }

  onCellClick(event: { key: string, row: any }) {
    if (event.key === 'title') {
      this.openContent(event.row.id);
    }
  }

  ngOnChanges(changes: SimpleChanges): void {
    // The first value comes in before ngOnInit, which reads the list once it has opened.
    if (changes['contentTypeSlug'] && !changes['contentTypeSlug'].firstChange) {
      // Reset pagination when switching content types
      this.currentPageNum.set(0);
      this.orderPending.set(false);
      this.indexRequest.set('none');
      this.fetchData();
    }
  }

  /**
   * Update table columns based on the current content type
   */
  /**
   * Update table columns based on the current content type
   */
  /**
   * Whether a content-type field should be offered as a list column.
   *
   * Excluded:
   *  - keys already rendered by a fixed column. Content types commonly define
   *    their own `title` / `urlSlug` fields alongside the built-ins, which
   *    produced two identically-headed columns side by side.
   *  - `richtext`, which holds the article body. A table cell cannot show it
   *    usefully and it squeezes every other column out of view.
   *
   * Excluded fields are still fully editable in the content editor — this
   * only governs the list view.
   */
  private isListableField(field: ContentTypeField): boolean {
    if (field.type === 'richtext') return false;

    // A repeating field is a list of rows; a cell can show neither the rows
    // nor a useful summary of them, and the raw value stringifies to
    // "[object Object]".
    if (isRepeaterType(field.type)) return false;

    // A file field is a list of files too (docs/features/content.html, File).
    if (field.type === 'file') return false;

    const fixedKeys = [
      ...this.baseColumns.map((col) => col.key),
      ...this.endColumns.map((col) => col.key),
    ];
    return !fixedKeys.includes(field.key);
  }

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

    // Custom Fields — but not every field earns a column:
    //  - a field whose key collides with a fixed column (e.g. a custom "title"
    //    on top of the built-in one) would render the same heading twice
    //  - rich text is a whole article body; it cannot be read in a table cell
    //    and pushes every other column off-screen
    const listableFields = currentType.fields.filter(
      (field) => this.isListableField(field),
    );

    listableFields.forEach(field => {
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
    const customColumnDefs: TableColumn[] = listableFields.map((field) => {
      return {
        key: field.key,
        header: field.label,
        // Image fields show a thumbnail; a raw storage URL is unreadable and
        // several hundred characters wide.
        //
        // Icon fields render the glyph itself. The stored value is a token
        // object, so the default text cell prints "[object Object]" — and the
        // glyph is the one thing that identifies an icon at a glance anyway.
        //
        // Color fields show a swatch beside the hex value.
        type: field.type === 'image' ? 'image'
            : field.type === 'icon' ? 'icon'
            : field.type === 'color' ? 'color'
            : 'text',
        ...(field.type === 'image' ? { imageConfig: { height: 40, altKey: 'title' } } : {}),
        ...(field.type === 'icon'
            ? { classFn: (row: any) => iconClasses(row?.customFields?.[field.key]) }
            : {}),
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
            const value = row.customFields[field.key];
            // The icon cell draws from `classFn`, not from here — but this is
            // still what sorting and any text fallback would read, and an
            // object stringifies to "[object Object]".
            return field.type === 'icon' ? iconLabel(value) : value;
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
          this.notify.error('admin.contents.list.view_save_failed');
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
    // When contentTypeSlug is set, we query the per-type collection directly
    // (no need for a type WHERE filter — the collection itself is type-specific).
    // When contentTypeSlug is empty, fall back to the legacy collection with no type filter.

    // One filter at a time, on the server, so the rows and the total are right on every page.
    // "Published" includes a page with unpublished edits: "edited" compares two fields, which
    // a query cannot do.
    const status = this.statusFilter();
    const inRecordOrder = !!status && this.orderPending();

    this.loadFailed.set(false);
    this.fetching = true;
    // A change to the list since the search read it is read again on the next search.
    this.searchPool.set(null);
    this.draftContentStore.getAll({
      orderByField: inRecordOrder ? RECORD_ORDER : this.sortField(),
      orderByDirection: inRecordOrder ? 'asc' : this.sortOrder(),
      limitCount: this.pageSizeSignal(),
      currentPageNumber: this.currentPageNum(),
      previousPageNumber: this.currentPageNum() - 1,
      whereConditions: status ? [{ field: 'publishedStatus', operator: '==', value: status === 'published' }] : [],
    }, this.contentTypeSlug || undefined);
  }

  /** Firestore says the index is missing or still building: the rows are still right without it. */
  private readWithoutIndex(error: string): void {
    this.orderPending.set(true);
    this.indexConsoleLink.set(error.match(INDEX_CONSOLE_LINK)?.[0] ?? '');
    this.currentPageNum.set(0);
    this.fetchData();
  }

  /** The alert's button. One press, and it takes a few minutes; choosing the filter again then finds it. */
  async createIndexes(): Promise<void> {
    this.indexRequest.set('creating');
    try {
      const created = await this.draftContentsService.createListIndexes(this.contentTypeSlug);
      this.indexRequest.set(created ? 'requested' : 'failed');
    } catch (error) {
      console.warn('Could not create the list indexes:', error);
      this.indexRequest.set('failed');
    }
  }

  /** Opens on the sort and page size in the address, so a reload or a shared link keeps them. */
  private applyAddress(params: Params): void {
    // A malformed field would throw when the query is built, and leave the list loading.
    if (/^[\w-]+(\.[\w-]+)*$/.test(params['sort'] ?? '')) this.sortField.set(params['sort']);
    if (params['order'] === 'asc' || params['order'] === 'desc') this.sortOrder.set(params['order']);
    if (PAGE_SIZES.includes(+params['size'])) this.pageSizeSignal.set(+params['size']);
  }

  /**
   * Update URL with current state. No page: a list read by cursor cannot reach a page
   * after a reload (page-cursors.ts), so an old one is cleared.
   */
  private updateUrl(): void {
    const queryParams: any = {
      sort: this.sortField(),
      order: this.sortOrder(),
      page: null,
      size: this.pageSizeSignal(),
    };

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
    // The search's matches are all here already; only the server's list reads a page.
    if (!this.isSearching()) this.fetchData();
  }

  /**
   * Clear all filters
   */
  clearFilters(): void {
    this.statusFilter.set('');
    this.searchTerm.set('');
    this.searchFailed.set(false);
    this.orderPending.set(false);
    this.currentPageNum.set(0);
    this.updateUrl();
    this.fetchData();
  }

  /**
   * Check if any filters are active
   */
  hasActiveFilters(): boolean {
    return this.statusFilter() !== '' || this.isSearching();
  }

  /**
   * Handle status filter change
   */
  onStatusFilterChange(event: any): void {
    const value = event.target.value;
    this.statusFilter.set(value);
    this.orderPending.set(false); // Tried again: the index may be ready by now
    // The one sort a filtered list has an index for.
    if (value && this.sortField() !== FILTERED_SORT_FIELD) {
      this.sortField.set(FILTERED_SORT_FIELD);
      this.updateUrl();
    }
    this.currentPageNum.set(0); // Reset to first page on filter change
    if (!this.isSearching()) this.fetchData();
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
    if (this.orderPending()) return;

    let newOrder: 'asc' | 'desc' = 'asc';

    // If clicking the same field, toggle the order
    if (this.sortField() === field) {
      newOrder = this.sortOrder() === 'asc' ? 'desc' : 'asc';
    }

    this.sortField.set(field);
    this.sortOrder.set(newOrder);
    this.currentPageNum.set(0); // Another order is another list, which opens on its first page

    this.updateUrl();
    if (!this.isSearching()) this.fetchData();
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
    // The wording says what goes with it: a published entry's live page too (RF4 4.11).
    const live = !!(item.publishedStatus || item.status === this.constantVariables.PUBLISH);
    const msg: SafeHtml = this.sanitizer.bypassSecurityTrustHtml(
      this.transloco.translate(
        live ? 'admin.contents.list.delete_confirm_live' : 'admin.contents.list.delete_confirm_draft',
        { title: escapeHtml(item.title || '') },
      ),
    );
    const dialogRef = this.dialogService.open(ConfirmationPopupComponent, {
      width: '380px',
      maxWidth: '92vw',
      data: {
        dialogType: 'Delete',
        titleKey: 'common.dialog.delete',
        dialogMessage: msg,
        btnText: this.transloco.translate('common.actions.delete'),
        panelType: 'warn',
      },
    });
    dialogRef.afterClosed().subscribe((result: any) => {
      if (result) void this.removeEntry(item, live);
    });
  }

  /**
   * Deletes an entry. A published one's page is taken down first: when that
   * cannot start, nothing is deleted, so no live page is left without its
   * entry. Every failure tells the admin, not only the console.
   */
  private async removeEntry(item: any, live: boolean): Promise<void> {
    if (live) {
      try {
        await this.publishQueueService.enqueue('delete', this.contentTypeSlug, item.id);
      } catch (error) {
        console.error('Error taking down the live page:', error);
        this.notify.error('admin.contents.list.delete_page_failed');
        return;
      }
    }
    this.draftContentStore.delete(item.id, this.contentTypeSlug || undefined).subscribe({
      next: () => {
        this.notify.success('admin.contents.list.deleted');
        this.refreshSearch();
      },
      error: (error) => {
        // The publish function's delete also removes the draft, so a live
        // entry is gone either way; a draft is not.
        console.error('Error deleting content:', error);
        if (!live) this.notify.error('admin.contents.list.delete_failed');
        else this.notify.success('admin.contents.list.deleted');
      },
    });
  }

  /** Puts the type's entries in its own order (specs/site-sections-spec.md, SS2). */
  public openArrange() {
    if (!this.contentTypeSlug) return;
    this.dialogService.open(ArrangeEntriesDialogComponent, {
      width: '640px',
      maxWidth: '95vw',
      data: { slug: this.contentTypeSlug, typeName: this.getContentTypePluralName() },
    });
  }

  public openBulkImport() {
    if (!this.contentTypeSlug) {
      this.notify.error('admin.contents.list.no_type_import');
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
        this.notify.error('admin.contents.list.no_type_edit');
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
      this.transloco.translate('admin.contents.list.unpublish_confirm'),
    );
    const dialogRef = this.dialogService.open(ConfirmationPopupComponent, {
      width: '350px',
      data: {
        dialogType: 'Unpublish',
        titleKey: 'common.dialog.unpublish',
        dialogMessage: msg,
        btnText: this.transloco.translate('admin.contents.list.unpublish'),
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
          this.notify.success('admin.contents.list.unpublished');
          this.fetchData();
        },
        error: (error) => {
          console.error('Error unpublishing content:', error);
          this.notify.error('admin.contents.list.unpublish_failed');
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
    const dialogRef = this.dialogService.open(ConfirmationPopupComponent, {
      width: '350px',
      maxWidth: '92vw',
      data: {
        dialogType: isCurrentlyFeatured ? 'Remove Featured' : 'Add Featured',
        titleKey: isCurrentlyFeatured ? 'admin.contents.list.unfeature_title' : 'admin.contents.list.feature_title',
        dialogMessage: escapeHtml(this.transloco.translate(
          isCurrentlyFeatured ? 'admin.contents.list.unfeature_confirm' : 'admin.contents.list.feature_confirm',
          { title: item.title || '' },
        )),
        btnText: this.transloco.translate(isCurrentlyFeatured ? 'common.actions.remove' : 'common.actions.add'),
        panelType: 'primary',
      },
    });
    dialogRef.afterClosed().subscribe((result: any) => {
      if (result) {
        this.draftContentStore
          .update(item.id, { isFeatured: !isCurrentlyFeatured })
          .subscribe(() => {
            this.notify.success(!isCurrentlyFeatured ? 'admin.contents.list.featured' : 'admin.contents.list.unfeatured');
            this.refreshSearch();
          });
      }
    });
  }

  trackByContentId(index: number, item: any): string {
    return item.id;
  }
}
