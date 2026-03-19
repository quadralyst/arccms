import { inject, computed, Component, ChangeDetectorRef, effect, Input, ViewChild, AfterViewInit, signal, NgZone, afterNextRender, Injector, untracked } from '@angular/core';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { FormBuilder, FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { SafeHtml } from '@angular/platform-browser';
import { CommonModule, formatDate } from '@angular/common';
import { IDraftContents, INextContentReference } from '../draft-content-store/draft-contents.model';
import { ActivatedRoute, ParamMap, Router } from '@angular/router';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';
import { ContentTypesStore } from '../content-types/content-types.store';
import { ContentType, ContentTypeField } from '../content-types/content-types.model';
import TiptapEditorComponent from '../../../../../shared/components/tiptap-editor/tiptap-editor.component';
import { TagsStore } from '../content-types/tags/tags.store';
import { ITag } from '../content-types/tags/tags.model';
import MediaManagerComponent from '../../(media)/media.page';
import { MatDialog } from '@angular/material/dialog';
import { CollectionRefSyncService } from '../content-store/collection-ref-sync.service';
import { DraftContentsService } from '../draft-content-store/draft-contents.service';
import { getDocs, query, orderBy, limit } from '@angular/fire/firestore';
import { PublishQueueService } from '../publish-queue/publish-queue.service';
import { ContentsService, DeployStatusUpdate } from '../content-store/published-contents.service';
import { FullscreenEditorDialogComponent } from './fullscreen-editor-dialog/fullscreen-editor-dialog.component';
import { Subject, Subscription } from 'rxjs';
import { debounceTime, filter, switchMap } from 'rxjs/operators';
import { VersionHistoryComponent, VersionHistoryItem } from './version-history/version-history.component';

@Component({
  selector: 'arc-create-content',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    TiptapEditorComponent,
    VersionHistoryComponent,
  ],
  templateUrl: './create-content.component.html',
  styleUrl: './create-content.component.scss',
})
export class CreateContentComponent extends BaseComponent {
  public isToolbarInitialized = false;
  public editor: any;
  public checkingSlug: boolean = false;
  public draftContentStore = inject(DraftContentsStore);
  private dialog = inject(MatDialog);
  public cdr = inject(ChangeDetectorRef);
  private ngZone = inject(NgZone);
  public breakpointObserver = inject(BreakpointObserver);
  injector = inject(Injector);

  contentTypeStore = inject(ContentTypesStore);

  public errorSlug: boolean = false;
  public isSavingDraft: boolean = false;
  public count = 0;
  
  // Service for fetching referenced content
  private draftContentsService = inject(DraftContentsService);
  private collectionRefSyncService = inject(CollectionRefSyncService);
  private publishQueueService = inject(PublishQueueService);
  private contentsService = inject(ContentsService);
  private deployStatusSubscription: Subscription | null = null;

  // Deployment status tracking
  deployStatus = signal<DeployStatusUpdate['deployStatus']>(null);
  deployError = signal<string>('');

  // Auto-save infrastructure
  private autoSaveTrigger$ = new Subject<void>();
  private autoSaveSubscription: Subscription | null = null;
  private isAutoSaving = false;

  // Store loaded options for collection reference fields: { [fieldKey]: ContentItem[] }
  public referenceOptions = signal<{ [key: string]: any[] }>({});
  public loadingReferences = signal<boolean>(false);

  public pageTitle: string = '';
  currentDateTime: string = '';
  public domain: string = '';
  public childCategories: any[] = [];

  publishForm!: FormGroup;
  seoForm!: FormGroup;

  // For Drag & Drop
  isDragging = false;
  coverImage: string | null = null;
  errorMessage: string | null = null;

  // Save status
  saveStatusMessage: string = '';
  saveStatusType: 'success' | 'error' | 'info' = 'info';

  public isEditingSlug = signal<boolean>(false);
  private originalSlug: string = '';


  // For selecting tags
  isOpenTopMenu = false;
  selectedTags = signal<{ label: string; color: string }[]>([]);
  tagSearchTerm = signal<string>('');
  showTagDropdown = signal<boolean>(false);
  tagsStore = inject(TagsStore);

  // Next content selection
  selectedNextContent: INextContentReference | null = null;
  nextContentSearchTerm = signal<string>('');
  showNextContentDropdown = signal<boolean>(false);
  availableContents: IDraftContents[] = [];
  isLoadingContents = false;

  private _contentId: string = '';
  publishedId: string = ''; // Links to published version if editing a draft of published content
  lastDraftSavedDate: Date | null = null;
  lastPublishedDate: Date | null = null;
  paramContentType: string | null = null;
  activeTab: 'basic' | 'seo' | 'history' = 'basic';

  // Version preview — when set, replaces the editor area with a read-only preview
  previewingVersion = signal<VersionHistoryItem | null>(null);
  private formsInitialized = false;

  // Custom fields support
  customFieldValues: { [key: string]: any } = {};

  // Signal for content type slug to enable reactivity in computed properties
  private contentTypeSlugSignal = signal<string>('');

  // Input for content type slug from parent route
  @Input() set contentTypeSlug(value: string) {
    this.contentTypeSlugSignal.set(value);
  }
  get contentTypeSlug(): string {
    return this.contentTypeSlugSignal();
  }

  // Input for content ID from parent route (for editing)
  @Input() set contentId(value: string) {
    if (value && value !== this._contentId) {
      this._contentId = value;
      this.loadContentById(value);
    }
  }
  get contentId(): string {
    return this._contentId;
  }

  // Computed property to get the content type name from the slug
  currentContentTypeName = computed(() => {
    const slug =
      this.contentTypeSlug ||
      this.paramContentType ||
      this.publishForm?.get('type')?.value;
    if (!slug) return '';

    const contentTypes = this.contentTypeStore.items();
    const found = contentTypes.find((ct: ContentType) => ct.slug === slug);
    return found ? found.name : slug;
  });

  contentTypeItems: any = computed(() => {
    return this.contentTypeStore.items() || [];
  });

  contentDetailedData: any = computed(() => {
    const contentChanges = this.draftContentStore.currentItem();
    if (Object.keys(contentChanges).length > 0) {
      this.patchForms(contentChanges);
    }
    return this.draftContentStore.currentItem();
  });

  // Computed property to get current content type with its fields
  currentContentType = computed(() => {
    const slug =
      this.contentTypeSlugSignal() ||
      this.paramContentType ||
      this.publishForm?.get('type')?.value;
    if (!slug) return null;
    const contentTypes = this.contentTypeStore.items();
    return contentTypes.find((ct: ContentType) => ct.slug === slug) || null;
  });

  // Get current content type fields
  get currentFields(): ContentTypeField[] {
    const ct = this.currentContentType();
    return ct?.fields || [];
  }

  // Parse comma-separated options string into array
  parseOptions(options: string | undefined): string[] {
    if (!options) return [];
    return options
      .split(',')
      .map((opt) => opt.trim())
      .filter((opt) => opt.length > 0);
  }

  // Update custom field value
  onCustomFieldChange(key: string, value: any): void {
    this.customFieldValues[key] = value;
    this.triggerAutoSave();
  }

  // Open media manager for a custom image field
  openMediaManagerForField(fieldKey: string): void {
    const dialogRef = this.dialog.open(MediaManagerComponent, {
      enterAnimationDuration: '450ms',
      exitAnimationDuration: '300ms',
      minWidth: '134vh',
      maxHeight: '90vh',
      panelClass: 'common-dialog-box',
      disableClose: true,
      data: { isDialogOpen: true },
    });

    dialogRef.afterClosed().subscribe((result: { mediaUrl: string; type: string } | null) => {
      if (result && result.type === 'submit' && result.mediaUrl) {
        this.customFieldValues[fieldKey] = result.mediaUrl;
        this.cdr.detectChanges();
      }
    });
  }

  // Remove image for a custom field
  removeCustomFieldImage(fieldKey: string): void {
    this.customFieldValues[fieldKey] = null;
    this.cdr.detectChanges();
  }

  // Handle rich text field content change from TiptapEditor
  onRichTextFieldChange(fieldKey: string, htmlContent: string): void {
    this.customFieldValues[fieldKey] = htmlContent;
  }

  // Open a richtext field in fullscreen modal
  openFullscreenEditor(fieldKey: string, fieldLabel: string): void {
    const currentContent = this.customFieldValues[fieldKey] || '';

    const dialogRef = this.dialog.open(FullscreenEditorDialogComponent, {
      width: '95vw',
      height: '90vh',
      maxWidth: '95vw',
      panelClass: 'fullscreen-editor-dialog',
      disableClose: true,
      data: {
        content: currentContent,
        fieldLabel: fieldLabel,
      },
    });

    dialogRef.afterClosed().subscribe((result: string | null) => {
      if (result !== null && result !== undefined) {
        this.customFieldValues[fieldKey] = result;
        this.cdr.detectChanges();
      }
    });
  }

  // Handle checkbox field changes (multi-select)
  onCheckboxFieldChange(key: string, option: string, checked: boolean): void {
    if (!this.customFieldValues[key]) {
      this.customFieldValues[key] = [];
    }
    const values = this.customFieldValues[key] as string[];
    if (checked) {
      if (!values.includes(option)) {
        values.push(option);
      }
    } else {
      const index = values.indexOf(option);
      if (index > -1) {
        values.splice(index, 1);
      }
    }
  }

  // Check if a checkbox option is selected
  isCheckboxOptionSelected(key: string, option: string): boolean {
    const values = this.customFieldValues[key];
    return Array.isArray(values) && values.includes(option);
  }

  /**
   * Load options for collection reference fields
   */
  async loadReferenceOptions() {
    const refFields = this.currentFields.filter(f => f.useCollectionRef && f.collectionRef?.collectionSlug);
    if (refFields.length === 0) {
        return;
    }

    this.loadingReferences.set(true);
    const options: { [key: string]: any[] } = {};
    
    // Create an array of promises to fetch data for all reference fields
    const promises = refFields.map(async (field) => {
        if (!field.collectionRef?.collectionSlug) {
            console.warn(`[ContentCreate] Field ${field.key} has no collectionRefSlug`);
            return;
        }
        
        try {
            // Fetch all draft items from the referenced collection's per-type collection
            const collectionRef = this.draftContentsService.getCollectionRef(field.collectionRef!.collectionSlug);
            const q = query(
                collectionRef,
                orderBy(field.collectionRef!.displayField || 'title', 'asc'),
                limit(1000)
            );

            const snapshot = await getDocs(q);
            const data = snapshot.docs.map(doc => {
                const docData = doc.data() as any;
                // Exclude id from docData if it exists to avoid "id specified more than once" error
                // when spreading. doc.id is the source of truth.
                const { id, ...rest } = docData;
                return { id: doc.id, ...rest };
            });
            
            options[field.key] = data;
        } catch (error) {
            console.error(`Error loading options for field ${field.key}:`, error);
            options[field.key] = [];
        }
    });

    try {
        await Promise.all(promises);
        this.referenceOptions.set(options);
    } catch (error) {
        console.error('Error loading reference options:', error);
    } finally {
        this.loadingReferences.set(false);
    }
  }

  /**
   * Handle changes to a collection reference field
   * Updates the ID value and the denormalized data object
   */
  onReferenceChange(fieldKey: string, selectedId: string): void {
    // 1. Update the main value (the ID)
    this.customFieldValues[fieldKey] = selectedId;

    // 2. Find the selected item to get extra data
    const field = this.currentFields.find(f => f.key === fieldKey);
    if (!field || !field.collectionRef) return;

    const options = this.referenceOptions()[fieldKey] || [];
    const selectedItem = options.find(item => item.id === selectedId);
    
    // 3. Construct the denormalized data object
    if (selectedItem) {
        // Always include ID and display field
        const refData: any = {
            id: selectedItem.id,
            [field.collectionRef.displayField]: selectedItem[field.collectionRef.displayField]
        };

        // Add other synced fields
        if (field.collectionRef.syncFields) {
            field.collectionRef.syncFields.forEach(syncKey => {
                if (syncKey !== 'id' && syncKey !== field.collectionRef!.displayField) {
                    refData[syncKey] = selectedItem[syncKey];
                }
            });
        }
        
        // Store in a special key with prefix '_ref_'
        this.customFieldValues[`_ref_${fieldKey}`] = refData;
    } else {
        // Clear denormalized data if selection is cleared
        delete this.customFieldValues[`_ref_${fieldKey}`];
    }
  }

  // Handle changes to a collection reference field (Checkbox - Multi-select)
  onRefCheckboxChange(fieldKey: string, selectedId: string, checked: boolean): void {
    // 1. Initialize arrays if needed
    if (!this.customFieldValues[fieldKey]) {
      this.customFieldValues[fieldKey] = [];
    }
    const refKey = `_ref_${fieldKey}`;
    if (!this.customFieldValues[refKey]) {
        this.customFieldValues[refKey] = [];
    }

    const values = this.customFieldValues[fieldKey] as string[];
    const refValues = this.customFieldValues[refKey] as any[];

    // 2. Handle check/uncheck
    if (checked) {
        // Add ID if not present
        if (!values.includes(selectedId)) {
            values.push(selectedId);
        }

        // Add ref data
        const field = this.currentFields.find(f => f.key === fieldKey);
        if (field && field.collectionRef) {
            const options = this.referenceOptions()[fieldKey] || [];
            const selectedItem = options.find(item => item.id === selectedId);
            
            if (selectedItem) {
                const refData: any = {
                    id: selectedItem.id,
                    [field.collectionRef.displayField]: selectedItem[field.collectionRef.displayField]
                };

                if (field.collectionRef.syncFields) {
                    field.collectionRef.syncFields.forEach(syncKey => {
                        if (syncKey !== 'id' && syncKey !== field.collectionRef!.displayField) {
                            refData[syncKey] = selectedItem[syncKey];
                        }
                    });
                }
                
                // Add to ref array if not already present (by ID)
                if (!refValues.some(r => r.id === selectedId)) {
                    refValues.push(refData);
                }
            }
        }
    } else {
        // Remove ID
        const idx = values.indexOf(selectedId);
        if (idx > -1) {
            values.splice(idx, 1);
        }

        // Remove ref data
        const refIdx = refValues.findIndex(r => r.id === selectedId);
        if (refIdx > -1) {
            refValues.splice(refIdx, 1);
        }
    }
    
  }

  // Validate for draft: only title is required
  validateForDraft(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!this.pageTitle || this.pageTitle.trim() === '') {
      errors.push('Title is required');
    }

    return { valid: errors.length === 0, errors };
  }

  // Validate for publish: all mandatory fields including custom fields
  validateForPublish(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    // Title is always required
    if (!this.pageTitle || this.pageTitle.trim() === '') {
      errors.push('Title is required');
    }

    // Check required custom fields
    const requiredCustomFields = this.currentFields.filter(f => f.required);
    for (const field of requiredCustomFields) {
      const value = this.customFieldValues[field.key];
      const isEmpty = value === undefined || value === null || value === '' ||
        (Array.isArray(value) && value.length === 0);

      if (isEmpty) {
        errors.push(`${field.label} is required`);
      }
    }

    return { valid: errors.length === 0, errors };
  }

  // Get list of missing required custom fields for display
  getMissingRequiredFields(): string[] {
    const missing: string[] = [];
    const requiredCustomFields = this.currentFields.filter((f) => f.required);

    for (const field of requiredCustomFields) {
      const value = this.customFieldValues[field.key];
      const isEmpty =
        value === undefined ||
        value === null ||
        value === '' ||
        (Array.isArray(value) && value.length === 0);

      if (isEmpty) {
        missing.push(field.label);
      }
    }

    return missing;
  }

  constructor(private fb: FormBuilder) {
    super();
    effect(() => {
      this.contentTypeItems();
      this.contentDetailedData();
    });

    // Reactive: Load references whenever the content type structure is available/changes
    effect(() => {
      const ct = this.currentContentType();
      if (ct) {
         // Use untracked to avoid loops if loadReferenceOptions modifies signals tracked here (it modifies loadingReferences and referenceOptions)
         untracked(() => {
             this.loadReferenceOptions();
         });
      }
    });

    // Auto-save pipeline: debounces 30 seconds after last edit, only for existing drafts
    this.autoSaveSubscription = this.autoSaveTrigger$.pipe(
      debounceTime(30_000),
      filter(() => !!this.contentId),
      filter(() => !this.isSavingDraft && !this.isAutoSaving),
      filter(() => this.validateForDraft().valid),
    ).subscribe(() => {
      this.performAutoSave();
    });
  }

  ngAfterViewInit(): void {
    this.isToolbarInitialized = false;
    this.cdr.detectChanges();
  }

  ngOnInit() {
    if (typeof window !== 'undefined') {
      this.domain = window.location.origin + '/';
    }
    this.fetchCurrentUrl();
  }

  private fetchCurrentUrl() {
    this.activatedRoute.paramMap.subscribe((params: ParamMap) => {
      const routeContentId = params.get('contentId') || '';
      this.initializeForms();

      // Only load from route if not already set via @Input
      if (routeContentId && !this._contentId) {
        this._contentId = routeContentId;
        this.loadContentById(routeContentId);
      } else if (!routeContentId && !this._contentId) {
        this.draftContentStore.clearCurrent();
      }
    });

    this.activatedRoute.queryParams.subscribe(async (params) => {
      this.paramContentType = params['contentType'] || '';
    });
  }

  /**
   * Load content by ID for editing
   */
  private loadContentById(id: string) {
    if (id && id !== '') {
      // Don't re-initialize forms here - they should already be initialized
      // Just trigger the data fetch
      this.draftContentStore.getByCustomField('id', '==', id, this.contentTypeSlug);
    }
  }

  private patchForms(contentData: any) {
    this.pageTitle = contentData?.title;
    this.coverImage =
      contentData?.coverImage !== '' ? contentData?.coverImage : null;

    // Set publishedId so the History tab becomes available.
    // The published collection uses the same document ID as the draft,
    // so when content has been published at least once, its ID IS the publishedId.
    if (contentData?.publishedStatus && contentData?.id) {
      this.publishedId = contentData.id;
    }

    // Set lastPublishedDate if available
    if (contentData?.publishedOn) {
      this.lastPublishedDate = contentData.publishedOn?.seconds
        ? new Date(contentData.publishedOn.seconds * 1000)
        : new Date(contentData.publishedOn);
    }

    this.publishForm.patchValue({
      type: contentData?.type || this.paramContentType || '',
      title: contentData?.title || this.pageTitle,
      summary: contentData?.summary || '',
      content: contentData?.content || '',
      parentCategory:
        (contentData?.categoryIdArr && contentData?.categoryIdArr[0]) || '',
      subCategory:
        (contentData?.categoryIdArr && contentData?.categoryIdArr[1]) || '',
      categoryIdArr: contentData?.categoryIdArr || [],
      categoryNameArr: [],
      urlSlug: contentData?.urlSlug || '',
      tags: contentData?.tags || [],
      coverImage:
        contentData?.coverImage !== '' ? contentData?.coverImage : null,
    });

    this.seoForm.patchValue({
      seoTitle: contentData?.seoTitle || '',
      metaDescription: contentData?.metaDescription || '',
      canonicalUrl: contentData?.canonicalUrl || '',
    });

    // Pre-populate custom field values
    if (contentData?.customFields) {
      this.customFieldValues = { ...contentData.customFields };
    }

    // Pre-populate next content reference
    if (contentData?.nextContent) {
      this.selectedNextContent = contentData.nextContent;
    } else {
      this.selectedNextContent = null;
    }

    // Use untracked to allow signal writes from computed/effect contexts
    untracked(() => {
      this.selectedTags.set((contentData?.tags ?? [])
        .map((label: string) => {
          const tag = this.tagsStore.items().find((t) => t.label === label);
          return tag ? { label, color: tag.color } : { label, color: '#6b7280' };
        })
        .filter(Boolean) as { label: string; color: string }[]);
    });
    afterNextRender(
      () => {
        this.onTagSearchFocus();
        this.showTagDropdown.set(false);
      },
      { injector: this.injector }
    );

    // Trigger change detection to update the view
    this.cdr.detectChanges();
  }

  private initializeForms() {
    // Prevent duplicate initialization
    if (this.formsInitialized) return;
    this.formsInitialized = true;

    this.setCurrentDateTime();
    this.publishForm = this.fb.group({
      type: [this.paramContentType || ''],
      title: [this.pageTitle],
      summary: [''],
      content: [''],
      parentCategory: [''],
      subCategory: [''],
      categoryIdArr: [[]],
      categoryNameArr: [[]],
      urlSlug: [''],
      tags: [[]],
      coverImage: [null],
    });

    // Sync summary changes to metaDescription
    this.publishForm.get('summary')?.valueChanges.subscribe((value) => {
      const metaDescControl = this.seoForm.get('metaDescription');
      if (metaDescControl && (!metaDescControl.value || !metaDescControl.dirty)) {
        metaDescControl.setValue(value, { emitEvent: false });
      }
    });

    this.seoForm = this.fb.group({
      seoTitle: [''],
      metaDescription: [''],
      canonicalUrl: [''],
    });
  }

  get title() {
    return this.publishForm?.get('title');
  }

  get urlSlug() {
    return this.publishForm?.get('urlSlug');
  }

  get type() {
    return this.publishForm?.get('type');
  }

  get seoTitle() {
    return this.seoForm?.get('seoTitle');
  }

  get metaDescription() {
    return this.seoForm?.get('metaDescription');
  }

  get canonicalUrl() {
    return this.seoForm?.get('canonicalUrl');
  }

  private setCurrentDateTime(): void {
    const now = new Date();
    this.currentDateTime = formatDate(now, 'yyyy-MM-ddTHH:mm', 'en-US');
  }

  public passEditorContentToParent(event: any): void {
    this.publishForm.get('content')?.setValue(event);

    const plainText = (event || '')
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ');
    const words = plainText.trim().split(/\s+/);
    // Use characters for summary instead of words, as requested (first 100 chars)
    const summaryText = plainText.trim().substring(0, 100).trim();

    // Only update summary if it's empty or hasn't been manually edited
    const summaryControl = this.publishForm.get('summary');
    if (summaryControl && (!summaryControl.value || !summaryControl.dirty)) {
      summaryControl.setValue(summaryText);
    }

    // Default existing logic for meta description fallback (now uses summary logic primarily)
    const first160Words = words.slice(0, 160).join(' '); // Keeping existing logic for now as fallback? 
    // Actually, let's align with the request: 
    // "Set the summary by default as first 100 characters... also set this as a default value for SEO description."
    // "If I change the summary then the SEO Description is using the default value, then update the SEO description"

    // We handle the sync in valueChanges of summary. Here we just set summary.
  }

  public createSlag(): void {
    if (this.contentId) return;

    this.seoForm.get('seoTitle')?.setValue(this.pageTitle);

    const slugify = (str: any) =>
      str
        .toLowerCase()
        .trim()
        .replace(/[^\w\s-]/g, '')
        .replace(/[\s_-]+/g, '-')
        .replace(/^-+|-+$/g, '');
    const titleVal = this.pageTitle || '';
    const newSlag = slugify(titleVal);
    this.checkExist(newSlag);
  }

  public checkExist(newSlug?: string): void {
    if (this.contentId) return;

    const newGeneratedSlug = newSlug || this.publishForm.value.urlSlug || '';
    this.errorSlug = false;
    this.draftContentStore.checkExistingSlugUrl(newGeneratedSlug, this.contentTypeSlug).then(
      (res) => {
        if (res && res.exists) {
          if (res.slug === newSlug) {
            const baseSlug = this.getBaseSlug(res.slug);
            this.incrementAndCheck(baseSlug);
          }
        } else {
          this.setSlugValue(newGeneratedSlug);
        }
      },
      (error) => {
        console.error('Error checking slug existence:', error);
      }
    );
  }

  private getBaseSlug(slug: string): string {
    const match = slug.match(/(.*)-(\\d+)$/);
    return match ? match[1] : slug;
  }

  private incrementAndCheck(baseSlug: string): void {
    this.count++;
    const newSlug = `${baseSlug} -${this.count} `;
    if (this.count < 10) {
      this.checkExist(newSlug);
    } else {
      this.setSlugValue(baseSlug);
      this.checkingSlug = false;
      this.errorSlug = true;
    }
  }

  private setSlugValue(slug: string): void {
    this.publishForm.get('urlSlug')?.setValue(slug);
    this.seoForm.get('canonicalUrl')?.setValue(this.domain + slug);
  }

  toggleSlugEdit(): void {
    if (this.isEditingSlug()) {
      // Cancel edit - revert to original value
      this.publishForm.get('urlSlug')?.setValue(this.originalSlug);
      this.isEditingSlug.set(false);
    } else {
      // Start edit
      this.originalSlug = this.publishForm.get('urlSlug')?.value || '';
      this.isEditingSlug.set(true);
    }
  }

  saveSlug(): void {
    const currentSlug = this.publishForm.get('urlSlug')?.value;
    if (currentSlug) {
      this.checkExist(currentSlug);
      this.isEditingSlug.set(false);
    }
  }

  onDragOver(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = true;
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    this.isDragging = false;
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      this.handleFile(files[0]);
    }
  }

  onFileSelected(event: any): void {
    const file = event.target.files[0];
    if (file) {
      this.handleFile(file);
    }
  }

  handleFile(file: File): void {
    if (file.type.startsWith('image/')) {
      const reader = new FileReader();
      reader.onload = (e: any) => {
        this.coverImage = e.target.result.split(',')[1];
        this.errorMessage = null;
      };
      reader.readAsDataURL(file);
    } else {
      this.coverImage = null;
      this.errorMessage = 'Please upload a valid image file.';
    }
  }

  triggerFileInput(): void {
    if (typeof document !== 'undefined') {
      document.getElementById('coverImageInput')?.click();
    }
  }

  removeCoverImage(): void {
    this.coverImage = null;
  }

  openMenu(): void {
    this.isOpenTopMenu = true;
  }

  closeMenu(): void {
    this.isOpenTopMenu = false;
  }

  setProductLabels(event: any) {
    this.selectedTags.set(event);
    this.publishForm
      .get('tags')
      ?.setValue(event.map((t: { label: string }) => t.label));
  }

  // Tag autocomplete methods
  get filteredTags(): ITag[] {
    const term = this.tagSearchTerm().toLowerCase();
    const allTags = this.tagsStore.items();

    // Always filter out already selected tags
    const availableTags = allTags.filter(
      (tag) => !this.selectedTags().find((st) => st.label === tag.label)
    );

    // If no search term, return all available (non-selected) tags
    if (!term) return availableTags;

    // Filter by search term
    return availableTags.filter((tag) =>
      tag.label.toLowerCase().includes(term)
    );
  }

  onTagSearchInput(event: any): void {
    this.tagSearchTerm.set(event.target.value);
    this.showTagDropdown.set(true);
  }

  onTagSearchFocus(): void {
    // Load tags for current content type if not already loaded
    const slug = this.contentTypeSlug || this.paramContentType || '';
    if (slug && this.tagsStore.getContentTypeSlug() !== slug) {
      this.tagsStore.setContentTypeSlug(slug);
      this.tagsStore.getAll({
        limitCount: 100,
        currentPageNumber: 0,
        previousPageNumber: -1,
      });
      // Update used colors after tags load
      setTimeout(() => this.tagsStore.updateUsedColors(), 500);
    }
    this.showTagDropdown.set(true);
  }

  onTagSearchBlur(): void {
    // Delay to allow click on dropdown items
    setTimeout(() => this.showTagDropdown.set(false), 200);
  }

  selectTag(tag: ITag): void {
    // Don't add if already selected
    if (this.selectedTags().find((t) => t.label === tag.label)) return;

    this.selectedTags.update(tags => [...tags, { label: tag.label, color: tag.color }]);
    this.publishForm
      .get('tags')
      ?.setValue(this.selectedTags().map((t) => t.label));
    this.tagSearchTerm.set('');
    this.showTagDropdown.set(false);
  }

  removeTag(tag: { label: string; color: string }): void {
    this.selectedTags.update(tags => tags.filter((t) => t.label !== tag.label));
    this.publishForm
      .get('tags')
      ?.setValue(this.selectedTags().map((t) => t.label));
    this.triggerAutoSave();
  }

  async createInlineTag(): Promise<void> {
    const label = this.tagSearchTerm().trim();
    if (!label) return;

    // Check if already exists
    const existing = this.tagsStore.getTagByLabel(label);
    if (existing) {
      this.selectTag(existing);
      return;
    }

    // Create new tag with auto-assigned color
    const { color } = this.tagsStore.addTagWithAutoColor(label);
    const slug = this.contentTypeSlug || this.paramContentType || '';

    const newTag = {
      id: '',
      label,
      color,
      contentTypeSlug: slug,
      usageCount: 1,
    } as ITag;

    this.tagsStore.add(newTag).subscribe({
      next: () => {
        this.selectedTags.update(tags => [...tags, { label, color }]);
        this.publishForm
          .get('tags')
          ?.setValue(this.selectedTags().map((t) => t.label));
        this.tagSearchTerm.set('');
        this.showTagDropdown.set(false);
      },
      error: (error) => {
        console.error('Error creating tag:', error);
        this.toastService.error('Failed to create tag. Please try again.');
      },
    });
  }

  hasMatchingTag(): boolean {
    const term = this.tagSearchTerm().toLowerCase();
    if (!term) return true;
    return (
      this.filteredTags.length > 0 ||
      this.selectedTags().some((t) => t.label.toLowerCase() === term)
    );
  }

  // Next Content Methods

  /**
   * Get filtered contents based on search term
   */
  get filteredNextContents(): IDraftContents[] {
    const term = this.nextContentSearchTerm().toLowerCase();
    if (!term) return this.availableContents;
    return this.availableContents.filter(
      (content) =>
        content.title?.toLowerCase().includes(term) ||
        content.metaDescription?.toLowerCase().includes(term)
    );
  }

  /**
   * Load available contents for the current content type
   */
  async loadAvailableContents(): Promise<void> {
    const contentType = this.contentTypeSlug || this.paramContentType || '';
    if (!contentType) return;

    this.isLoadingContents = true;
    try {
      this.availableContents = await this.draftContentStore.getContentsByType(
        contentType,
        this._contentId // Exclude current content
      );
    } catch (error) {
      console.error('Error loading available contents:', error);
      this.availableContents = [];
    } finally {
      this.isLoadingContents = false;
      this.cdr.detectChanges();
    }
  }

  /**
   * Handle next content search input
   */
  onNextContentSearchInput(event: any): void {
    this.nextContentSearchTerm.set(event.target.value);
    this.showNextContentDropdown.set(true);
  }

  /**
   * Handle focus on next content search
   */
  onNextContentSearchFocus(): void {
    // Load contents if not already loaded
    if (this.availableContents.length === 0) {
      this.loadAvailableContents();
    }
    this.showNextContentDropdown.set(true);
  }

  /**
   * Handle blur on next content search
   */
  onNextContentSearchBlur(): void {
    // Delay to allow click on dropdown items
    setTimeout(() => this.showNextContentDropdown.set(false), 200);
  }

  /**
   * Select a content as the next content
   */
  selectNextContent(content: IDraftContents): void {
    this.selectedNextContent = {
      id: content.id,
      title: content.title || '',
      summary: content.metaDescription || '',
      slug: content.urlSlug || ''
    };
    this.nextContentSearchTerm.set('');
    this.showNextContentDropdown.set(false);
    this.cdr.detectChanges();
  }

  /**
   * Remove the selected next content
   */
  removeNextContent(): void {
    this.selectedNextContent = null;
    this.cdr.detectChanges();
  }

  public saveAsDraft(afterSave?: () => void) {
    this.publishForm.get('title')?.setValue(this.pageTitle);
    this.publishForm.get('coverImage')?.setValue(this.coverImage);

    // Validate for draft: only title is required
    const validation = this.validateForDraft();
    if (!validation.valid) {
      this.toastService.openCustomSnackbar(
        validation.errors[0],
        'error',
        'error'
      );
      return;
    }

    // Get the content type from slug or form
    const contentType =
      this.contentTypeSlug || this.publishForm.get('type')?.value || '';
    const urlSlug = this.publishForm.get('urlSlug')?.value || '';

    // Check for duplicate URL slug (excluding current item if editing)
    if (urlSlug && !this.validateSlugUniqueness(urlSlug)) {
      return;
    }

    const formValues: any = {
      ...this.publishForm.value,
      ...this.seoForm.value,
      type: contentType,
      status: this.constantVariables.DRAFT,
      updatedAt: new Date(),
      customFields: this.customFieldValues,
      nextContent: this.selectedNextContent,
      summary: this.publishForm.get('summary')?.value || '',
      tagsWithColors: this.selectedTags().map(t => ({ name: t.label, color: t.color })),
    };

    // Only add createdAt for new items
    if (!this.contentId) {
      formValues.createdAt = new Date();
    }

    this.isSavingDraft = true;
    this.saveStatusMessage = 'Saving draft...';
    this.saveStatusType = 'info';

    // Handle Previous Content Linking
    if (this.selectedNextContent) {
      this.updatePreviousContentLink(this.selectedNextContent.id, formValues);
    }

    // If we have a contentId, it's an update; otherwise it's a new item
    if (this.contentId) {
      this.updateContentInDraft(formValues, undefined, afterSave);
    } else {
      this.addContentInDraft(formValues, false, afterSave);
    }
  }

  public directPublishContent() {
    this.publishForm.get('title')?.setValue(this.pageTitle);
    this.publishForm.get('coverImage')?.setValue(this.coverImage || null);

    // Validate for publish: all mandatory fields required
    const validation = this.validateForPublish();
    if (!validation.valid) {
      // Show first error - user can fix and try again
      this.toastService.openCustomSnackbar(
        validation.errors[0],
        'error',
        'error'
      );
      return;
    }

    // Get the content type from slug or form
    const contentType =
      this.contentTypeSlug || this.publishForm.get('type')?.value || '';
    const urlSlug = this.publishForm.get('urlSlug')?.value || '';

    // Check for duplicate URL slug (excluding current item if editing)
    if (urlSlug && !this.validateSlugUniqueness(urlSlug)) {
      return;
    }

    // Preserve publishedOn from existing content; only set on first publish.
    const existingPublishedOn = this.contentId
      ? this.draftContentStore.currentItem()?.publishedOn
      : null;

    const formValues: any = {
      ...this.publishForm.value,
      ...this.seoForm.value,
      type: contentType,
      status: this.constantVariables.PUBLISH,
      publishedOn: existingPublishedOn || new Date(),
      publishedStatus: true,
      updatedAt: new Date(),
      customFields: this.customFieldValues,
      nextContent: this.selectedNextContent,
      summary: this.publishForm.get('summary')?.value || '',
      tagsWithColors: this.selectedTags().map(t => ({ name: t.label, color: t.color })),
    };

    // Only add createdAt for new items
    if (!this.contentId) {
      formValues.createdAt = new Date();
    }

    this.isSavingDraft = true;
    this.saveStatusMessage = 'Publishing content...';
    this.saveStatusType = 'info';

    // If we have a contentId, it's an update; otherwise it's a new item
    if (this.contentId) {
      this.updateContentInDraft(formValues, this.constantVariables.PUBLISH);
    } else {
      this.addContentInDraft(formValues, true);
    }
  }

  /**
   * Validate URL slug uniqueness
   * Returns true if slug is unique (or belongs to current item), false if duplicate
   */
  private validateSlugUniqueness(urlSlug: string): boolean {
    const allContents = this.draftContentStore.items();
    const duplicate = allContents.find(
      (item: any) => item.urlSlug === urlSlug && item.id !== this.contentId
    );

    if (duplicate) {
      this.isSavingDraft = false;
      this.saveStatusMessage = `URL slug "${urlSlug}" already exists.Please use a different slug.`;
      this.saveStatusType = 'error';
      this.errorSlug = true;
      this.toastService.error(
        `URL slug "${urlSlug}" already exists.Please use a different slug.`
      );
      this.cdr.detectChanges();
      return false;
    }

    this.errorSlug = false;
    return true;
  }

  private addContentInDraft(formValues: any, isPublish: boolean = false, afterSave?: () => void) {
    this.draftContentStore.add(formValues, this.contentTypeSlug).subscribe({
      next: (newId: string) => {
        this.ngZone.run(() => {
          if (newId) {
            // The store's add() method returns the ID string directly
            this.contentId = newId;
            this.lastDraftSavedDate = new Date();

            // Enqueue publish action so the Cloud Function syncs to the published collection
            if (isPublish) {
              this.publishQueueService.enqueue('publish', this.contentTypeSlug, newId);
              this.startDeployStatusPolling(newId);
            }

            this.saveStatusMessage = isPublish
              ? 'Content published successfully!'
              : 'Draft saved successfully!';
            this.saveStatusType = 'success';
            this.isSavingDraft = false;
            this.cdr.detectChanges();

            if (afterSave) {
              afterSave();
            }

            // Auto-hide status after 3 seconds
            setTimeout(() => {
              this.saveStatusMessage = '';
              this.cdr.detectChanges();
            }, 3000);
          }
        });
      },
      error: (error) => {
        this.ngZone.run(() => {
          this.isSavingDraft = false;
          this.saveStatusMessage = 'Error saving content. Please try again.';
          this.saveStatusType = 'error';
          console.error('Error saving draft:', error);
          this.cdr.detectChanges();
        });
      },
    });
  }

  private updateContentInDraft(formValues: any, type?: string, afterSave?: () => void) {
    // Update updatedAt timestamp
    formValues.updatedAt = new Date();

    this.draftContentStore.update(this.contentId, formValues, this.contentTypeSlug).subscribe({
      next: () => {
        this.ngZone.run(async () => {
          this.lastDraftSavedDate = new Date();

          // Enqueue publish action so the Cloud Function syncs to the published collection
          if (type === this.constantVariables.PUBLISH) {
            this.publishQueueService.enqueue('publish', this.contentTypeSlug, this.contentId);
            this.startDeployStatusPolling(this.contentId);
          }

          // Trigger cascading updates for content that references this one
          await this.updateReferencingContents(formValues);
          await this.triggerCollectionRefSync(formValues);

          this.saveStatusMessage =
            type === this.constantVariables.PUBLISH
              ? 'Content published successfully!'
              : 'Draft updated successfully!';
          this.saveStatusType = 'success';
          this.isSavingDraft = false;
          this.cdr.detectChanges();

          if (afterSave) {
            afterSave();
          }

          // Auto-hide status after 3 seconds
          setTimeout(() => {
            this.saveStatusMessage = '';
            this.cdr.detectChanges();
          }, 3000);
        });
      },
      error: (error) => {
        this.ngZone.run(() => {
          this.isSavingDraft = false;
          this.saveStatusMessage = 'Error updating content. Please try again.';
          this.saveStatusType = 'error';
          console.error('Error updating draft:', error);
          this.cdr.detectChanges();
        });
      },
    });
  }

  /**
   * Build draft form values without side effects. Used by both manual save and auto-save.
   */
  private buildDraftFormValues(): any {
    this.publishForm.get('title')?.setValue(this.pageTitle);
    this.publishForm.get('coverImage')?.setValue(this.coverImage || null);

    const contentType =
      this.contentTypeSlug || this.publishForm.get('type')?.value || '';

    return {
      ...this.publishForm.value,
      ...this.seoForm.value,
      type: contentType,
      status: this.constantVariables.DRAFT,
      updatedAt: new Date(),
      customFields: this.customFieldValues,
      nextContent: this.selectedNextContent,
      summary: this.publishForm.get('summary')?.value || '',
      tagsWithColors: this.selectedTags().map(t => ({ name: t.label, color: t.color })),
    };
  }

  /**
   * Perform an auto-save of the current draft content.
   * Silent save — no navigation, no publish, minimal UI feedback.
   */
  private performAutoSave(): void {
    if (!this.contentId || this.isSavingDraft || this.isAutoSaving) return;

    const formValues = this.buildDraftFormValues();
    this.isAutoSaving = true;
    this.saveStatusMessage = 'Auto-saving...';
    this.saveStatusType = 'info';
    this.cdr.detectChanges();

    this.draftContentStore.update(this.contentId, formValues, this.contentTypeSlug).subscribe({
      next: () => {
        this.ngZone.run(() => {
          this.lastDraftSavedDate = new Date();
          this.saveStatusMessage = 'Auto-saved';
          this.saveStatusType = 'success';
          this.isAutoSaving = false;
          this.cdr.detectChanges();

          setTimeout(() => {
            if (this.saveStatusMessage === 'Auto-saved') {
              this.saveStatusMessage = '';
              this.cdr.detectChanges();
            }
          }, 3000);
        });
      },
      error: (error) => {
        this.ngZone.run(() => {
          this.isAutoSaving = false;
          this.saveStatusMessage = 'Auto-save failed';
          this.saveStatusType = 'error';
          console.error('Auto-save error:', error);
          this.cdr.detectChanges();

          setTimeout(() => {
            if (this.saveStatusMessage === 'Auto-save failed') {
              this.saveStatusMessage = '';
              this.cdr.detectChanges();
            }
          }, 5000);
        });
      },
    });
  }

  /**
   * Trigger the auto-save debounce timer.
   * Call this from any content change event (editor, form fields, tags, etc.)
   */
  public triggerAutoSave(): void {
    this.autoSaveTrigger$.next();
  }

  /**
   * Start polling the published document for deployment status after a publish action.
   * Shows real-time feedback about whether the static HTML deployment succeeded or failed.
   */
  private startDeployStatusPolling(docId: string): void {
    // Clean up any existing subscription
    this.deployStatusSubscription?.unsubscribe();

    this.deployStatus.set('pending');
    this.deployError.set('');

    this.deployStatusSubscription = this.contentsService
      .pollDeployStatus(docId, this.contentTypeSlug)
      .subscribe({
        next: (status) => {
          this.ngZone.run(() => {
            this.deployStatus.set(status.deployStatus);
            this.deployError.set(status.deployError || '');

            if (status.deployStatus === 'deployed') {
              this.toastService.openCustomSnackbar(
                'Static page deployed successfully!',
                'success',
                'check_circle'
              );
            } else if (status.deployStatus === 'failed') {
              this.toastService.openCustomSnackbar(
                `Deployment failed: ${status.deployError || 'Unknown error'}`,
                'error',
                'error'
              );
            }

            this.cdr.detectChanges();
          });
        },
        error: (err) => {
          console.error('Deploy status polling error:', err);
          this.deployStatus.set(null);
        },
      });
  }

  /**
   * Retry a failed deployment by re-enqueuing the publish action.
   */
  public retryDeployment(): void {
    if (!this.contentId || !this.contentTypeSlug) return;
    this.publishQueueService.enqueue('publish', this.contentTypeSlug, this.contentId);
    this.startDeployStatusPolling(this.contentId);
  }

  /**
   * Trigger sync for collection references
   */
  private async triggerCollectionRefSync(formValues: any): Promise<void> {
    const contentType = this.contentTypeSlug || formValues.type;
    if (!contentType) return;

    try {
        await this.collectionRefSyncService.syncReferencedData(
            contentType,
            this.contentId,
            formValues,
            this.contentDetailedData() // Pass original data for optimization
        );
    } catch (error) {
        console.error('Error syncing collection references:', error);
        // Non-blocking
    }
  }

  /**
   * Update all content items that reference this content as their nextContent
   * Called when title, summary (metaDescription), or slug changes
   */
  private async updateReferencingContents(formValues: any): Promise<void> {
    try {
      const title = formValues.title || this.pageTitle || '';
      const summary = formValues.metaDescription || '';
      const slug = formValues.urlSlug || '';

      await this.draftContentStore.updateNextContentReferences(
        this.contentId,
        { title, summary, slug },
        this.contentTypeSlug
      );
    } catch (error) {
      console.error('Error updating referencing contents:', error);
      // Don't block the save operation on cascading update failure
    }
  }

  public navigateBySlug() {
    this.saveAsDraft(() => {
      const slug = this.publishForm.get('urlSlug')?.value;
      const contentType = this.contentTypeSlug || this.publishForm.get('type')?.value;
      
      if (slug && contentType) {
        const url = `/${contentType}/${slug}?preview=true`;
        window.open(url, '_blank');
      }
    });
  }

  isEmpty(obj: any): boolean {
    return Object.keys(obj).length === 0;
  }

  onTypeChange(event: any) {
    if (!event.target.value) return;
    this.publishForm.get('type')?.setValue(event.target.value);
  }

  removeTagFromCross(tag: any) {
    const currentTags: string[] = this.publishForm.value.tags;
    const updatedTags = currentTags.filter((item: string) => item !== tag);
    this.publishForm.patchValue({ tags: updatedTags });
  }

  /**
   * Get the content type name from the slug (uses singular name for add/edit screens)
   */
  getContentTypeName(): string {
    const slug =
      this.contentTypeSlug ||
      this.paramContentType ||
      this.publishForm?.get('type')?.value;
    if (!slug) return '';

    const contentTypes = this.contentTypeStore.items();
    const found = contentTypes.find((ct: ContentType) => ct.slug === slug);
    if (found) {
      // Prefer explicit singular name, fall back to auto-singularized name
      return found.singularName || this.singularize(found.name) || this.formatSlugAsName(slug);
    }
    return this.formatSlugAsName(slug);
  }

  /**
   * Convert a plural word to singular using common English rules
   */
  private singularize(word: string): string {
    if (!word) return '';

    // Words ending in 'ies' -> 'y' (e.g., Articles -> doesn't apply, but Categories -> Category)
    if (/ies$/i.test(word)) {
      return word.slice(0, -3) + 'y';
    }

    // Words ending in 'es' after s, x, z, ch, sh -> remove 'es' (e.g., Boxes -> Box)
    if (/(?:s|x|z|ch|sh)es$/i.test(word)) {
      return word.slice(0, -2);
    }

    // Words ending in 's' -> remove 's' (e.g., Articles -> Article)
    if (/s$/i.test(word) && !/ss$/i.test(word)) {
      return word.slice(0, -1);
    }

    return word;
  }

  /**
   * Format a slug as a readable name (e.g., "articles1" -> "Articles1")
   */
  private formatSlugAsName(slug: string): string {
    if (!slug) return '';
    return slug.charAt(0).toUpperCase() + slug.slice(1);
  }

  /**
 * Opens the Media Manager modal for selecting cover image
 */
  openMediaManager(): void {
    const dialogRef = this.dialog.open(MediaManagerComponent, {
      enterAnimationDuration: '450ms',
      exitAnimationDuration: '300ms',
      minWidth: '134vh',
      maxHeight: '90vh',
      panelClass: 'common-dialog-box',
      disableClose: true,
      data: {
        isDialogOpen: true,
      },
    });

    dialogRef.afterClosed().subscribe((result: { mediaUrl: string; type: string } | null) => {
      if (result && result.type === 'submit' && result.mediaUrl) {
        this.coverImage = result.mediaUrl;
        this.publishForm.get('coverImage')?.setValue(result.mediaUrl);
        this.errorMessage = null;
        this.cdr.detectChanges();
      }
    });
  }
  private updatePreviousContentLink(nextContentId: string, currentContent: any): void {
    const previousContentRef: INextContentReference = {
      id: this.contentId || 'temp-id',
      title: currentContent.title,
      summary: currentContent.summary || '',
      slug: currentContent.urlSlug
    };

    this.draftContentStore.update(nextContentId, { previousContent: previousContentRef }, this.contentTypeSlug).subscribe({
      error: (e) => console.error('Failed to update previous content link', e)
    });
  }

  /**
   * Copy the full URL to clipboard
   */
  async copyUrlToClipboard(): Promise<void> {
    const urlSlug = this.publishForm.get('urlSlug')?.value || '';
    const fullUrl = `${this.domain}${this.contentTypeSlug}/${urlSlug}`;

    const success = await this.globalService.copyToClipboard(fullUrl);
    if (success) {
      this.toastService.openCustomSnackbar('URL copied to clipboard', 'success', 'check_circle');
    } else {
      this.toastService.openCustomSnackbar('Failed to copy URL', 'error', 'error');
    }
  }

  /** Open version preview in the main editor area */
  previewVersion(version: VersionHistoryItem): void {
    this.previewingVersion.set(version);
  }

  /** Close the version preview and return to the editor */
  closeVersionPreview(): void {
    this.previewingVersion.set(null);
  }

  /** Get sanitized HTML for version preview */
  getPreviewSafeHtml(content: string): SafeHtml {
    return this.sanitizer.bypassSecurityTrustHtml(content || '');
  }

  /** Format a Firestore timestamp or Date for display */
  formatVersionDate(date: any): string {
    if (!date) return '';
    const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
    if (isNaN(dateObj.getTime())) return '';
    return dateObj.toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  /**
   * Restore a historical version by copying its fields into the current draft form.
   * Does NOT auto-publish — the user must review and manually save/publish.
   */
  restoreVersion(version: VersionHistoryItem): void {
    const confirmed = window.confirm(
      'This will overwrite your current draft with this version. Any unsaved changes will be lost. Continue?'
    );
    if (!confirmed) return;

    // Restore title
    if (version.title) {
      this.pageTitle = version.title;
    }

    // Restore content body
    if (version.content) {
      this.publishForm.patchValue({ content: version.content });
    }

    // Restore cover image
    if (version.coverImage !== undefined) {
      this.coverImage = version.coverImage || '';
    }

    // Restore tags
    if (version.tagsWithColors?.length) {
      const restoredTags = version.tagsWithColors.map(t => ({ label: t.name, color: t.color }));
      this.selectedTags.set(restoredTags);
    } else if (version.tags?.length) {
      const restoredTags = version.tags.map(t => ({ label: t, color: '#6c757d' }));
      this.selectedTags.set(restoredTags);
    }

    // Restore SEO fields
    if (version.seoTitle !== undefined || version.metaDescription !== undefined) {
      this.seoForm.patchValue({
        seoTitle: version.seoTitle || '',
        metaDescription: version.metaDescription || '',
      });
    }

    // Restore custom fields
    if (version.customFields) {
      this.customFieldValues = { ...version.customFields };
    }

    // Close the version preview and switch to basic tab so user sees the restored content
    this.previewingVersion.set(null);
    this.activeTab = 'basic';

    this.toastService.openCustomSnackbar(
      `Restored version v${version.versionNumber}. Review and save when ready.`,
      'success',
      'check_circle'
    );

    // Trigger auto-save for the restored content
    this.triggerAutoSave();
  }

  ngOnDestroy(): void {
    this.deployStatusSubscription?.unsubscribe();
    this.autoSaveSubscription?.unsubscribe();
  }
}
