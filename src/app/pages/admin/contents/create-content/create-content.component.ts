import { parseHexColor } from '../../../../../shared/utils/color';
import { nextUrlSlug, toUrlSlug } from '../../../../../shared/utils/url-slug';
import { authorCanonicalUrl } from '../../../../../shared/utils/canonical-url';
import { SiteIdentityService } from '../../../../core/services/site-identity.service';
import { ArcTimePipe } from '../../../../core/time/arc-time.pipe';
import { ImageSize } from '../../../../../shared/utils/image-sizes';
import { inject, computed, Component, ChangeDetectorRef, effect, HostListener, Input, ViewChild, AfterViewInit, signal, NgZone, afterNextRender, Injector, untracked, runInInjectionContext } from '@angular/core';
import { TranslationKey } from '../../../../core/i18n/translation-keys';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { FormBuilder, FormControl, FormGroup, FormsModule, ReactiveFormsModule } from '@angular/forms';
import { CommonModule, formatDate } from '@angular/common';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { IDraftContents, INextContentReference } from '../draft-content-store/draft-contents.model';
import { isRealId, linkedId, seriesReference } from '../draft-content-store/series-links';
import { ActivatedRoute, NavigationCancel, ParamMap, Router, RouterLink } from '@angular/router';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { DraftContentsStore } from '../draft-content-store/draft-contents.store';
import { ContentTypesStore } from '../content-types/content-types.store';
import { ContentType, ContentTypeField, contentTypeFieldLabel } from '../content-types/content-types.model';
import TiptapEditorComponent from '../../../../../shared/components/tiptap-editor/tiptap-editor.component';
import { FieldPlaces, fieldSummary, isPlaceable } from '../../../../../shared/components/tiptap-editor/service/field-place';
import { TagsStore } from '../content-types/tags/tags.store';
import { ITag } from '../content-types/tags/tags.model';
import MediaManagerComponent, { MediaSelection } from '../../(media)/media.page';
import { mediaPickerDialogConfig } from '../../(media)/media-picker-dialog';
import { fileMeta, MEDIA_FILE_TYPE_ICONS, MediaFileRef, toFileRows } from '../../../../../shared/utils/media-files';
import { bodyExcerpt } from '../../../../../shared/utils/summary-text';
import { ArcIcon, isArcIcon } from '../../../../../shared/models/icon.model';
import { FieldRepeaterComponent } from '../../../../../shared/components/field-repeater/field-repeater.component';
import { ResizableDirective } from '../../../../../shared/directives/resizable/resizable.directive';
import { SiteDriftNoticeComponent } from '../site-drift-notice/site-drift-notice.component';
import { normalizeRepeaterRows, prepareRepeaterRowsForSave, RepeaterRow, RepeaterSchema, repeaterHeadingKey, repeaterSchema, sortRepeaterRows } from '../../../../../shared/models/repeater.model';
import { MatDialog } from '@angular/material/dialog';
import { getDocs, query, limit } from '@angular/fire/firestore';
import { ContentsService } from '../content-store/published-contents.service';
import { FullscreenEditorDialogComponent } from './fullscreen-editor-dialog/fullscreen-editor-dialog.component';
import { Subscription, firstValueFrom } from 'rxjs';
import { filter, switchMap } from 'rxjs/operators';
import { VersionHistoryComponent, VersionHistoryItem } from './version-history/version-history.component';
import { AuthorsService } from '../../(authors)/authors.service';
import { IAuthor } from '../../../../../shared/models/author.model';
import { IReference, cleanReferences } from '../../../../../shared/models/references.model';
import { ChecklistReport, evaluateDiscoverability } from '../../../../../shared/utils/discoverability-checklist';
import { SearchService } from '../../../../core/services/search.service';
import { SearchResult } from '../../../../../shared/models/search.model';
import { IContentTranslation, isTranslatableField, translatableRepeaterKeys } from '../draft-content-store/content-translation.model';
import { isOn } from '../../../../core/features/features';
import { PreviewMessage } from '../../../../core/preview/preview-channel';
import { layoutLabel, siteLayouts } from '../../../../core/site/site';
import { EntryDraftSession, EntryDraftView, TranslatableValues, isEmptyFieldValue } from '../draft-content-store/entry-draft-session';
import { SiteLook, SiteLookService } from '../../../../core/site/site-look.service';
import { SiteLookViewComponent } from '../../../../core/site/site-look-view';
import { inSentence } from '../../../../core/utils/in-sentence';

/** A text field holding an address, by its key (`download_url`, `cta_link`): its placeholder is an example address. */
const LINK_FIELD_KEY = /(^|[_-])(url|link|href|website)$/i;

export { AUTO_SAVE_DELAY_MS, addressFromTitle } from '../draft-content-store/entry-draft-session';

/**
 * Firestore date-ish value → 'YYYY-MM-DD' for an <input type="date">, or ''.
 * Local calendar date, matching what the author picked.
 */
export function toDateInputValue(value: unknown): string {
  if (!value) return '';
  const date = (value as { seconds?: number })?.seconds !== undefined
    ? new Date((value as { seconds: number }).seconds * 1000)
    : typeof (value as { toDate?: unknown })?.toDate === 'function'
      ? (value as { toDate: () => Date }).toDate()
      : new Date(value as string | number | Date);
  if (isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * A date custom field's value for an <input type="date">: the day of a stored
 * 'YYYY-MM-DD' or (from before date fields asked for a day only)
 * 'YYYY-MM-DDTHH:mm', read as written so no time zone moves it.
 */
export function customDateValue(value: unknown): string {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return toDateInputValue(value);
}

/** 'YYYY-MM-DD' → Date at local midnight, or null for blank/invalid. */
export function fromDateInputValue(value: unknown): Date | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  // JS rolls "2025-13-45" forward instead of failing; insist on a round trip.
  const valid = date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d;
  return valid ? date : null;
}

function escapeHtml(text: string): string {
  return (text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}

/** The cover doubles as the social-share image, so its picker opens at full size. */
const COVER_IMAGE_SIZE: ImageSize = 'xl';

/** What the edit-on-page screen does for the editor in page mode (VE-D26). */
export interface PageModeHooks {
  /** Shows and focuses a field on the page; false when the page does not show it. */
  reveal(key: string): boolean;
  /** Opens the Page settings panel. */
  openPanel(): void;
  /** An entry started on the page was written for the first time: the page shows its address (review H3). */
  stored?(id: string): void;
}

/** How long after the last title keystroke the address is checked with the server. */
export const SLUG_CHECK_DELAY_MS = 300;

@Component({
  selector: 'arc-create-content',
  standalone: true,
  imports: [
    CommonModule,
    ArcTimePipe,
    FormsModule,
    ReactiveFormsModule,
    TiptapEditorComponent,
    VersionHistoryComponent,
    TranslocoPipe,
    FieldRepeaterComponent,
    ResizableDirective,
    RouterLink,
    SiteDriftNoticeComponent,
    SiteLookViewComponent,
  ],
  // One entry's draft per editor (VE-D15).
  providers: [EntryDraftSession],
  templateUrl: './create-content.component.html',
  styleUrl: './create-content.component.scss',
})
export class CreateContentComponent extends BaseComponent {
  /** For the template: a date custom field's value for <input type="date">. */
  readonly customDateValue = customDateValue;

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

  public count = 0;
  
  // Service for fetching referenced content
  private siteIdentity = inject(SiteIdentityService);
  private contentsService = inject(ContentsService);
  /**
   * The entry being edited: loading, saving, the checks, translations,
   * publishing and the preview channel (specs/visual-editing-spec.md, VE-D15).
   * The form editor shows it and reads it back through draftView().
   */
  readonly session = inject(EntryDraftSession);

  // Save and publish state, kept by the session.
  get deployStatus() { return this.session.deployStatus; }
  get deployError() { return this.session.deployError; }
  get creating() { return this.session.creating; }
  get entryGone() { return this.session.entryGone; }
  get entryChanged() { return this.session.entryChanged; }
  get saveFailed() { return this.session.saveFailed; }
  get offline() { return this.session.offline; }
  get publishedSlug() { return this.session.publishedSlug; }
  get redirectOldAddress() { return this.session.redirectOldAddress; }
  get publishProblem() { return this.session.publishProblem; }
  get isSavingDraft(): boolean { return this.session.isSavingDraft; }
  get saveStatusMessage(): string { return this.session.saveStatusMessage; }
  get saveStatusType(): 'success' | 'error' | 'info' { return this.session.saveStatusType; }
  get lastDraftSavedDate(): Date | null { return this.session.lastDraftSavedDate; }
  get lastPublishedDate(): Date | null { return this.session.lastPublishedDate; }
  /** Links to the published version: the same id once published. */
  get publishedId(): string { return this.session.publishedId; }
  get errorSlug(): boolean { return this.session.errorSlug; }
  set errorSlug(value: boolean) { this.session.errorSlug = value; }
  /** A new entry's address follows its title until it is edited by hand or published. */
  private get slugFollowsTitle(): boolean { return this.session.slugFollowsTitle; }
  private set slugFollowsTitle(value: boolean) { this.session.slugFollowsTitle = value; }
  /** The address last found free on the server, or loaded with the entry. */
  private set confirmedSlug(value: string) { this.session.confirmedSlug = value; }

  /** Rich text fields whose first update after a load is the editor's echo, not an edit (RF4 review M7). */
  private pendingRichEchoes = new Set<string>();
  /** Title keystrokes: the address check waits for a pause (RF4 review L7). */
  private slugTimer: ReturnType<typeof setTimeout> | null = null;

  // Store loaded options for collection reference fields: { [fieldKey]: ContentItem[] }
  public referenceOptions = signal<{ [key: string]: any[] }>({});
  public loadingReferences = signal<boolean>(false);

  public pageTitle: string = '';
  currentDateTime: string = '';
  /**
   * The site's public address with a trailing slash: the Production URL
   * (Settings, About) once it has loaded, else the address the admin is open
   * on. Used for the page URL shown and copied, and the share preview.
   */
  public domain: string = '';
  /** The address the admin is open on, with a trailing slash. */
  private adminOrigin = '';
  public childCategories: any[] = [];

  publishForm!: FormGroup;
  seoForm!: FormGroup;

  // For Drag & Drop
  isDragging = false;
  coverImage: string | null = null;
  errorMessage: string | null = null;


  public isEditingSlug = signal<boolean>(false);
  private originalSlug: string = '';


  // For selecting tags
  isOpenTopMenu = false;
  selectedTags = signal<{ label: string; color: string }[]>([]);

  /** Authors for the picker (D2); the default is pre-filled on new content. */
  authors = signal<IAuthor[]>([]);

  /** Cited sources, edited as rows in the SEO tab (D-D11). Shared across languages. */
  references = signal<IReference[]>([]);
  private defaultAuthorId = '';
  tagSearchTerm = signal<string>('');
  showTagDropdown = signal<boolean>(false);
  tagsStore = inject(TagsStore);

  // Series links: the next and previous entries, picked from the same type
  selectedNextContent: INextContentReference | null = null;
  nextContentSearchTerm = signal<string>('');
  showNextContentDropdown = signal<boolean>(false);
  selectedPreviousContent: INextContentReference | null = null;
  previousContentSearchTerm = signal<string>('');
  showPreviousContentDropdown = signal<boolean>(false);
  /** The option the arrow keys are on in each picker's list. */
  nextContentActive = signal<number>(0);
  previousContentActive = signal<number>(0);
  availableContents: IDraftContents[] = [];
  isLoadingContents = false;

  paramContentType: string | null = null;
  activeTab: 'basic' | 'seo' | 'checks' | 'history' = 'basic';

  // ── Discoverability checks (specs/discoverability-spec.md, D-D13, D-D16) ──
  private searchService = inject(SearchService);
  @ViewChild(TiptapEditorComponent) private bodyEditor?: TiptapEditorComponent;
  checklist = signal<ChecklistReport | null>(null);
  /** Link suggestions come from search; without the feature they are not offered. */
  readonly searchOn = isOn('search');
  linkSuggestions = signal<SearchResult[]>([]);
  linkSuggestionsLoading = signal(false);
  linkSuggestionsKey = '';

  // Version preview — when set, replaces the editor area with a read-only preview
  previewingVersion = signal<VersionHistoryItem | null>(null);
  private formsInitialized = false;

  // Custom fields support
  customFieldValues: { [key: string]: any } = {};

  // ── Translations (M2) ────────────────────────────────────────────────────
  // The editor edits one language at a time; the session keeps the others.
  private authorsService = inject(AuthorsService);

  /** Language currently being edited. Empty until the language list loads. */
  get activeLang() { return this.session.activeLang; }
  /** Codes this item already has a stored translation for: badges the tabs. */
  get translatedLanguages() { return this.session.translatedLanguages; }
  /** Unsaved edits exist for the active translation. */
  get translationDirty() { return this.session.translationDirty; }
  get isSavingTranslation() { return this.session.isSavingTranslation; }
  get enabledLanguages() { return this.session.enabledLanguages; }
  get defaultLang() { return this.session.defaultLang; }
  /** The language bar only appears once a second language is configured. */
  get showLanguageBar() { return this.session.showLanguageBar; }
  /** True when the forms hold a translation rather than the base document. */
  get isTranslating() { return this.session.isTranslating; }
  get activeLanguageLabel() { return this.session.activeLanguageLabel; }
  /** Default-language values, stashed while a translation is being edited. */
  private get baseStash(): TranslatableValues | null { return this.session.baseStash; }
  private set baseStash(values: TranslatableValues | null) { this.session.baseStash = values; }
  /** Languages whose edits are not yet persisted. */
  private get dirtyTranslations(): Set<string> { return this.session.dirtyTranslations; }

  /**
   * On the edit-on-page screen (specs/visual-editing-spec.md, VE-D26) this
   * editor is the Page settings panel: its side panel alone, with no top bar
   * and no title or body column, since those are edited on the page.
   */
  @Input() pageMode = false;
  /** What the edit-on-page screen does for fields on the page; null in the form editor. */
  @Input() pageHooks: PageModeHooks | null = null;

  // Input for content type slug from parent route
  @Input() set contentTypeSlug(value: string) {
    this.session.typeSlug.set(value);
  }
  get contentTypeSlug(): string {
    return this.session.typeSlug();
  }

  // Input for content ID from parent route (for editing)
  @Input() set contentId(value: string) {
    if (value && value !== this.session.contentId) {
      this.session.contentId = value;
      this.session.loadById(value);
      // The item is known now, so its existing translations can be badged.
      this.session.refreshTranslatedLanguages();
    }
  }
  get contentId(): string {
    return this.session.contentId;
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

  /** The stored item, refreshed after each save. The forms are filled from it by an effect (see the constructor). */
  contentDetailedData: any = computed(() => this.draftContentStore.currentItem());

  /** The automatic summary of the body last seen; the summary follows the body only while it equals this. */
  private previousExcerpt = '';
  /** The summary before its latest change; the meta description follows only while it equals this. */
  private previousSummary = '';


  // Computed property to get current content type with its fields
  currentContentType = computed(() => {
    const slug =
      this.session.typeSlug() ||
      this.paramContentType ||
      this.publishForm?.get('type')?.value;
    if (!slug) return null;
    const contentTypes = this.contentTypeStore.items();
    return contentTypes.find((ct: ContentType) => ct.slug === slug) || null;
  });

  /**
   * The layouts this type's template folder offers (specs/site-sections-spec.md,
   * SS8): other detail pages an entry can choose. Empty for most types, and then
   * the Layout picker is not shown.
   */
  layoutOptions = computed(() => siteLayouts(this.currentContentType()?.templateFolder)
    .map((name) => ({ name, label: layoutLabel(name) })));

  /** The Layout field's value, as a signal for the site look. */
  private chosenLayout = signal<string>('');
  private siteLookService = inject(SiteLookService);
  /**
   * The live page's look for the body (specs/editor-site-look-spec.md, ES2):
   * the template of this type and layout, in the language being edited. Null
   * until it is loaded, and when the template does not place the body.
   */
  bodyLook = signal<SiteLook | null>(null);
  /** The latest look asked for; an older answer arriving late is dropped. */
  private bodyLookRequest = 0;
  /**
   * Each rich text field's look, by key (ES3): where the template places the
   * field. A field the template does not place has none and keeps the editor's
   * own look.
   */
  fieldLooks = signal<Record<string, SiteLook | null>>({});
  private fieldLookRequest = 0;

  private translocoService = inject(TranslocoService);

  /**
   * The body's custom fields that can be placed in its text (VE-D28): `/` offers them,
   * and a placed field's card shows a few lines of it, with Edit jumping to it here.
   */
  readonly fieldPlaces: FieldPlaces = {
    fields: () => this.currentFields
      .filter((f) => !!f.key && isPlaceable(f.type))
      .map((f) => ({ key: f.key, label: this.fieldLabel(f), type: f.type })),
    open: (key) => this.focusField(key),
    summary: (key) => {
      const field = this.currentFields.find((f) => f.key === key);
      return field ? fieldSummary(field.type, this.customFieldValues[key]) : [];
    },
    translate: (key, params) => this.translocoService.translate(key, params),
    changes: (redraw) => {
      const sub = this.session.edited$.subscribe(redraw);
      return () => sub.unsubscribe();
    },
  };

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

  /**
   * What the native colour picker shows for a stored value. The picker only
   * understands `#rrggbb`, so shorthand is expanded and anything unparsable
   * (blank, or half-typed in the hex box) falls back to black.
   */
  colorPickerValue(value: unknown): string {
    return parseHexColor(value)?.hex ?? '#000000';
  }

  /** `rgb(…)` beside the hex box, or empty while the value is not a colour. */
  colorRgbText(value: unknown): string {
    return parseHexColor(value)?.rgb ?? '';
  }

  /** Open media manager for a custom image field; `title` is the field's name, the picker's heading. */
  openMediaManagerForField(fieldKey: string, title?: string): void {
    const dialogRef = this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({ isDialogOpen: true, title }));

    dialogRef.afterClosed().subscribe((result: MediaSelection | null) => {
      if (result && result.type === 'submit' && result.mediaUrl) {
        this.customFieldValues[fieldKey] = result.mediaUrl;
        this.cdr.detectChanges();
        this.triggerAutoSave();
      }
    });
  }

  /** The files of a `file` field: always a list (MF-D18), whatever was stored. */
  fieldFiles(fieldKey: string): MediaFileRef[] {
    return toFileRows(this.customFieldValues[fieldKey]);
  }

  readonly fileIcons = MEDIA_FILE_TYPE_ICONS;

  fileRowMeta(file: MediaFileRef): string {
    return fileMeta(file);
  }

  /**
   * Opens the Media Manager on its Files tab for a `file` field
   * (docs/features/content.html, File). `replace` swaps one file for
   * another; otherwise the picked files are added, or replace the one file
   * of a single-file field.
   */
  openFilePickerForField(field: { key: string; label?: string; multiple?: boolean }, replace?: number): void {
    const several = field.multiple === true && replace === undefined;
    const title = contentTypeFieldLabel(this.currentContentType(), field.key, field.label ?? '', this.activeLang());
    const dialogRef = this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({ isDialogOpen: true, allowFiles: true, allowImages: false, initialTab: 'files', multiple: several, title }));

    dialogRef.afterClosed().subscribe((result: MediaSelection | null) => {
      if (result?.type !== 'submit' || result.kind !== 'file') return;
      const picked = toFileRows(result.files ?? (result.file ? [result.file] : []));
      if (!picked.length) return;
      let rows = this.fieldFiles(field.key);
      if (replace !== undefined) {
        rows[replace] = picked[0];
      } else if (field.multiple) {
        const have = new Set(rows.map((r) => r.url));
        rows = [...rows, ...picked.filter((p) => !have.has(p.url))];
      } else {
        rows = [picked[0]];
      }
      this.customFieldValues[field.key] = rows;
      this.cdr.detectChanges();
      this.triggerAutoSave();
    });
  }

  removeFieldFile(fieldKey: string, index: number): void {
    const rows = this.fieldFiles(fieldKey);
    rows.splice(index, 1);
    this.customFieldValues[fieldKey] = rows;
    this.cdr.detectChanges();
    this.triggerAutoSave();
  }

  /** Moves a file up (-1) or down (1) in a several-files field. */
  moveFieldFile(fieldKey: string, index: number, step: -1 | 1): void {
    const rows = this.fieldFiles(fieldKey);
    const to = index + step;
    if (to < 0 || to >= rows.length) return;
    [rows[index], rows[to]] = [rows[to], rows[index]];
    this.customFieldValues[fieldKey] = rows;
    this.cdr.detectChanges();
    this.triggerAutoSave();
  }

  /**
   * Opens the Media Manager on its Icons tab for an `icon` field.
   *
   * Same dialog as an image field rather than a bespoke one: an admin who has
   * picked a cover image already knows this window, and the two field types
   * differ only in what they come back with.
   */
  openIconPickerForField(fieldKey: string, title?: string): void {
    // Icons only. With the image tabs shown, picking a photo here would
    // return a URL this field discards — the dialog would close having
    // silently done nothing.
    const dialogRef = this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({ isDialogOpen: true, allowIcons: true, allowImages: false, initialTab: 'icons', title }));

    dialogRef.afterClosed().subscribe((result: MediaSelection | null) => {
      if (result?.type === 'submit' && result.kind === 'icon' && result.icon) {
        this.customFieldValues[fieldKey] = result.icon;
        this.cdr.detectChanges();
        this.triggerAutoSave();
      }
    });
  }

  /** The stored icon token for a field, or null when nothing is picked. */
  getCustomFieldIcon(fieldKey: string): ArcIcon | null {
    const value = this.customFieldValues[fieldKey];
    return isArcIcon(value) ? value : null;
  }

  // ── Repeating fields (Info Cards, and the types built on the same base) ──

  /** The schema for a repeating field, or null for every other type. */
  repeaterSchemaFor(field: ContentTypeField): RepeaterSchema | null {
    return repeaterSchema(field.type);
  }

  /**
   * The rows of a repeating field.
   *
   * Called from the template, so it runs on every change-detection pass — and
   * must return the *same array* each time, or the child's input identity
   * changes on every pass and the row being edited re-renders under the
   * caret. Repairing once and storing the result back makes the second call
   * onwards a plain read.
   */
  repeaterRows(field: ContentTypeField): RepeaterRow[] {
    const schema = this.repeaterSchemaFor(field);
    if (!schema) return [];

    // On a translation tab `customFieldValues` holds only the translation —
    // for a repeating field, a sparse list of prose keyed by row id. The
    // editor has to show the default language's actual rows with that prose
    // laid over them, or a translator would face a list with no images and no
    // sense of which card is which.
    if (this.isTranslating()) {
      return this.translatedRepeaterRows(field, schema);
    }

    const current = this.customFieldValues[field.key];
    if (Array.isArray(current) && current.every((row) => typeof row?.id === 'string')) {
      return current;
    }

    // First read of a document, an import, or an older row shape. Sorted here
    // because this is the load — from now on order changes only when the
    // editor commits a position.
    const rows = sortRepeaterRows(normalizeRepeaterRows(current, schema));
    this.customFieldValues[field.key] = rows;
    return rows;
  }

  /**
   * Base rows with the active translation's prose overlaid, for display while
   * translating.
   *
   * Rebuilt on each change-detection pass rather than cached: unlike the
   * default-language path there is nowhere to store it — `customFieldValues`
   * has to keep holding the sparse translation, because that is what gets
   * saved.
   */
  private translatedRepeaterRows(field: ContentTypeField, schema: RepeaterSchema): RepeaterRow[] {
    const base = sortRepeaterRows(
      normalizeRepeaterRows(this.baseValues().customFields?.[field.key], schema),
    );

    const translated = Array.isArray(this.customFieldValues[field.key])
      ? (this.customFieldValues[field.key] as Record<string, unknown>[])
      : [];

    const byId = new Map<string, Record<string, unknown>>();
    for (const row of translated) {
      if (row && typeof row === 'object' && typeof row['id'] === 'string') {
        byId.set(row['id'] as string, row);
      }
    }

    const keys = translatableRepeaterKeys(field).filter((key) => key !== 'id');

    return base.map((row) => {
      const overlay = byId.get(row.id);

      // Prose starts *empty*, not seeded with the default language. A box
      // pre-filled with English reads as already translated, and saving it
      // would store English as the Hindi text. The original shows underneath
      // as a placeholder instead — the same treatment the built-in fields get.
      const merged: RepeaterRow = { ...row };
      for (const key of keys) {
        const value = overlay?.[key];
        merged[key] = typeof value === 'string' ? value : '';
      }
      return merged;
    });
  }

  /**
   * Default-language row values keyed by row id, so a translator sees the
   * original text as a ghost placeholder in every box they have not filled in.
   */
  baseRepeaterPlaceholders(field: ContentTypeField): Record<string, Record<string, unknown>> {
    if (!this.isTranslating()) return {};

    const schema = this.repeaterSchemaFor(field);
    if (!schema) return {};

    const placeholders: Record<string, Record<string, unknown>> = {};
    for (const row of normalizeRepeaterRows(this.baseValues().customFields?.[field.key], schema)) {
      placeholders[row.id] = row;
    }
    return placeholders;
  }

  /** The stored heading for a repeating field, or ''. */
  repeaterHeading(field: ContentTypeField): string {
    const schema = this.repeaterSchemaFor(field);
    if (!schema) return '';

    const key = repeaterHeadingKey(field.key, schema);
    const value = key ? this.customFieldValues[key] : '';
    return typeof value === 'string' ? value : '';
  }

  /** The default language's heading, shown as a placeholder while translating. */
  baseRepeaterHeading(field: ContentTypeField): string {
    const schema = this.repeaterSchemaFor(field);
    const key = schema ? repeaterHeadingKey(field.key, schema) : null;
    const value = key ? this.baseValues().customFields?.[key] : '';
    return typeof value === 'string' ? value : '';
  }

  /** Heading edits from `arc-field-repeater`. */
  onRepeaterHeadingChange(field: ContentTypeField, value: string): void {
    const schema = this.repeaterSchemaFor(field);
    const key = schema ? repeaterHeadingKey(field.key, schema) : null;
    if (!key) return;

    this.customFieldValues[key] = value;
    this.triggerAutoSave();
    this.cdr.detectChanges();
  }

  /** Row edits from `arc-field-repeater`. */
  onRepeaterRowsChange(fieldKey: string, rows: RepeaterRow[]): void {
    this.customFieldValues[fieldKey] = rows;
    this.triggerAutoSave();
    this.cdr.detectChanges();
  }

  /**
   * A copy of the custom field values safe to hand to a snapshot.
   *
   * A plain `{ ...customFieldValues }` shares every repeater array *and* every
   * row object with the live editor, so a version-history snapshot would
   * change under the reader as they kept typing. Scalars never had this
   * problem, which is why the shallow spread was fine until now.
   *
   * Repeater values are also prepared for storage here — sorted by position,
   * renumbered, and with abandoned blank rows dropped, since the editor adds
   * an empty row on demand and an unfilled one would publish as an empty card.
   * The page drawn on the Visual Editor keeps them, so a row just added there
   * shows to be typed in (VE-D33); a save never does.
   */
  private copyCustomFields(values: Record<string, any>): Record<string, any> {
    const copy: Record<string, any> = { ...values };
    const keepBlank = this.pageMode && this.session.drawingPage;

    for (const field of this.currentFields) {
      const schema = this.repeaterSchemaFor(field);
      if (!schema) continue;
      if (copy[field.key] === undefined) continue;
      copy[field.key] = prepareRepeaterRowsForSave(copy[field.key], schema, { keepBlank });
    }

    return copy;
  }

  /** Custom field values read from a document, draft or version snapshot. */
  private adoptCustomFields(values: Record<string, any> | undefined): Record<string, any> {
    const adopted: Record<string, any> = { ...(values ?? {}) };

    for (const field of this.currentFields) {
      const schema = this.repeaterSchemaFor(field);
      if (!schema) continue;
      adopted[field.key] = sortRepeaterRows(normalizeRepeaterRows(adopted[field.key], schema));
    }

    return adopted;
  }

  /**
   * Shapes the custom field values for the type's fields once the type is
   * known. The stored item can arrive before the content types do, and then
   * its repeating fields were adopted against no fields at all. Shaping is
   * not an edit, so an untouched item keeps reading as unchanged.
   */
  private adoptCustomFieldsForType(): void {
    if (this.isTranslating()) return;
    // Rows already shaped are left alone: new arrays would re-render the row
    // being edited (see repeaterRows).
    const unshaped = this.currentFields.some((field) => {
      const value = this.customFieldValues[field.key];
      return !!this.repeaterSchemaFor(field) && value !== undefined
        && !(Array.isArray(value) && value.every((row) => typeof row?.id === 'string'));
    });
    if (!unshaped) return;
    // Compared with the rows unshaped, as the baseline was signed before the
    // fields were known; hasUnsavedDraftChanges would shape them first.
    const untouched = this.session.isBaseline({ ...this.buildDraftFormValues(), customFields: { ...this.customFieldValues } });
    this.customFieldValues = this.adoptCustomFields(this.customFieldValues);
    if (untouched) this.captureDraftBaseline();
  }

  // Remove image for a custom field
  removeCustomFieldImage(fieldKey: string): void {
    this.customFieldValues[fieldKey] = null;
    this.cdr.detectChanges();
    this.triggerAutoSave();
  }

  // Handle rich text field content change from TiptapEditor
  onRichTextFieldChange(fieldKey: string, htmlContent: string): void {
    // The editor's first update after a load is it giving back the stored HTML
    // in its own form: part of loading, not an edit, so it neither saves nor
    // marks the entry edited (as the body's echo, awaitingBaselineCapture).
    if (this.pendingRichEchoes.delete(fieldKey)) {
      const clean = this.session.hasBaseline() && !this.isTranslating() && !this.hasUnsavedDraftChanges();
      this.customFieldValues[fieldKey] = htmlContent;
      if (clean) this.captureDraftBaseline();
      return;
    }
    this.customFieldValues[fieldKey] = htmlContent;
    this.triggerAutoSave();
  }

  /** The rich text fields of the type, whose next update is an echo of what was just put in them. */
  private expectRichEchoes(): void {
    this.pendingRichEchoes = new Set(this.currentFields.filter((f) => f.type === 'richtext').map((f) => f.key));
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
        siteLook: this.fieldLooks()[fieldKey] ?? null,
      },
    });

    dialogRef.afterClosed().subscribe((result: string | null) => {
      if (result !== null && result !== undefined) {
        this.customFieldValues[fieldKey] = result;
        this.cdr.detectChanges();
        this.triggerAutoSave();
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
    this.triggerAutoSave();
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
            // Published entries only: a draft has no page to link to. Read
            // unordered and sorted here, since the display field may be a
            // custom field, which a Firestore orderBy on the top level skips.
            const collectionRef = this.contentsService.getCollectionRef(field.collectionRef!.collectionSlug);
            const q = runInInjectionContext(this.injector, () => query(collectionRef, limit(1000)));

            const snapshot = await runInInjectionContext(this.injector, () => getDocs(q));
            const displayField = field.collectionRef!.displayField || 'title';
            const data = snapshot.docs
                .map(doc => referenceOption(doc.id, doc.data() as Record<string, any>))
                .sort((a, b) => String(a[displayField] ?? '').localeCompare(String(b[displayField] ?? '')));
            
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
    this.triggerAutoSave();
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
    this.triggerAutoSave();
  }

  /** Save: only the title is required (the session's rule, on the default language). */
  validateForDraft(): { valid: boolean; errors: string[]; missing: string[] } {
    return this.session.validateForDraft();
  }

  /** Publish: the title and every required custom field (the session's rule). */
  validateForPublish(): { valid: boolean; errors: string[]; missing: string[] } {
    return this.session.validateForPublish();
  }

  private isEmptyFieldValue(value: unknown): boolean {
    return isEmptyFieldValue(value);
  }

  /**
   * Required fields the last failed save flagged, by key (`title` for the
   * title). A flagged field is outlined only while it is still empty, so
   * filling it in clears the outline without another save attempt. Nothing
   * is outlined on a translation tab: the requirement is on the base document.
   */
  flaggedRequired = signal<Set<string>>(new Set());

  isRequiredMissing(key: string): boolean {
    if (this.isTranslating() || !this.flaggedRequired().has(key)) return false;
    if (key === 'title') return !this.pageTitle || this.pageTitle.trim() === '';
    return this.isEmptyFieldValue(this.customFieldValues[key]);
  }

  /**
   * Takes the editor to the first missing required field: back to the
   * default language (that is where the value must go), onto the Basic tab
   * for custom fields, then scrolls the field into view and focuses its
   * first focusable control — an input, or the button on a picker/repeater.
   */
  private async revealMissingRequired(missing: string[]): Promise<void> {
    this.flaggedRequired.set(new Set(missing));
    const first = missing[0];
    if (!first) return;

    if (this.isTranslating()) {
      await this.switchLanguage(this.defaultLang());
    }
    if (first !== 'title') {
      this.activeTab = 'basic';
    }
    // On the edit-on-page screen the page shows the field when it can, else the panel opens on it.
    if (this.pageHooks) {
      if (this.pageHooks.reveal(first)) return;
      this.pageHooks.openPanel();
    }

    // The tab or language switch above has to render before the field exists.
    setTimeout(() => {
      const wrapper = document.getElementById(`req-${first}`);
      if (!wrapper) return;
      wrapper.scrollIntoView?.({ behavior: 'smooth', block: 'center' });
      const control = wrapper.querySelector<HTMLElement>(
        'input:not([type="hidden"]):not([disabled]), select, textarea, [contenteditable="true"], button',
      );
      control?.focus({ preventScroll: true });
    });
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
    this.session.attach(this.draftView());
    // Fills the forms when the stored item arrives or is replaced, and at no
    // other time. patchForms reads other signals (sources, tags, authors, the
    // active language); tracking them would refill the forms from the stored
    // copy on every one of those edits. A save refreshes the stored item with
    // what this editor wrote; that is not a new item to load, and refilling
    // from it would drop anything typed while the save ran.
    effect(() => {
      const item = this.draftContentStore.currentItem();
      if (!this.session.isNewStoredItem(item)) return;
      untracked(() => this.patchForms(item));
      // A preview window left open for this entry carries on live (VE-D6).
      untracked(() => this.session.connectPreview());
    });

    // Reactive: Load references whenever the content type structure is available/changes
    effect(() => {
      const ct = this.currentContentType();
      if (ct) {
         // Use untracked to avoid loops if loadReferenceOptions modifies signals tracked here (it modifies loadingReferences and referenceOptions)
         untracked(() => {
             this.adoptCustomFieldsForType();
             this.loadReferenceOptions();
         });
      }
    });

    // The body's site look follows the type, the layout and the language being
    // edited. The look shown stays until the next one is ready (ES-D12).
    effect(() => {
      const contentType = this.currentContentType();
      const layout = this.chosenLayout();
      const lang = this.activeLang() || this.defaultLang();
      const request = ++this.bodyLookRequest;
      if (!contentType) {
        this.bodyLook.set(null);
        this.fieldLooks.set({});
        return;
      }
      void this.siteLookService.forField({
        folder: contentType.templateFolder,
        layout,
        typeSlug: contentType.slug,
        key: 'content',
        lang,
      }).then((look) => {
        if (request === this.bodyLookRequest) this.bodyLook.set(look);
      });

      // The rich text fields, each where the same template places it.
      const fieldRequest = ++this.fieldLookRequest;
      const keys = (contentType.fields || []).filter((field) => field.type === 'richtext').map((field) => field.key);
      void Promise.all(keys.map((key) => this.siteLookService.forField({
        folder: contentType.templateFolder,
        layout,
        typeSlug: contentType.slug,
        key,
        lang,
      }))).then((looks) => {
        if (fieldRequest === this.fieldLookRequest) {
          this.fieldLooks.set(Object.fromEntries(keys.map((key, i) => [key, looks[i]])));
        }
      });
    });

  }

  /** How the session reads and fills this editor: its forms and fields (VE-D15). */
  private draftView(): EntryDraftView {
    return {
      ready: () => !!this.publishForm && !!this.seoForm,
      formType: () => this.publishForm?.get('type')?.value || '',
      fields: () => this.currentFields,
      fieldLabel: (field) => this.fieldLabel(field),
      pageTitle: () => this.pageTitle,
      address: () => this.publishForm?.get('urlSlug')?.value || '',
      capture: () => this.captureTranslatableValues(),
      apply: (values) => this.applyTranslatableValues(values),
      prepareCustomFields: (values) => this.copyCustomFields(values),
      sharedValues: () => this.sharedDraftValues(),
      fill: (item) => this.fillForms(item),
      expectEchoes: () => {
        this.expectRichEchoes();
        // In page mode no body editor echoes the loaded body, so loading is settled now;
        // waiting would take the first edit on the page for the echo (VE-D26).
        if (this.pageMode) this.session.settleLoad();
      },
      echoesDone: () => this.pendingRichEchoes.clear(),
      revealMissing: (missing) => void this.revealMissingRequired(missing),
      entryCreated: (id) => this.pageHooks?.stored ? this.pageHooks.stored(id) : this.showEntryAddress(id),
      focusField: (key, row) => this.focusField(key, row),
      refresh: () => this.cdr.detectChanges(),
    };
  }

  ngAfterViewInit(): void {
    this.isToolbarInitialized = false;
    this.cdr.detectChanges();
  }

  ngOnInit() {
    if (typeof window !== 'undefined') {
      this.adminOrigin = window.location.origin + '/';
      this.domain = this.adminOrigin;
    }
    void this.loadPublicAddress();
    this.keepEntryAddress();
    this.fetchCurrentUrl();
    this.initLanguages();
    this.initAuthors();
  }

  /**
   * Loads the author list once and, for new content, pre-fills the default
   * author. Existing content keeps whatever it was saved with, including no
   * author at all.
   */
  private async initAuthors(): Promise<void> {
    if (typeof window === 'undefined') return;
    try {
      // Smart default: on a site with no authors the admin becomes the first
      // one here, so even the very first article gets a byline.
      await this.authorsService.ensureAdminAuthor();
      const [authors, settings] = await Promise.all([
        firstValueFrom(this.authorsService.list()),
        this.authorsService.loadSettings(),
      ]);
      this.authors.set(authors);
      this.defaultAuthorId = settings.defaultAuthorId;
      const control = this.publishForm.get('authorId');
      if (!this.contentId && control && !control.value && this.defaultAuthorId) {
        control.setValue(this.defaultAuthorId, { emitEvent: false });
      }
      this.cdr.detectChanges();
    } catch (error) {
      // No authors (or rules not deployed) must not break the editor.
      console.error('Error loading authors:', error);
    }
  }

  /** The denormalised name saved beside authorId. */
  private authorNameFor(authorId: string | null | undefined): string {
    if (!authorId) return '';
    return this.authors().find(a => a.id === authorId)?.name || '';
  }

  // ── Translation editing (M2) ─────────────────────────────────────────────
  // The stash and its rules are in the session; the forms hold whichever
  // language is on screen.

  /** Loads the site's language list and starts the editor on the default language. */
  private initLanguages(): Promise<void> {
    return this.session.initLanguages();
  }

  hasTranslation(code: string): boolean {
    return this.session.hasTranslation(code);
  }

  /** Reads the language-varying values out of the forms. */
  private captureTranslatableValues(): TranslatableValues {
    return {
      title: this.pageTitle || '',
      content: this.publishForm.get('content')?.value || '',
      summary: this.publishForm.get('summary')?.value || '',
      seoTitle: this.seoForm.get('seoTitle')?.value || '',
      metaDescription: this.seoForm.get('metaDescription')?.value || '',
      customFields: this.copyCustomFields(this.customFieldValues),
    };
  }

  /** Writes language-varying values back into the forms. */
  private applyTranslatableValues(values: TranslatableValues): void {
    this.pageTitle = values.title;
    // emitEvent:false: these writes are a language switch, not a user edit,
    // and must not trip the summary to metaDescription sync or auto-save.
    this.publishForm.get('title')?.setValue(values.title, { emitEvent: false });
    this.publishForm.get('content')?.setValue(values.content, { emitEvent: false });
    this.publishForm.get('summary')?.setValue(values.summary, { emitEvent: false });
    this.seoForm.get('seoTitle')?.setValue(values.seoTitle, { emitEvent: false });
    this.seoForm.get('metaDescription')?.setValue(values.metaDescription, { emitEvent: false });
    this.previousExcerpt = bodyExcerpt(values.content);
    this.previousSummary = (values.summary || '').trim();
    this.customFieldValues = this.adoptCustomFields(values.customFields);
    this.expectRichEchoes();
    this.cdr.detectChanges();
  }

  /**
   * What a save writes that is the same in every language: the forms, the
   * author, sources, series links and tags. The session puts the default
   * language's title, body and the rest over it (buildDraftFormValues).
   */
  private sharedDraftValues(): Record<string, any> {
    if (!this.isTranslating()) {
      this.publishForm.get('title')?.setValue(this.pageTitle);
    }
    this.publishForm.get('coverImage')?.setValue(this.coverImage || null);
    return {
      ...this.publishForm.value,
      ...this.seoForm.value,
      updatedOn: fromDateInputValue(this.seoForm.get('updatedOn')?.value),
      authorId: this.publishForm.get('authorId')?.value || null,
      authorName: this.authorNameFor(this.publishForm.get('authorId')?.value),
      references: cleanReferences(this.references()),
      nextContent: this.selectedNextContent,
      previousContent: this.selectedPreviousContent,
      tagsWithColors: this.selectedTags().map(t => ({ name: t.label, color: t.color })),
    };
  }

  /** The values a translation falls back to: shown as ghost placeholders. */
  private baseValues(): TranslatableValues {
    return this.session.baseValues();
  }

  /** Default-language values, whichever tab is on screen. */
  private baseLanguageValues(): TranslatableValues {
    return this.session.baseLanguageValues();
  }

  /** The draft as a save writes it (in the session). */
  private buildDraftFormValues(): any {
    return this.session.buildDraftFormValues();
  }

  basePlaceholder(field: 'title' | 'content' | 'summary' | 'seoTitle' | 'metaDescription'): string {
    return this.session.baseValues()[field] || '';
  }

  baseCustomFieldValue(key: string): string {
    const value = this.session.baseValues().customFields?.[key];
    return value === null || value === undefined ? '' : String(value);
  }

  /**
   * A custom field's label in the language being edited, so a translator sees
   * the form in their own language. Falls back to the authored label.
   */
  fieldLabel(field: ContentTypeField): string {
    return contentTypeFieldLabel(this.currentContentType(), field.key, field.label, this.activeLang());
  }

  /**
   * An empty custom field's placeholder: "Add download label", worded as the Visual
   * Editor words an empty value on the page, or an example address for a link field.
   */
  fieldPlaceholder(field: ContentTypeField): string {
    if (field.type === 'text' && LINK_FIELD_KEY.test(field.key)) return 'https://';
    return this.translocoService.translate('admin.contents.editor.enter_field', { field: inSentence(this.fieldLabel(field)) });
  }

  /** Only free-text custom fields are translatable — see M-D5. */
  isFieldTranslatable(field: ContentTypeField): boolean {
    return isTranslatableField(field);
  }

  /** A field is locked when we are translating and it is shared across languages. */
  isFieldLocked(field: ContentTypeField): boolean {
    return this.isTranslating() && !isTranslatableField(field);
  }

  /**
   * Switches the editor to another language, stashing the current language's
   * edits in memory first so tab-switching never discards work.
   */
  switchLanguage(code: string): Promise<void> {
    return this.session.switchLanguage(code);
  }

  /** Records the current form state as "saved", so it stops looking dirty. */
  private captureDraftBaseline(): void {
    this.session.captureDraftBaseline();
  }

  /** True when the base document differs from what was loaded or last saved. */
  private hasUnsavedDraftChanges(): boolean {
    return this.session.hasUnsavedDraftChanges();
  }

  /** Marks the active translation dirty; the base auto-save is not involved. */
  markTranslationDirty(): void {
    this.session.markTranslationDirty();
  }

  /** Deletes the active translation, reverting the language to base content. */
  clearTranslation(): Promise<void> {
    return this.session.clearTranslation();
  }

  private fetchCurrentUrl() {
    this.activatedRoute.paramMap.subscribe((params: ParamMap) => {
      const routeContentId = params.get('contentId') || '';
      this.initializeForms();

      // Only load from route if not already set via @Input
      if (routeContentId && !this.session.contentId) {
        this.session.contentId = routeContentId;
        this.session.loadById(routeContentId);
      } else if (!routeContentId && !this.session.contentId) {
        this.draftContentStore.clearCurrent();
      }
    });

    this.activatedRoute.queryParams.subscribe(async (params) => {
      this.paramContentType = params['contentType'] || '';
    });
  }

  /** A stored entry arrived: the session takes it in and fills the forms (fillForms). */
  private patchForms(contentData: any) {
    this.session.load(contentData);
  }

  /** Shows a stored entry in the forms: the default language. */
  private fillForms(contentData: any) {
    this.pageTitle = contentData?.title;
    this.coverImage =
      contentData?.coverImage !== '' ? contentData?.coverImage : null;

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
      authorId: contentData?.authorId || '',
      layout: contentData?.layout || '',
    });

    // What the loaded body's automatic summary is, so a stored summary equal
    // to it keeps following the body and a hand-written one does not.
    this.previousExcerpt = bodyExcerpt(contentData?.content || '');

    this.seoForm.patchValue({
      seoTitle: contentData?.seoTitle || '',
      metaDescription: contentData?.metaDescription || '',
      // Only a canonical the author set. The editor used to fill this from
      // the admin's own address (localhost in a local admin); such values are
      // dropped so publishing uses the page's address on the public site.
      canonicalUrl: authorCanonicalUrl(
        contentData?.canonicalUrl,
        contentData?.type || this.contentTypeSlug || '',
        contentData?.urlSlug || '',
        [this.domain, this.adminOrigin],
      ),
      updatedOn: toDateInputValue(contentData?.updatedOn),
    });
    this.references.set(cleanReferences(contentData?.references));

    // Pre-populate custom field values
    if (contentData?.customFields) {
      this.customFieldValues = this.adoptCustomFields(contentData.customFields);
    }

    // Pre-populate the series links
    this.selectedNextContent = contentData?.nextContent || null;
    this.selectedPreviousContent = contentData?.previousContent || null;

    this.selectedTags.set((contentData?.tags ?? [])
      .map((label: string) => {
        const tag = this.tagsStore.items().find((t) => t.label === label);
        return tag ? { label, color: tag.color } : { label, color: '#6b7280' };
      })
      .filter(Boolean) as { label: string; color: string }[]);
    afterNextRender(
      () => {
        this.onTagSearchFocus();
        this.showTagDropdown.set(false);
      },
      { injector: this.injector }
    );
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
      authorId: [''],
      layout: [''],
    });
    this.publishForm.get('layout')?.valueChanges.subscribe((value) => this.chosenLayout.set(value || ''));

    // The meta description follows the summary while it is empty or still
    // equals the previous summary; a hand-written one is kept, including one
    // loaded from the database.
    this.publishForm.get('summary')?.valueChanges.subscribe((value) => {
      const previous = this.previousSummary;
      this.previousSummary = (value || '').trim();
      const metaDescControl = this.seoForm?.get('metaDescription');
      const meta = (metaDescControl?.value || '').trim();
      if (metaDescControl && (!meta || meta === previous)) {
        metaDescControl.setValue(value, { emitEvent: false });
      }
    });

    this.seoForm = this.fb.group({
      seoTitle: [''],
      metaDescription: [''],
      canonicalUrl: [''],
      // Held as 'YYYY-MM-DD' for the date input; converted to a Date (or
      // null) on the way out, see buildDraftFormValues.
      updatedOn: [''],
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

  /** Stamps today as the last substantive revision (specs/discoverability-spec.md, D-D3). */
  markUpdatedToday(): void {
    this.seoForm.get('updatedOn')?.setValue(toDateInputValue(new Date()));
    this.seoForm.get('updatedOn')?.markAsDirty();
    this.triggerAutoSave();
  }

  /** Runs the checklist and refreshes link suggestions; called when the Checks tab opens or on demand. */
  openChecks(): void {
    this.activeTab = 'checks';
    this.runChecklist();
    if (this.searchOn) this.loadLinkSuggestions();
  }

  runChecklist(): void {
    const base = this.baseLanguageValues();
    this.checklist.set(evaluateDiscoverability({
      title: base.title || this.pageTitle || '',
      bodyHtml: base.content || '',
      summary: base.summary || '',
      metaDescription: base.metaDescription || '',
      coverImage: this.coverImage,
      authorId: this.publishForm.get('authorId')?.value || null,
      references: this.references(),
      tags: this.selectedTags().map(t => t.label),
      publishedOn: this.lastPublishedDate,
      updatedOn: fromDateInputValue(this.seoForm.get('updatedOn')?.value),
      siteOrigin: this.domain,
      // As the page's FAQPage counts them: the first FAQ field's questions that are filled in.
      faqCount: ((rows: unknown) => (Array.isArray(rows) ? rows.filter((r) => String(r?.question ?? '').trim()).length : 0))(
        this.customFieldValues[this.currentFields.find((f) => f.type === 'faq')?.key ?? ''],
      ),
    }));
  }

  /**
   * Content on this site related to the draft that the body does not link
   * to yet (D-D16): the admin search over published items and drafts, with
   * the item itself and anything already linked removed.
   */
  async loadLinkSuggestions(): Promise<void> {
    const base = this.baseLanguageValues();
    const q = [base.title || this.pageTitle || '', ...this.selectedTags().map(t => t.label)].join(' ').trim().slice(0, 120);
    const key = `${q}|${this.contentId}`;
    if (!q || key === this.linkSuggestionsKey) return;
    this.linkSuggestionsKey = key;
    this.linkSuggestionsLoading.set(true);
    try {
      const res = await this.searchService.lookup({ q, lang: 'all', scope: 'admin', sources: ['content'], limit: 12 });
      const body = (base.content || '').toLowerCase();
      const own = { type: this.contentTypeSlug || this.publishForm.get('type')?.value, slug: this.publishForm.get('urlSlug')?.value };
      this.linkSuggestions.set(res.results.filter(r => {
        if (r.meta?.['contentType'] === own.type && r.meta?.['urlSlug'] === own.slug) return false;
        return !body.includes(`href="${r.link.toLowerCase()}"`) && !body.includes(`${r.link.toLowerCase()}"`);
      }).slice(0, 6));
    } catch (error) {
      console.error('Link suggestions failed:', error);
      this.linkSuggestions.set([]);
    } finally {
      this.linkSuggestionsLoading.set(false);
    }
  }

  /** Inserts the page as a link at the cursor in the body editor. */
  insertSuggestedLink(item: SearchResult): void {
    const html = `<a href="${item.link}">${escapeHtml(item.title)}</a>`;
    if (this.bodyEditor) {
      this.bodyEditor.insertTextAtCursor(html);
      this.notify.success('admin.contents.checklist.link_inserted');
      this.linkSuggestions.update(list => list.filter(r => r !== item));
      this.triggerAutoSave();
    }
  }

  addReference(): void {
    this.references.update(list => [...list, { title: '', url: '' }]);
  }

  updateReference(index: number, field: 'title' | 'url', value: string): void {
    this.references.update(list => list.map((ref, i) => (i === index ? { ...ref, [field]: value } : ref)));
    this.triggerAutoSave();
  }

  removeReference(index: number): void {
    this.references.update(list => list.filter((_, i) => i !== index));
    this.triggerAutoSave();
  }

  clearUpdatedOn(): void {
    this.seoForm.get('updatedOn')?.setValue('');
    this.seoForm.get('updatedOn')?.markAsDirty();
    this.triggerAutoSave();
  }

  private setCurrentDateTime(): void {
    const now = new Date();
    this.currentDateTime = formatDate(now, 'yyyy-MM-ddTHH:mm', 'en-US');
  }

  public passEditorContentToParent(event: any): void {
    this.publishForm.get('content')?.setValue(event);

    // The summary follows the body only while it is empty or still the
    // excerpt of the previous body. A hand-written summary is kept, including
    // one loaded from the database, whose control is never dirty. The meta
    // description follows the summary by the same rule (see initializeForms).
    const excerpt = bodyExcerpt(event || '');
    const summaryControl = this.publishForm.get('summary');
    const summary = (summaryControl?.value || '').trim();
    if (summaryControl && (!summary || summary === this.previousExcerpt) && summary !== excerpt) {
      summaryControl.setValue(excerpt);
    }
    this.previousExcerpt = excerpt;

    // TipTap echoes the value it was just given, reserializing it on the way.
    // That echo — and the summary/meta-description it cascades into above — is
    // the last step of loading, not a user edit, so the baseline is taken here
    // rather than in patchForms, once everything has settled.
    this.session.settleLoad();
  }

  public createSlag(): void {
    // A new entry's address follows its title, also once its first input has
    // saved it (4.1), until the address is edited by hand or the entry is
    // published. A stored entry keeps its address.
    if (!this.slugFollowsTitle) return;
    // The slug is shared across languages (M-D2), so a translated title must
    // never regenerate it.
    if (this.isTranslating()) return;

    this.seoForm.get('seoTitle')?.setValue(this.pageTitle);

    // Asked of the server after a pause in typing, not on every key (RF4 review L7).
    if (this.slugTimer) clearTimeout(this.slugTimer);
    this.slugTimer = setTimeout(() => {
      this.slugTimer = null;
      this.count = 0;
      this.checkExist(toUrlSlug(this.pageTitle || ''));
    }, SLUG_CHECK_DELAY_MS);
  }

  /** The latest address check; an older answer arriving late is dropped. */
  private slugCheckRequest = 0;

  /**
   * Asks the server whether the address is free (4.6), for a new entry and a
   * stored one alike; the entry's own address does not count. A taken one
   * becomes the next numbered form (`guide-2`).
   */
  public checkExist(newSlug?: string, typedByHand = false): void {
    const candidate = newSlug || this.publishForm.value.urlSlug || '';
    if (!candidate) return;
    this.errorSlug = false;
    const request = ++this.slugCheckRequest;
    this.draftContentStore.isSlugTaken(candidate, this.contentTypeSlug, this.contentId || undefined).then(
      (taken) => {
        if (request !== this.slugCheckRequest) return;
        if (taken && typedByHand) {
          // An address typed by hand is never changed behind the admin's back:
          // it is kept, marked taken, and the box reopens to change it (RF4 review L8).
          this.errorSlug = true;
          this.setSlugValue(candidate);
          this.isEditingSlug.set(true);
          this.notify.error('admin.contents.editor.slug_exists', { slug: candidate });
          this.cdr.detectChanges();
        } else if (taken) {
          this.incrementAndCheck(candidate);
        } else {
          this.confirmedSlug = candidate;
          this.setSlugValue(candidate);
          this.cdr.detectChanges();
        }
      },
      (error) => {
        // Offline, every keystroke would fail the same way: say nothing then.
        if (!this.offline()) console.error('Error checking slug existence:', error);
        // Kept, but not confirmed: the save asks the server again.
        if (request === this.slugCheckRequest) this.setSlugValue(candidate);
      }
    );
  }

  /** Tries the next numbered form of a taken slug (`guide`, `guide-2`, `guide-3`), up to ten times. */
  private incrementAndCheck(takenSlug: string): void {
    this.count++;
    if (this.count < 10) {
      this.checkExist(nextUrlSlug(takenSlug));
    } else {
      this.setSlugValue(takenSlug);
      this.checkingSlug = false;
      this.errorSlug = true;
      this.cdr.detectChanges();
    }
  }

  private setSlugValue(slug: string): void {
    // The canonical is left alone: empty means this page's own address,
    // which publishing builds from the site's public URL.
    const control = this.publishForm.get('urlSlug');
    const changed = !!control && control.value !== slug;
    control?.setValue(slug);
    // The check answers after the typing that asked for it: the address is saved too,
    // so a saved entry does not stay "Unsaved changes" with its address unwritten.
    if (changed) this.session.saveSoon();
  }

  /**
   * Uses the Production URL for page addresses, so Copy URL in a local admin
   * gives the live address, not localhost.
   */
  private async loadPublicAddress(): Promise<void> {
    const about = await this.siteIdentity.load();
    const url = (about?.finalUrl || '').trim().replace(/\/+$/, '');
    if (!url) return;
    this.domain = url + '/';
    this.cdr.markForCheck();
  }

  /** The page's public address, `{domain}{type}/{slug}`, for Copy URL. */
  private publicUrlFor(slug: string): string {
    const type = this.contentTypeSlug || this.publishForm.get('type')?.value || '';
    return type ? `${this.domain}${type}/${slug}` : this.domain + slug;
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
    // A typed slug follows the same rule as a generated one: no spaces or capitals.
    const currentSlug = toUrlSlug(this.publishForm.get('urlSlug')?.value);
    if (currentSlug) {
      // An address set by hand no longer follows the title.
      this.slugFollowsTitle = false;
      this.publishForm.get('urlSlug')?.setValue(currentSlug);
      this.count = 0;
      this.isEditingSlug.set(false);
      this.checkExist(currentSlug, true);
      this.triggerAutoSave();
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
      this.errorMessage = this.t('admin.contents.editor.invalid_image');
    }
  }

  triggerFileInput(): void {
    if (typeof document !== 'undefined') {
      document.getElementById('coverImageInput')?.click();
    }
  }

  removeCoverImage(): void {
    this.coverImage = null;
    this.triggerAutoSave();
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
    this.triggerAutoSave();
  }

  removeTag(tag: { label: string; color: string }): void {
    this.selectedTags.update(tags => tags.filter((t) => t.label !== tag.label));
    this.publishForm
      .get('tags')
      ?.setValue(this.selectedTags().map((t) => t.label));
    this.triggerAutoSave();
  }

  /** True while a tag typed in the tag box is being created, so Enter and a click make one tag. */
  private creatingTag = false;

  async createInlineTag(): Promise<void> {
    const label = this.tagSearchTerm().trim();
    if (!label || this.creatingTag) return;

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
      label,
      color,
      contentTypeSlug: slug,
      usageCount: 1,
    } as ITag;

    this.creatingTag = true;
    this.tagsStore.add(newTag).subscribe({
      next: (id) => {
        this.creatingTag = false;
        // The store reports a failed write as an empty id rather than an error.
        if (!id) {
          this.notify.error('admin.contents.editor.tag_create_failed');
          return;
        }
        this.selectTag({ ...newTag, id });
        // The list behind the dropdown does not hold the new tag yet; reload
        // it so the tag is offered next time instead of being created twice.
        this.tagsStore.getAll({ limitCount: 100, currentPageNumber: 0, previousPageNumber: -1 });
      },
      error: (error) => {
        this.creatingTag = false;
        console.error('Error creating tag:', error);
        this.notify.error('admin.contents.editor.tag_create_failed');
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
    return this.filterSeriesOptions(this.nextContentSearchTerm(), this.selectedPreviousContent);
  }

  /** The entries the Previous picker offers for its search term. */
  get filteredPreviousContents(): IDraftContents[] {
    return this.filterSeriesOptions(this.previousContentSearchTerm(), this.selectedNextContent);
  }

  /**
   * `otherPick` is the other picker's entry: one entry cannot come both
   * before and after this one.
   */
  private filterSeriesOptions(search: string, otherPick: INextContentReference | null): IDraftContents[] {
    const term = search.toLowerCase();
    const taken = linkedId(otherPick);
    // Never the entry itself, also for a new entry saved after the list loaded.
    const options = this.availableContents.filter(
      (content) => (!this.contentId || content.id !== this.contentId) && (!taken || content.id !== taken),
    );
    if (!term) return options;
    return options.filter(
      (content) =>
        content.title?.toLowerCase().includes(term) ||
        content.metaDescription?.toLowerCase().includes(term)
    );
  }

  /** The copy of an entry a series link stores. */
  private toSeriesReference(content: IDraftContents): INextContentReference {
    return seriesReference(content.id, content);
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
        this.contentId // Exclude current content
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
    this.nextContentActive.set(0);
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
    this.nextContentActive.set(0);
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
    this.selectedNextContent = this.toSeriesReference(content);
    this.nextContentSearchTerm.set('');
    this.showNextContentDropdown.set(false);
    this.cdr.detectChanges();
    this.focusSeriesControl('next-content-remove');
    this.triggerAutoSave();
  }

  /**
   * Remove the selected next content
   */
  removeNextContent(): void {
    this.selectedNextContent = null;
    this.cdr.detectChanges();
    this.focusSeriesControl('next-content-search');
    // Back in the box, the list waits for the keys or typing.
    this.showNextContentDropdown.set(false);
    this.triggerAutoSave();
  }

  // Previous content: the same picker as Next.

  onPreviousContentSearchInput(event: any): void {
    this.previousContentSearchTerm.set(event.target.value);
    this.previousContentActive.set(0);
    this.showPreviousContentDropdown.set(true);
  }

  onPreviousContentSearchFocus(): void {
    if (this.availableContents.length === 0) {
      this.loadAvailableContents();
    }
    this.previousContentActive.set(0);
    this.showPreviousContentDropdown.set(true);
  }

  onPreviousContentSearchBlur(): void {
    // Delay to allow click on dropdown items
    setTimeout(() => this.showPreviousContentDropdown.set(false), 200);
  }

  selectPreviousContent(content: IDraftContents): void {
    this.selectedPreviousContent = this.toSeriesReference(content);
    this.previousContentSearchTerm.set('');
    this.showPreviousContentDropdown.set(false);
    this.cdr.detectChanges();
    this.focusSeriesControl('previous-content-remove');
    this.triggerAutoSave();
  }

  removePreviousContent(): void {
    this.selectedPreviousContent = null;
    this.cdr.detectChanges();
    this.focusSeriesControl('previous-content-search');
    // Back in the box, the list waits for the keys or typing.
    this.showPreviousContentDropdown.set(false);
    this.triggerAutoSave();
  }

  /**
   * The keys of a picker's search box, a combobox: Down opens the list or
   * moves down it, Up moves up, Enter picks the option the keys are on and
   * Escape closes the list. Focus stays in the box; the list follows through
   * aria-activedescendant.
   */
  onSeriesSearchKeydown(which: 'next' | 'previous', event: KeyboardEvent): void {
    const isNext = which === 'next';
    const open = isNext ? this.showNextContentDropdown : this.showPreviousContentDropdown;
    const active = isNext ? this.nextContentActive : this.previousContentActive;
    const options = this.isLoadingContents ? [] : (isNext ? this.filteredNextContents : this.filteredPreviousContents);
    const count = options.length;

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!open()) {
        if (this.availableContents.length === 0) this.loadAvailableContents();
        active.set(0);
        open.set(true);
        return;
      }
      if (!count) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      active.set((Math.min(active(), count - 1) + step + count) % count);
      this.revealSeriesOption(which, active());
    } else if (event.key === 'Enter') {
      // Enter never submits the form from here.
      event.preventDefault();
      if (!open() || !count) return;
      const content = options[Math.min(active(), count - 1)];
      if (isNext) this.selectNextContent(content);
      else this.selectPreviousContent(content);
    } else if (event.key === 'Escape' && open()) {
      event.preventDefault();
      open.set(false);
    }
  }

  /** The id of the option the arrow keys are on, for aria-activedescendant; null while the list is closed or empty. */
  seriesActiveOptionId(which: 'next' | 'previous'): string | null {
    const isNext = which === 'next';
    const open = isNext ? this.showNextContentDropdown() : this.showPreviousContentDropdown();
    const count = isNext ? this.filteredNextContents.length : this.filteredPreviousContents.length;
    if (!open || this.isLoadingContents || !count) return null;
    const active = Math.min(isNext ? this.nextContentActive() : this.previousContentActive(), count - 1);
    return `${which}-content-option-${active}`;
  }

  /**
   * Picking or removing swaps the search box and the picked entry, so focus
   * moves to what took the place of the control that had it, not to the page.
   */
  private focusSeriesControl(id: string): void {
    if (typeof document === 'undefined') return;
    document.getElementById(id)?.focus();
  }

  private revealSeriesOption(which: 'next' | 'previous', index: number): void {
    if (typeof document === 'undefined') return;
    document.getElementById(`${which}-content-option-${index}`)?.scrollIntoView?.({ block: 'nearest' });
  }

  /** Save: the whole entry, every language (in the session, VE-D15). */
  public saveAsDraft(afterSave?: () => void, overwrite = false): Promise<void> {
    return this.session.saveAsDraft(afterSave, overwrite);
  }

  /** Publish: the checks, then the whole entry goes live (in the session, VE-D15). */
  public directPublishContent(overwrite = false): Promise<void> {
    return this.session.directPublishContent(overwrite);
  }

  /** Retry on the "Not saved" line: the write that failed, again. */
  retrySave(): void {
    this.session.retrySave();
  }

  /** Keep mine: the save that stopped, written over the other admin's (4.5). */
  keepMine(): void {
    this.session.keepMine();
  }

  /** Reload theirs: the stored entry replaces what is in the editor, every language included (4.5). */
  reloadTheirs(): Promise<void> {
    return this.session.reloadTheirs();
  }

  /** The editor of a new entry moves to the entry's address once it is written. */
  private showEntryAddress(id: string): void {
    const type = this.contentTypeSlug || this.publishForm.get('type')?.value || '';
    const path = this.location.path();
    if (type && /\/add(\?|$)/.test(path)) {
      // The router's own state is kept, so its back and forward still work.
      this.location.replaceState(this.entryAddress(id), '', typeof history !== 'undefined' ? history.state : undefined);
    }
  }

  /** The editor's address for a stored entry. */
  private entryAddress(id: string): string {
    const type = this.contentTypeSlug || this.publishForm.get('type')?.value || '';
    return `/admin/contents/${type}/edit/${id}`;
  }

  /**
   * The router does not know the address bar moved to the entry's own
   * address, so a navigation that is cancelled (Stay in the leave question)
   * puts /add back. The entry's address is put back after it (RF4 review M1).
   */
  private keepEntryAddress(): void {
    const events = (this.router as Router | undefined)?.events;
    if (!events) return;
    this.navigationSubscription = events.pipe(filter((event) => event instanceof NavigationCancel)).subscribe(() => {
      if (!this.contentId) return;
      if (/\/add(\?|$)/.test(this.location.path())) {
        this.location.replaceState(this.entryAddress(this.contentId), '', typeof history !== 'undefined' ? history.state : undefined);
      }
    });
  }
  private navigationSubscription: Subscription | null = null;

  /**
   * The edit-on-page screen is for an entry of a type with pages
   * (specs/visual-editing-spec.md, VE-D14), and only on the form editor itself;
   * an entry not started yet is started there (review H3).
   */
  canEditOnPage(): boolean {
    return !this.pageMode && !!this.contentTypeSlug && this.currentContentType()?.hasPublicUrl !== false;
  }

  /** Edit on the page: the same entry on the edit-on-page screen, saving first. */
  async openPageEditor(): Promise<void> {
    if (!this.canEditOnPage()) return;
    if (this.hasUnsavedChanges()) await this.saveAsDraft();
    // A save that did not land keeps the editor here, with its line saying why.
    if (this.hasUnsavedChanges()) return;
    void this.router.navigate(['/admin/edit', this.contentTypeSlug, this.contentId || 'new']);
  }

  /** Close: back to the type's entries, through the router, so the leave question can ask (RF4 review M1). */
  close(): void {
    const type = this.contentTypeSlug || this.publishForm?.get('type')?.value || '';
    if (type) void this.router.navigate(['/admin/contents', type]);
    else this.globalService.goBack();
  }

  /** Something changed on screen: the preview follows, and the entry saves itself after a pause. */
  public triggerAutoSave(): void {
    this.session.triggerAutoSave();
  }

  /** A quiet save, a few seconds after the last edit (in the session). */
  private performAutoSave(overwrite = false): Promise<void> {
    return this.session.performAutoSave(overwrite);
  }

  /** The auto-save debounce's input (in the session). */
  private get autoSaveTrigger$() { return this.session.autoSaveTrigger$; }

  /** "Auto-saved" beside the status, for a few seconds after an auto-save. */
  get justAutoSaved() { return this.session.justAutoSaved; }

  /** Something on screen is not stored yet (4.2): the leave guard asks. */
  hasUnsavedChanges(): boolean {
    return this.session.hasUnsavedChanges();
  }

  /** Closing or reloading the tab with unsaved work: the browser's own question. */
  @HostListener('window:beforeunload', ['$event'])
  onBeforeUnload(event: BeforeUnloadEvent): void {
    if (!this.hasUnsavedChanges()) return;
    event.preventDefault();
    event.returnValue = '';
  }

  @HostListener('window:offline')
  onOffline(): void {
    this.session.goneOffline();
  }

  /** Back online: a write that failed is tried again at once. */
  @HostListener('window:online')
  onOnline(): void {
    this.session.backOnline();
  }


  /** The address changed since the page went live: the redirect box shows (4.6). */
  addressMoved(): boolean {
    const live = this.publishedSlug();
    const now = this.publishForm?.get('urlSlug')?.value || '';
    return !!live && !!now && live !== now;
  }

  /** Arc CMS's own question dialog, never the browser's (4.10). */
  private askConfirm(options: { titleKey: TranslationKey; message: string; button: string; warn?: boolean }): Promise<boolean> {
    return this.session.askConfirm(options);
  }

  /** Publish again after a failure (RF4 review L5). */
  public async retryDeployment(): Promise<void> {
    return this.session.retryDeployment();
  }


  // ── Live preview (specs/visual-editing-spec.md, VE1.5) ──────────────────
  // The channel lives in the session (VE-D15); the editor finds the field a
  // click on the preview asked for.

  /** How long after the last change the draft goes to the preview. */
  static readonly PREVIEW_DELAY_MS = EntryDraftSession.PREVIEW_DELAY_MS;

  /** This editor session's key, fixed for its life. */
  private get previewKey(): string {
    return this.session.previewKey;
  }

  /** Opens the preview window, or brings it forward when it is open: one per entry. */
  public openPreview(): void {
    this.session.openPreview();
  }

  /** A message from the preview window (in the session). */
  private onPreviewMessage(message: PreviewMessage): void {
    this.session.onPreviewMessage(message);
  }

  /** The draft exactly as a save would write it (VE-D2), with the language on screen. */
  previewState(): { draft: Record<string, any>; lang: string; translation: IContentTranslation | null } {
    return this.session.previewState();
  }

  /** Built-in fields by the element that edits them, and their tab. */
  private static readonly BUILTIN_FIELD_SPOTS: Record<string, { selector: string; tab: 'basic' | 'seo' | null }> = {
    title: { selector: '.page-title-input', tab: null },
    content: { selector: '.editor-wrapper', tab: null },
    summary: { selector: '#summaryInput', tab: 'basic' },
    coverImage: { selector: '.cover-image-upload, .shared-field-preview', tab: 'basic' },
    authorId: { selector: '#authorSelect', tab: 'basic' },
    layout: { selector: '#layoutSelect', tab: 'basic' },
    tags: { selector: '#tagSearchInput', tab: 'basic' },
    seoTitle: { selector: '#seoTitleInput', tab: 'seo' },
    metaDescription: { selector: '#metaDescriptionInput', tab: 'seo' },
    canonicalUrl: { selector: '#canonicalUrlInput', tab: 'seo' },
    references: { selector: '[data-testid="add-reference"]', tab: 'seo' },
  };

  /**
   * A click on the preview found a field (VE-D8): its tab opens, the field
   * scrolls into view, takes the cursor and flashes. A repeating field's row
   * is the one clicked.
   */
  focusField(key: string, row?: number): void {
    if (typeof document === 'undefined') return;
    const builtin = CreateContentComponent.BUILTIN_FIELD_SPOTS[key];
    const custom = !builtin && this.currentFields.some((f) => f.key === key);
    if (!builtin && !custom) return;
    const tab = builtin ? builtin.tab : 'basic';
    if (tab && this.activeTab !== tab) {
      this.activeTab = tab;
      this.cdr.detectChanges();
    }
    let spot: HTMLElement | null = builtin
      ? document.querySelector<HTMLElement>(builtin.selector)
      : document.getElementById(`req-${key}`);
    if (spot && row !== undefined) {
      const rows = spot.querySelectorAll<HTMLElement>('.repeater-row');
      spot = rows[row] ?? spot;
    }
    if (!spot) return;
    const input = spot.matches('input, textarea, select, [contenteditable="true"]')
      ? spot
      // The words first: a row's text box, not its position number.
      : spot.querySelector<HTMLElement>('[contenteditable="true"], input[type="text"]:not([disabled]), textarea:not([disabled])')
        ?? spot.querySelector<HTMLElement>('input:not([type="hidden"]):not([type="file"]), select, button');
    // The box that takes the cursor is brought into view, not the field's middle: a tall
    // field (FAQ, a list of rows) would otherwise leave its first box off screen.
    (input ?? spot).scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    input?.focus({ preventScroll: true });
    window.focus();
    spot.classList.remove('arc-field-flash');
    void spot.offsetWidth;
    spot.classList.add('arc-field-flash');
    setTimeout(() => spot?.classList.remove('arc-field-flash'), 1600);
  }

  /** The field an element in the editor edits, for outlining it in the preview. */
  static fieldOfElement(target: Element | null): string {
    if (!target || typeof target.closest !== 'function') return '';
    // A custom field's own box first: some of its parts look like a built-in's.
    const wrapper = target.closest('[id^="req-"]');
    if (wrapper) return wrapper.id.slice(4);
    for (const [key, spot] of Object.entries(CreateContentComponent.BUILTIN_FIELD_SPOTS)) {
      if (target.closest(spot.selector)) return key;
    }
    return '';
  }

  /** Focusing a field outlines where it is on the preview (VE-D8). */
  @HostListener('focusin', ['$event'])
  onFieldFocus(event: FocusEvent): void {
    if (!this.session.previewOpen()) return;
    this.session.highlight(CreateContentComponent.fieldOfElement(event.target as Element | null));
  }

  @HostListener('focusout')
  onFieldBlur(): void {
    this.session.unhighlight();
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
    // The cover doubles as the social-share image, which wants the whole
    // 1200px; the picker opens on XL so that is what an admin gets by default.
    const dialogRef = this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({
      isDialogOpen: true,
      size: COVER_IMAGE_SIZE,
      title: this.t('admin.media.picker.cover_image'),
    }));

    dialogRef.afterClosed().subscribe((result: { mediaUrl: string; type: string } | null) => {
      if (result && result.type === 'submit' && result.mediaUrl) {
        this.coverImage = result.mediaUrl;
        this.publishForm.get('coverImage')?.setValue(result.mediaUrl);
        this.errorMessage = null;
        this.cdr.detectChanges();
        this.triggerAutoSave();
      }
    });
  }
  /**
   * Copy the full URL to clipboard
   */
  async copyUrlToClipboard(): Promise<void> {
    const urlSlug = this.publishForm.get('urlSlug')?.value || '';
    const fullUrl = this.publicUrlFor(urlSlug);

    const success = await this.globalService.copyToClipboard(fullUrl);
    if (success) {
      this.notify.success('admin.contents.editor.url_copied');
    } else {
      this.notify.error('admin.contents.editor.url_copy_failed');
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
  async restoreVersion(version: VersionHistoryItem): Promise<void> {
    const confirmed = await this.askConfirm({
      titleKey: 'admin.contents.editor.restore_title',
      message: this.t('admin.contents.editor.restore_message', { version: version.versionNumber }),
      button: this.t('admin.contents.editor.restore_button'),
    });
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
      this.customFieldValues = this.adoptCustomFields(version.customFields);
    }

    // Restore the series links. A version saved before an entry had a
    // Previous has no such field: the current link is kept then.
    if (version.nextContent !== undefined) {
      this.selectedNextContent = await this.restoredSeriesLink(version.nextContent, this.selectedNextContent);
    }
    if (version.previousContent !== undefined) {
      this.selectedPreviousContent = await this.restoredSeriesLink(version.previousContent, this.selectedPreviousContent);
    }

    // Close the version preview and switch to basic tab so user sees the restored content
    this.previewingVersion.set(null);
    this.activeTab = 'basic';

    this.notify.success('admin.contents.editor.version_restored', { version: version.versionNumber });

    // Trigger auto-save for the restored content
    this.triggerAutoSave();
  }

  /**
   * A series link from an old version, as the entry it points at is now: its
   * current title, meta description and slug. A link to an entry since
   * deleted, to this entry itself, or to the placeholder 'temp-id' older
   * versions wrote is dropped, so the restored page never links to a missing
   * page. If the entry cannot be read, the current link is kept.
   */
  private async restoredSeriesLink(
    link: INextContentReference | null | undefined,
    current: INextContentReference | null,
  ): Promise<INextContentReference | null> {
    const id = linkedId(link);
    if (!isRealId(id) || id === this.contentId) return null;
    const contentType = this.contentTypeSlug || this.publishForm.get('type')?.value || '';
    try {
      return await this.draftContentStore.currentSeriesReference(contentType, id);
    } catch (error) {
      console.error('Error reading a series link to restore:', error);
      return current;
    }
  }

  ngOnDestroy(): void {
    // The preview keeps the last draft and says the editor closed (VE-D6).
    this.session.close();
    this.navigationSubscription?.unsubscribe();
    if (this.slugTimer) clearTimeout(this.slugTimer);
  }
}

/**
 * One entry of another content type as a reference option: its custom fields
 * beside its built-in fields, so a custom field works as the display field and
 * as a copied field like `title` does. Built-in fields win a clash; `id` is the
 * document's.
 */
export function referenceOption(id: string, data: Record<string, any>): Record<string, any> {
    const { id: _ignored, customFields, ...rest } = data;
    return { ...((customFields as Record<string, any>) || {}), ...rest, id };
}
