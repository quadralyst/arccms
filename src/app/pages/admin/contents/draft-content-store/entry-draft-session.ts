import { computed, inject, Injectable, NgZone, OnDestroy, signal, untracked } from '@angular/core';
import { deleteField } from '@angular/fire/firestore';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoService } from '@jsverse/transloco';
import { Subject, Subscription, firstValueFrom } from 'rxjs';
import { debounceTime, filter } from 'rxjs/operators';
import { ConfirmationPopupComponent } from '../../../../../shared/components/confirmation-popup/confirmation-popup.component';
import { ConstantVariables } from '../../../../../shared/constants';
import { ILanguage } from '../../../../../shared/models/localization.model';
import { isRepeaterType } from '../../../../../shared/models/repeater.model';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { summaryPlainText } from '../../../../../shared/utils/summary-text';
import { toUrlSlug } from '../../../../../shared/utils/url-slug';
import { TranslationKey } from '../../../../core/i18n/translation-keys';
import {
  PreviewChannel, PreviewMessage, previewSessionKey, previewUrl, previewWindowName,
} from '../../../../core/preview/preview-channel';
import { entryChanges, type Change } from '../../../../core/editing/compare';
import { HeldError, heldByOther, holdOf, isHeld, type EditingHold } from '../../../../core/editing/hold';
import { HoldService, type KeptDraft } from '../../../../core/editing/hold.service';
import { LocalizationService } from '../../../../core/services/localization.service';
import { AuthState } from '../../../(auth)/auth.store';
import { CollectionRefSyncService } from '../content-store/collection-ref-sync.service';
import { ContentsService, DeployStatusUpdate } from '../content-store/published-contents.service';
import { ContentTypeField } from '../content-types/content-types.model';
import { hasReplacePrompt } from '../standard-pages/standard-pages';
import { PublishQueueService } from '../publish-queue/publish-queue.service';
import {
  IContentTranslation,
  TRANSLATABLE_BUILTIN_FIELDS,
  isTranslatableField,
  isTranslationEmpty,
  translatableHeadingKey,
  translatableRepeaterKeys,
} from './content-translation.model';
import { ContentPublishState, deriveContentStatus, toDate } from './content-status';
import { DraftContentsService } from './draft-contents.service';
import { DraftContentsStore } from './draft-contents.store';
import { editState, type EditState } from '../../edit/edit-state';
import { changedSinceOpened, isEntryChanged, isEntryGone } from './entry-changed';
import { BACKLINK_FIELD, BacklinkChange, SERIES_FIELDS, SeriesField, SeriesLinks, linkedId, planBacklinks, seriesReference } from './series-links';

/** How long after the last edit an entry saves itself. */
export const AUTO_SAVE_DELAY_MS = 5_000;

/**
 * The subset of an entry that varies by language. Everything else on a
 * content item (slug, cover image, tags, dates, references) is shared across
 * languages: see specs/multilingual-spec.md decision M-D5.
 */
export interface TranslatableValues {
  title: string;
  content: string;
  summary: string;
  seoTitle: string;
  metaDescription: string;
  customFields: { [key: string]: any };
}

/**
 * What a screen that edits an entry gives the session: where the values are
 * on screen and how to show them. The form editor is one such screen; the
 * edit-on-page screen (specs/visual-editing-spec.md, VE-D14) is another.
 * The rules for saving, checking and publishing live in the session, so both
 * screens follow the same ones (VE-D15).
 */
export interface EntryDraftView {
  /** The screen is ready to be read (the form editor: its forms exist). */
  ready(): boolean;
  /** The type picked on screen, for an entry whose route names none; '' when none. */
  formType(): string;
  /** The type's custom fields. */
  fields(): ContentTypeField[];
  /** A custom field's label in the language on screen. */
  fieldLabel(field: ContentTypeField): string;
  /** The title on screen, in the language on screen. */
  pageTitle(): string;
  /** The page address (slug) on screen. */
  address(): string;
  /** The language-varying values on screen. */
  capture(): TranslatableValues;
  /** Puts language-varying values on screen: a language switch, not an edit. */
  apply(values: TranslatableValues): void;
  /** Custom field values as a save writes them (repeating rows in order, blank rows dropped). */
  prepareCustomFields(values: Record<string, any>): Record<string, any>;
  /**
   * Everything a save writes that is the same in every language: the form
   * editor's form values, author, sources, series links and tags. The
   * language-varying values in it are replaced by the default language's.
   */
  sharedValues(): Record<string, any>;
  /** Shows a stored entry that was loaded or reloaded (default language on screen). */
  fill(item: any): void;
  /** Rich text on screen whose next update is the editor giving back what was put in it. */
  expectEchoes(): void;
  /** Loading is settled: an editor that has not echoed by now never will (one shown later starts with the value). */
  echoesDone?(): void;
  /** Takes the admin to the first required field that is empty. */
  revealMissing(missing: string[]): void;
  /** A new entry was written for the first time, with this id. */
  entryCreated(id: string): void;
  /** A click in the preview window asked for a field (VE-D8). */
  focusField(key: string, row?: number): void;
  /** Redraw: state the screen shows changed outside its own events. */
  refresh(): void;
}

/**
 * One entry being edited: loading, the saved baseline, auto-save, the checks
 * against someone else's save (Reload theirs / Keep mine), the translations
 * stash, the checks on Save and Publish, publishing and its status line, and
 * the live preview channel. Provided by the screen that edits the entry, one
 * per screen (specs/visual-editing-spec.md, VE-D15).
 */
@Injectable()
export class EntryDraftSession implements OnDestroy {
  private draftContentStore = inject(DraftContentsStore);
  private draftContentsService = inject(DraftContentsService);
  private collectionRefSyncService = inject(CollectionRefSyncService);
  private publishQueueService = inject(PublishQueueService);
  private contentsService = inject(ContentsService);
  private localization = inject(LocalizationService);
  private authState = inject(AuthState);
  private dialog = inject(MatDialog);
  private ngZone = inject(NgZone);
  private notify = inject(NotifyService);
  private toastService = inject(ToastService);
  private transloco = inject(TranslocoService);
  private constantVariables = new ConstantVariables();

  private view!: EntryDraftView;

  /** The screen this session reads and fills. Set once, before anything loads. */
  attach(view: EntryDraftView): void {
    this.view = view;
  }

  // ── The entry ────────────────────────────────────────────────────────────
  /** The content type's slug, as the route gives it. */
  readonly typeSlug = signal<string>('');
  /** The entry's id; '' until a new entry's first write. */
  contentId = '';
  /** Links to the published version: the same id, once published at least once. */
  publishedId = '';
  lastDraftSavedDate: Date | null = null;
  lastPublishedDate: Date | null = null;

  /** The type: the route's, else the one picked on screen. */
  entryType(): string {
    return this.typeSlug() || this.view?.formType() || '';
  }

  // ── Save state ───────────────────────────────────────────────────────────
  isSavingDraft = false;
  isAutoSaving = false;
  saveStatusMessage = '';
  saveStatusType: 'success' | 'error' | 'info' = 'info';
  /** "Auto-saved" beside the status, for a few seconds after an auto-save. */
  readonly justAutoSaved = signal(false);

  // ── No lost work (specs/dev-review-fixes-spec.md, RF4) ──────────────────
  /** True while a new entry's first write is under way (4.1); Save and Publish wait for it. */
  readonly creating = signal(false);
  /** The first write under way, which Save and Publish wait for, then update (RF4 review H1). */
  private createPromise: Promise<void> | null = null;
  /** The new entry's id, chosen before its first write and kept for a retry (RF4 review H1, L1). */
  private newEntryId: string | null = null;
  /** Another admin deleted the entry: nothing more can be saved to it (RF4 review L3). */
  readonly entryGone = signal(false);
  /** A Publish again is under way (RF4 review L5). */
  private republishing = false;
  /**
   * The stored entry's modifiedAt as the editor opened it or last saved it.
   * A save stops when the stored one differs: someone else saved since (4.5).
   */
  private openedModifiedAt: unknown = null;
  /** Someone else saved the entry since it was opened; saving waits for Reload theirs or Keep mine. */
  readonly entryChanged = signal(false);
  /** The save that found the change, run again over theirs by Keep mine. */
  private overwriteAction: (() => void) | null = null;
  // ── One person holds an entry (VE-D76 to VE-D82) ───────────────────────
  private holds = inject(HoldService);
  /** Someone else holds the entry: it is shown, and follows their work, but nothing can be changed. */
  readonly heldBy = signal<EditingHold | null>(null);
  /** The entry was taken over with words here not saved: they stay on screen to copy, and nothing replaces them. */
  readonly lostWords = signal(false);
  /** The stored draft and the published copy, followed while the entry is open. */
  private storedDraft: Record<string, any> | null = null;
  readonly publishedCopy = signal<Record<string, any> | null>(null);
  /**
   * Where the entry is being changed, for which page's Publish takes it (VE-D72):
   * a page's id for a card that goes out with that page, null for a card only
   * looked through there, undefined in the entry's own editors, where a change
   * belongs to no page.
   */
  cardOnPage: string | null | undefined = undefined;
  private followedPath = '';
  private stopFollowing: (() => void)[] = [];
  /** The last write failed. Stays until a write works (4.4). */
  readonly saveFailed = signal(false);
  /** What Retry runs: the write that failed. */
  private retryAction: (() => void) | null = null;
  /** The browser says there is no connection. */
  readonly offline = signal(typeof navigator !== 'undefined' && navigator.onLine === false);
  /** A save is under way, so a second click does not start another. */
  private saveInFlight = false;
  /** A new entry's address follows its title until it is edited by hand or published. */
  slugFollowsTitle = true;
  /** The address last found free on the server, or loaded with the entry. */
  confirmedSlug = '';
  /** The address is taken, or could not be made free. */
  errorSlug = false;
  /** The address of the entry's live page; '' while it has none (4.6). */
  readonly publishedSlug = signal('');
  /** "Send the old address to the new one", ticked by default. */
  readonly redirectOldAddress = signal(true);
  /** Publishing could not start, or no answer came: the failure line stays (4.3). */
  readonly publishProblem = signal<'' | 'start' | 'no_answer' | 'template' | 'build'>('');
  readonly deployStatus = signal<DeployStatusUpdate['deployStatus']>(null);
  /** Where the stored draft stands against what is published, as the entries list says it (VE-D70). */
  readonly publishedState = signal<ContentPublishState>('draft');
  /**
   * Whether `publishedState` can be told: an entry published before
   * `lastPublishedAt` existed may hold changes nobody can see from the dates.
   */
  readonly publishedStateKnown = signal(true);
  /** A stored entry was read: its state can be shown. A new entry's is "Not published yet" from the start. */
  readonly entryRead = signal(false);
  /** Counts the publishes that landed while the entry is open: History reads itself again (VE-D71). */
  readonly publishesLanded = signal(0);
  /** A save went through after Publish was asked for, so what lands is not what is stored. */
  private savedSincePublish = false;
  readonly deployError = signal<string>('');
  private deployStatusSubscription: Subscription | null = null;

  // ── Auto-save ────────────────────────────────────────────────────────────
  /** Each change pushes here; the save runs a few seconds after the last one. */
  readonly autoSaveTrigger$ = new Subject<void>();
  /** Fires on every change on screen, before the pause auto-save waits for (a placed field's card follows it). */
  readonly edited$ = new Subject<void>();
  private autoSaveSubscription: Subscription | null = null;

  // ── Translations (M2) ────────────────────────────────────────────────────
  // One language is on screen at a time. The default language is the base
  // document; any other language is held on the same screen but saved to
  // arc_{slug}_drafts/{id}/translations/{lang}.

  /** Language currently being edited. Empty until the language list loads. */
  readonly activeLang = signal<string>('');
  /** Codes this item already has a stored translation for: badges the tabs. */
  readonly translatedLanguages = signal<string[]>([]);
  /** Unsaved edits exist for the active translation. */
  readonly translationDirty = signal<boolean>(false);
  readonly isSavingTranslation = signal<boolean>(false);
  /** Default-language values, stashed while a translation is being edited. */
  baseStash: TranslatableValues | null = null;
  /** In-memory edits per language, so switching tabs never loses work. */
  private translationEdits = new Map<string, TranslatableValues>();
  /** Languages already fetched from Firestore this session. */
  private loadedTranslations = new Set<string>();
  /** Languages whose edits are not yet persisted. Saved with the document. */
  readonly dirtyTranslations = new Set<string>();
  /** Signature of what is currently stored/applied for the active language. */
  private appliedSignature = '';

  readonly enabledLanguages = computed<ILanguage[]>(() => this.localization.enabledLanguages());
  readonly defaultLang = computed<string>(() => this.localization.defaultLanguage());
  /** The language bar only appears once a second language is configured. */
  readonly showLanguageBar = computed<boolean>(() => this.localization.isMultilingual());
  /** True when the screen holds a translation rather than the base document. */
  readonly isTranslating = computed<boolean>(() => {
    const active = this.activeLang();
    return !!active && active !== this.defaultLang();
  });
  readonly activeLanguageLabel = computed<string>(
    () => this.localization.find(this.activeLang())?.label || this.activeLang(),
  );

  // ── The saved baseline ───────────────────────────────────────────────────
  // The editor emits a content event when TipTap receives its value on load,
  // which armed the auto-save debounce without the user touching anything,
  // so merely opening an item rewrote it 30s later. That bumped `modifiedAt`
  // and made every published item read as "Edited" in the list. Auto-save
  // compares against the state as loaded and skips when nothing has changed.
  private savedDraftSignature: string | null = null;
  /** Set when values are put on screen by a load; the editor's echo of them
   *  re-captures the baseline instead of counting as an edit. */
  private awaitingBaselineCapture = false;
  /** Settles a load no editor echoed (an unchanged body, or editors not on screen). */
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  /** The stored item as this session's last save left it; the load skips it. */
  private storedEcho: unknown = null;
  /** The links as last loaded or saved, which the next save's backlinks compare with. */
  private storedSeriesLinks: SeriesLinks | null = null;

  constructor() {
    // Auto-save pipeline: a few seconds after the last edit, for an entry that
    // has been written once (a new one is written on its first input, see
    // triggerAutoSave). Short, so the leave question only shows in that gap.
    this.autoSaveSubscription = this.autoSaveTrigger$.pipe(
      debounceTime(AUTO_SAVE_DELAY_MS),
      filter(() => !!this.contentId),
      filter(() => !this.isSavingDraft && !this.isAutoSaving && !this.creating() && !this.entryChanged() && !this.heldBy()),
      // Never rewrite an unchanged document: that bumps modifiedAt and makes
      // the list report the item as edited-since-publish when it is not.
      filter(() => this.hasUnsavedDraftChanges() || this.dirtyTranslations.size > 0),
      // No title rule here: an entry begun in the body is already stored, and
      // its later edits must not be lost while the title is still empty. The
      // Save button keeps the rule (RF4 review M2).
    ).subscribe(() => {
      this.performAutoSave();
    });
  }

  private t(key: TranslationKey, params?: Record<string, unknown>): string {
    return this.transloco.translate(key, params);
  }

  // ── Loading ──────────────────────────────────────────────────────────────

  /** Asks the store for the entry; it arrives through the screen's watch on `currentItem`. */
  loadById(id: string): void {
    if (id && id !== '') {
      this.draftContentStore.getByCustomField('id', '==', id, this.typeSlug());
    }
  }

  /**
   * Whether a stored item the store holds is one to show: this entry (the store
   * keeps the entry opened before until this one is read, and its words must never
   * be taken for this one's), and not the item as this session's own last save
   * left it (a save refreshes the store, and showing that again would drop
   * anything typed while it ran).
   */
  isNewStoredItem(item: unknown): boolean {
    if (item === this.storedEcho || !item || !Object.keys(item as object).length) return false;
    const id = (item as { id?: unknown }).id;
    return !this.contentId || !id || id === this.contentId;
  }

  /** A stored entry arrived or was replaced: the screen shows it and it is the clean state. */
  load(contentData: any): void {
    this.entryRead.set(!!contentData?.id);
    // The published collection uses the same document id as the draft, so
    // once the entry has been published its id IS the publishedId (History).
    if (contentData?.publishedStatus && contentData?.id) {
      this.publishedId = contentData.id;
    }
    if (contentData?.id) this.follow(contentData.id);
    // A publish still running answers for itself.
    if (this.deployStatus() !== 'pending') {
      this.publishedState.set(deriveContentStatus(contentData));
      this.publishedStateKnown.set(!contentData?.publishedStatus || !!contentData?.lastPublishedAt);
    }
    // The stored entry as opened: a later save checks it is still this one (4.5).
    this.openedModifiedAt = contentData?.modifiedAt ?? null;
    if (contentData?.id) {
      // A stored entry keeps its address, unless it was never published and
      // its address is still the one made from its title (RF4 review M8).
      this.slugFollowsTitle = !contentData?.publishedStatus && !contentData?.lastPublishedAt
        && addressFromTitle(contentData?.urlSlug || '', contentData?.title || '');
      this.confirmedSlug = contentData?.urlSlug || '';
      void this.loadPublishedSlug(contentData);
    }

    // While a translation is on screen, refresh the stashed base values
    // instead of overwriting the translation: the store can emit at any time
    // (e.g. after an unrelated save).
    if (this.isTranslating()) {
      this.baseStash = {
        title: contentData?.title || '',
        content: contentData?.content || '',
        summary: contentData?.summary || '',
        seoTitle: contentData?.seoTitle || '',
        metaDescription: contentData?.metaDescription || '',
        customFields: this.view.prepareCustomFields(contentData?.customFields ?? {}),
      };
      return;
    }

    // The last publish that landed. The draft keeps its first `publishedOn` (VE-D71).
    this.lastPublishedDate = toDate(contentData?.lastPublishedAt) ?? toDate(contentData?.publishedOn);

    this.view.fill(contentData);

    this.storedSeriesLinks = contentData?.id
      ? { nextContent: contentData?.nextContent || null, previousContent: contentData?.previousContent || null }
      : null;

    // Freshly loaded content is by definition unmodified. The editor's echo
    // refines this once TipTap has normalized the body (settleLoad), and each
    // rich text field's echo does the same for its field.
    this.awaitingBaselineCapture = true;
    this.view.expectEchoes();
    this.captureDraftBaseline();
    this.view.refresh();
    // An editor echoes while the screen is drawn, at once, or never: an empty body
    // loaded again, say, gives nothing back. Without this the first edit after such
    // a load would be taken for the echo and become the saved state, unsaved.
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.settleLoad();
      this.view.echoesDone?.();
    });
    // The preview window and the Visual Editor's page show what was loaded, such as
    // the other admin's entry after Reload theirs, not what was on screen before.
    this.schedulePreview();
  }

  /**
   * The body editor gave back the value it was just given. That echo, and
   * whatever follows it on screen, is the last step of loading, not an edit,
   * so the baseline is taken here once everything has settled.
   */
  settleLoad(): void {
    if (this.awaitingBaselineCapture) {
      this.awaitingBaselineCapture = false;
      this.captureDraftBaseline();
    }
  }

  /** Reads the live page's address, for the redirect offer when the address changes (4.6). */
  private async loadPublishedSlug(contentData: any): Promise<void> {
    if (!contentData?.publishedStatus || !contentData?.id || !this.typeSlug()) {
      this.publishedSlug.set('');
      return;
    }
    const slug = await this.draftContentStore.publishedSlug(this.typeSlug(), contentData.id);
    this.publishedSlug.set(slug);
    this.view.refresh();
  }

  /**
   * Brings the stored item up to date with what was just written, so a later
   * publish keeps the first publishedOn and the reference sync compares with
   * what is stored, without filling the screen again.
   */
  private refreshStoredItem(id: string, written: any): void {
    this.draftContentStore.refreshCurrentItem(id, written);
    this.storedEcho = untracked(() => this.draftContentStore.currentItem());
  }

  // ── The saved baseline ───────────────────────────────────────────────────

  /**
   * Stable signature of the fields worth persisting. Volatile bookkeeping
   * (timestamps, save status) is excluded so it never registers as a change.
   */
  draftSignature(values: Record<string, unknown>): string {
    // authorName is derived from authorId and the author list, which can load
    // after the baseline is taken; authorId already records the real change.
    const VOLATILE = new Set([
      'updatedAt', 'modifiedAt', 'createdAt', 'modifiedBy', 'createdBy',
      'publishedOn', 'lastPublishedAt', 'status', 'publishedStatus', 'authorName',
      'redirectOldAddress',
    ]);
    const normalize = (value: unknown): unknown => {
      if (value === null || value === undefined || value === '') return null;
      if (Array.isArray(value)) return value.map(normalize);
      if (value instanceof Date) return null;
      if (typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>)
          .filter(([key]) => !VOLATILE.has(key))
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, val]) => [key, normalize(val)]);
        return Object.fromEntries(entries);
      }
      return value;
    };

    const filtered = Object.entries(values)
      .filter(([key]) => !VOLATILE.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, val]) => [key, normalize(val)]);

    return JSON.stringify(Object.fromEntries(filtered));
  }

  /** Whether a baseline was taken: the entry has loaded or been written. */
  hasBaseline(): boolean {
    return this.savedDraftSignature !== null;
  }

  /** Whether these values are the saved baseline. */
  isBaseline(values: Record<string, unknown>): boolean {
    return this.savedDraftSignature !== null && this.savedDraftSignature === this.draftSignature(values);
  }

  /** Records the current state as "saved", so it stops looking dirty. */
  captureDraftBaseline(): void {
    if (this.isTranslating()) return;
    this.savedDraftSignature = this.draftSignature(this.buildDraftFormValues());
  }

  /** True when the base document differs from what was loaded or last saved. */
  hasUnsavedDraftChanges(): boolean {
    if (this.savedDraftSignature === null) return true;
    return this.draftSignature(this.buildDraftFormValues()) !== this.savedDraftSignature;
  }

  /**
   * The draft as a save writes it. The base document always holds the default
   * language, even when a translation is on screen (see baseLanguageValues).
   */
  buildDraftFormValues(): any {
    const base = this.baseLanguageValues();
    const shared = this.view.sharedValues();
    return {
      ...shared,
      type: this.typeSlug() || shared['type'] || '',
      status: this.constantVariables.DRAFT,
      updatedAt: new Date(),
      // Language-varying fields come from the default language, never from the
      // screen when a translation is being edited.
      title: base.title,
      content: base.content,
      summary: base.summary,
      seoTitle: base.seoTitle,
      metaDescription: base.metaDescription,
      customFields: base.customFields,
    };
  }

  // ── Translations (M2) ────────────────────────────────────────────────────

  /**
   * Loads the site's language list and starts on the default language. On a
   * single-language site this leaves every translation path dormant:
   * `isTranslating()` can never become true.
   */
  async initLanguages(): Promise<void> {
    await this.localization.load();
    this.activeLang.set(this.defaultLang());
    await this.refreshTranslatedLanguages();
    this.view.refresh();
  }

  async refreshTranslatedLanguages(): Promise<void> {
    if (!this.contentId || !this.typeSlug()) {
      this.translatedLanguages.set([]);
      return;
    }
    const languages = await this.draftContentsService.getTranslatedLanguages(this.typeSlug(), this.contentId);
    this.translatedLanguages.set(languages);
  }

  hasTranslation(code: string): boolean {
    return this.translatedLanguages().includes(code);
  }

  /** Puts language-varying values on screen; a switch shows in the preview too. */
  private applyTranslatableValues(values: TranslatableValues): void {
    this.appliedSignature = this.valuesSignature(values);
    this.view.apply(values);
    this.schedulePreview();
  }

  /** The values a translation falls back to: shown as ghost placeholders. */
  baseValues(): TranslatableValues {
    return this.baseStash ?? this.view.capture();
  }

  /**
   * Default-language values, whichever language is on screen. Save and
   * Publish act on the whole item, so they write the base document from
   * these rather than from the screen, which may be showing a translation.
   */
  baseLanguageValues(): TranslatableValues {
    return this.isTranslating() ? this.baseValues() : this.view.capture();
  }

  /** Moves whatever is on screen into the right stash, so every language's edits are in hand before a save. */
  private collectCurrentLanguageEdits(): void {
    const captured = this.view.capture();
    const current = this.activeLang();
    if (!current || current === this.defaultLang()) {
      this.baseStash = captured;
    } else {
      this.translationEdits.set(current, captured);
      if (this.translationDirty()) this.dirtyTranslations.add(current);
    }
  }

  /**
   * Writes every pending language variant. Called as part of saving the
   * document, and before a publish is enqueued, so the publish pipeline
   * copies the translations that were just saved rather than stale ones.
   */
  /**
   * Writes the translations edited since the last save. False when one did not land:
   * it is "Not saved" then, and Retry runs `retry` (by default, these writes again).
   */
  private async persistPendingTranslations(docId: string, retry?: () => void): Promise<boolean> {
    if (!docId || !this.typeSlug() || this.dirtyTranslations.size === 0) return true;
    this.savingTranslations = true;
    try {
      return await this.writePendingTranslations(docId, retry);
    } finally {
      this.savingTranslations = false;
      // A language is a change like any other; whether it differs from what is live is looked at once it is stored.
      if (this.publishedState() === 'published' && this.deployStatus() !== 'pending') this.publishedState.set('edited');
      void this.settle();
    }
  }

  private savingTranslations = false;

  private async writePendingTranslations(docId: string, retry?: () => void): Promise<boolean> {
    const languages = [...this.dirtyTranslations];
    let failure: unknown = null;
    let typedMeanwhile = false;
    for (const lang of languages) {
      const values = this.translationEdits.get(lang);
      if (!values) continue;
      // What this write stores, to tell afterwards whether more was typed (RF4 review H2).
      const writtenSignature = this.valuesSignature(values);

      const translation: IContentTranslation = {
        lang,
        ...values,
        customFields: this.translatableCustomFields(values.customFields),
        translatedAt: new Date(),
        translatedBy: this.authState.currentUser()?.id || '',
      };

      try {
        if (isTranslationEmpty(translation)) {
          // Nothing left in this language: drop the variant so it falls back
          // to the default language instead of publishing an empty page.
          this.openedModifiedAt = await this.draftContentsService.deleteTranslation(this.typeSlug(), docId, lang) ?? this.openedModifiedAt;
          this.translatedLanguages.update(langs => langs.filter(l => l !== lang));
        } else {
          await this.draftContentsService.saveTranslation(this.typeSlug(), docId, translation);
          this.translatedLanguages.update(langs => (langs.includes(lang) ? langs : [...langs, lang]));
        }
        // Clean only if nothing was typed in this language while it was written:
        // the language on screen is read from the screen, any other from its stash.
        const onScreen = this.isTranslating() && this.activeLang() === lang;
        const now = onScreen ? this.view.capture() : this.translationEdits.get(lang);
        const unchanged = !!now && this.valuesSignature(now) === writtenSignature;
        if (onScreen) {
          this.appliedSignature = writtenSignature;
          this.translationDirty.set(!unchanged);
        }
        if (unchanged) {
          this.dirtyTranslations.delete(lang);
        } else {
          typedMeanwhile = true;
        }
      } catch (error) {
        console.error(`Error saving "${lang}" translation:`, error);
        failure = failure ?? error;
      }
    }

    // A translation that did not land is "Not saved" with Retry, like the
    // entry itself (RF4 review M6).
    if (failure) this.writeFailed(failure, retry ?? (() => void this.persistPendingTranslations(docId)));
    else if (typedMeanwhile) this.autoSaveTrigger$.next();
    this.view.refresh();
    return !failure;
  }

  /**
   * Switches to another language, stashing the current language's edits in
   * memory first so switching never discards work.
   */
  /** Counts language switches, so only the last one is applied (VE3.11). */
  private switchTurn = 0;
  /** The language a switch is loading, until it is on screen. */
  private switchingTo: string | null = null;

  async switchLanguage(code: string): Promise<void> {
    const current = this.activeLang();
    // A switch still loading its translation counts as where the screen is going.
    if (!code || code === (this.switchingTo ?? current)) return;
    // The last switch wins: one still loading is dropped when it lands.
    const turn = ++this.switchTurn;
    if (code === current) {
      // Back to the language on screen before the other one loaded: it simply stays.
      this.switchingTo = null;
      return;
    }

    const keepOnScreen = () => {
      const captured = this.view.capture();
      if (current === this.defaultLang()) this.baseStash = captured;
      else if (current) this.translationEdits.set(current, captured);
    };
    keepOnScreen();

    if (code === this.defaultLang()) {
      if (this.baseStash) this.applyTranslatableValues(this.baseStash);
      this.activeLang.set(code);
      this.translationDirty.set(false);
      return;
    }

    // Editing a translation: use in-memory edits, else the stored document,
    // else start from blank fields that fall back to the base content.
    let values = this.translationEdits.get(code);
    if (!values && !this.loadedTranslations.has(code)) {
      this.switchingTo = code;
      let stored: IContentTranslation | null;
      try {
        stored = this.contentId
          ? await this.draftContentsService.getTranslation(this.typeSlug(), this.contentId, code)
          : null;
      } finally {
        if (turn === this.switchTurn) this.switchingTo = null;
      }
      // Another load of the same language landed first: its copy, perhaps typed in since, stays.
      if (!this.loadedTranslations.has(code)) {
        this.loadedTranslations.add(code);
        this.translationEdits.set(code, this.toTranslatableValues(stored));
      }
      values = this.translationEdits.get(code);
      // A later switch was made while this one loaded: that one is on screen.
      if (turn !== this.switchTurn) return;
      // What was typed, or the stored entry that arrived, meanwhile.
      keepOnScreen();
    }

    this.activeLang.set(code);
    this.translationDirty.set(false);
    this.applyTranslatableValues(values ?? emptyTranslatableValues());
  }

  private toTranslatableValues(stored: IContentTranslation | null): TranslatableValues {
    const values = emptyTranslatableValues();
    if (!stored) return values;
    for (const field of TRANSLATABLE_BUILTIN_FIELDS) {
      const value = stored[field];
      if (typeof value === 'string') values[field] = value;
    }
    values.customFields = { ...(stored.customFields ?? {}) };
    return values;
  }

  /**
   * Normalized signature of the language-varying values, used to tell a real
   * edit from editor noise. TipTap emits an update whenever its input changes,
   * including the empty "<p></p>" it produces on a language switch, so a
   * dirty flag driven purely by change events would always read "unsaved".
   */
  valuesSignature(values: TranslatableValues): string {
    const normalize = (value: unknown): string =>
      typeof value === 'string'
        ? value.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()
        : value === null || value === undefined
          ? ''
          : String(value);

    const custom = Object.keys(values.customFields ?? {})
      .sort()
      .map((key) => `${key}=${normalize(values.customFields[key])}`)
      .join('|');

    return [
      normalize(values.title),
      normalize(values.content),
      normalize(values.summary),
      normalize(values.seoTitle),
      normalize(values.metaDescription),
      custom,
    ].join('\u0000');
  }

  /** Marks the active translation dirty; the base auto-save is not involved. */
  markTranslationDirty(): void {
    if (!this.isTranslating()) return;
    const changed = this.valuesSignature(this.view.capture()) !== this.appliedSignature;
    this.translationDirty.set(changed);
    if (changed) {
      this.dirtyTranslations.add(this.activeLang());
    } else {
      this.dirtyTranslations.delete(this.activeLang());
    }
  }

  /**
   * Keeps only the custom fields that are translatable for this content type.
   *
   * A repeating field is projected down to `{ id, …prose }` per row: the
   * translation document carries the words and the row id that anchors them,
   * never the structure. That makes the default language the single owner of
   * how many rows there are, their order and their images, and lets a row be
   * deleted without stranding a translation on the wrong one.
   */
  translatableCustomFields(values: { [key: string]: any }): Record<string, unknown> {
    const translatable: Record<string, unknown> = {};

    for (const field of this.view.fields()) {
      if (!isTranslatableField(field)) continue;

      if (isRepeaterType(field.type)) {
        const rows = values[field.key];
        if (Array.isArray(rows)) {
          const keys = translatableRepeaterKeys(field);
          translatable[field.key] = rows.map((row: Record<string, unknown>) => {
            const projected: Record<string, unknown> = {};
            for (const key of keys) {
              if (row?.[key] !== undefined) projected[key] = row[key];
            }
            return projected;
          });
        }

        const headingKey = translatableHeadingKey(field);
        if (headingKey && values[headingKey] !== undefined) {
          translatable[headingKey] = values[headingKey];
        }
        continue;
      }

      if (values[field.key] !== undefined) {
        translatable[field.key] = values[field.key];
      }
    }

    return translatable;
  }

  /** Deletes the active translation, reverting the language to base content. */
  async clearTranslation(): Promise<void> {
    if (!this.isTranslating() || !this.contentId || this.heldBy()) return;
    const lang = this.activeLang();

    this.isSavingTranslation.set(true);
    try {
      this.openedModifiedAt = await this.draftContentsService.deleteTranslation(this.typeSlug(), this.contentId, lang) ?? this.openedModifiedAt;
      this.writeWorked();
      this.translatedLanguages.update((langs) => langs.filter((l) => l !== lang));
      this.translationEdits.delete(lang);
      this.loadedTranslations.delete(lang);
      this.applyTranslatableValues(emptyTranslatableValues());
      this.translationDirty.set(false);
      this.notify.success('admin.contents.editor.translation_cleared', {
        language: this.activeLanguageLabel(),
      });
    } catch (error) {
      console.error('Error clearing translation:', error);
      this.notify.error('admin.contents.editor.translation_clear_failed');
    } finally {
      this.isSavingTranslation.set(false);
      void this.settle();
      this.view.refresh();
    }
  }

  // ── The checks on Save and Publish ───────────────────────────────────────
  // Always on the default-language document: required fields belong to the
  // item, not to a translation, and a translation may be on screen.

  /** Save: only the title is required. */
  validateForDraft(): { valid: boolean; errors: string[]; missing: string[] } {
    const errors: string[] = [];
    const missing: string[] = [];
    const base = this.baseLanguageValues();

    if (!base.title || base.title.trim() === '') {
      errors.push(this.requiredMessage(this.t('admin.contents.editor.title_label')));
      missing.push('title');
    }

    return { valid: errors.length === 0, errors, missing };
  }

  /** "{field} is required.", in the admin's language. */
  private requiredMessage(field: string): string {
    return this.t('common.validation.required', { field });
  }

  /**
   * Publish: the title and every required custom field. `missing` lists the
   * offending field keys (`title` for the title) in the order they appear on
   * screen, so the first one is the one to focus.
   */
  validateForPublish(): { valid: boolean; errors: string[]; missing: string[] } {
    const errors: string[] = [];
    const missing: string[] = [];
    const base = this.baseLanguageValues();

    if (!base.title || base.title.trim() === '') {
      errors.push(this.requiredMessage(this.t('admin.contents.editor.title_label')));
      missing.push('title');
    }

    for (const field of this.view.fields().filter(f => f.required)) {
      if (isEmptyFieldValue(base.customFields?.[field.key])) {
        errors.push(this.requiredMessage(this.view.fieldLabel(field)));
        missing.push(field.key);
      }
    }

    return { valid: errors.length === 0, errors, missing };
  }

  // ── Save and Publish ─────────────────────────────────────────────────────

  async saveAsDraft(afterSave?: () => void, overwrite = false): Promise<void> {
    if (this.saveInFlight || this.entryGone() || this.heldBy()) return;
    // A first write still under way: wait for it, then save as an update, so
    // Save never makes a second entry (RF4 review H1).
    if (await this.firstWriteDone()) return;
    // Save acts on the whole item, the default language plus every
    // translation, no matter which language is on screen.
    this.collectCurrentLanguageEdits();

    const validation = this.validateForDraft();
    if (!validation.valid) {
      this.toastService.openCustomSnackbar(validation.errors[0], 'error', 'error');
      this.view.revealMissing(validation.missing);
      return;
    }

    this.saveInFlight = true;
    this.isSavingDraft = true;
    this.saveStatusMessage = this.t('common.actions.saving');
    this.saveStatusType = 'info';
    this.view.refresh();
    try {
      // The address is asked of the server when it changed since it was last
      // found free (4.6).
      if (this.addressNeedsCheck() && !(await this.addressIsFree(() => this.saveAsDraft(undefined, overwrite)))) return;

      const formValues: any = this.buildDraftFormValues();
      if (this.contentId) {
        await this.updateContentInDraft(formValues, undefined, afterSave, overwrite);
      } else {
        await this.addContentInDraft(formValues, false, afterSave);
      }
    } finally {
      // Never left disabled, whatever happened (4.4).
      this.saveInFlight = false;
      this.isSavingDraft = false;
      this.rescheduleIfEdited();
      this.view.refresh();
    }
  }

  /**
   * Waits for a new entry's first write, if one is under way. True when the
   * caller should stop: the write failed, and its "Not saved" line already
   * says so with Retry.
   */
  private async firstWriteDone(): Promise<boolean> {
    if (!this.createPromise) return false;
    await this.createPromise;
    return !this.contentId;
  }

  /** Edits made while Save or Publish ran are saved by the next auto-save (RF4 review M3). */
  private rescheduleIfEdited(): void {
    if (!this.contentId || this.saveFailed() || this.entryChanged() || this.entryGone()) return;
    if (this.hasUnsavedDraftChanges() || this.dirtyTranslations.size > 0 || this.translationDirty()) {
      this.autoSaveTrigger$.next();
    }
  }

  async directPublishContent(overwrite = false): Promise<void> {
    // A second click while the first publish is on its way asks for nothing more.
    if (this.saveInFlight || this.publishing() || this.entryGone() || this.heldBy()) return;
    if (await this.firstWriteDone()) return;
    // Publishing acts on the whole item: the default language and every
    // translation go live together, from whichever language is on screen.
    this.collectCurrentLanguageEdits();

    const validation = this.validateForPublish();
    if (!validation.valid) {
      // The first error; the admin can fix it and try again.
      this.toastService.openCustomSnackbar(validation.errors[0], 'error', 'error');
      this.view.revealMissing(validation.missing);
      return;
    }

    // Outline text still to replace, as the standard pages start with (SS6):
    // ask before it goes live. A warning, not a block.
    if (hasReplacePrompt(this.buildDraftFormValues()) && !(await this.askConfirm({
      titleKey: 'admin.contents.editor.replace_prompt_title',
      message: this.t('admin.contents.editor.replace_prompt_confirm'),
      button: this.t('admin.contents.editor.publish_anyway'),
    }))) {
      return;
    }

    this.saveInFlight = true;
    this.isSavingDraft = true;
    this.saveStatusMessage = this.t('admin.contents.editor.publishing');
    this.saveStatusType = 'info';
    this.view.refresh();
    try {
      if (this.addressNeedsCheck() && !(await this.addressIsFree(() => this.directPublishContent(overwrite)))) return;

      // Preserve publishedOn from existing content; only set on first publish.
      const existingPublishedOn = this.contentId
        ? this.draftContentStore.currentItem()?.publishedOn
        : null;

      const formValues: any = {
        ...this.buildDraftFormValues(),
        status: this.constantVariables.PUBLISH,
        publishedOn: existingPublishedOn || new Date(),
        publishedStatus: true,
        // Whether the live page's old address sends visitors to the new one
        // (4.6). The publish function acts on it only when the address changed.
        redirectOldAddress: this.redirectOldAddress(),
      };

      if (this.contentId) {
        await this.updateContentInDraft(formValues, this.constantVariables.PUBLISH, undefined, overwrite);
      } else {
        await this.addContentInDraft(formValues, true);
      }
    } finally {
      this.saveInFlight = false;
      this.isSavingDraft = false;
      this.rescheduleIfEdited();
      this.view.refresh();
    }
  }

  /**
   * Whether the entry's address may be saved: asked of the server when it
   * changed since it was last found free, for a stored entry too (4.6). A
   * taken address stops the save with a message; a check that could not be
   * made stops it as not saved, with `retry` behind Retry.
   */
  private async addressIsFree(retry: () => void): Promise<boolean> {
    const urlSlug = this.view.address();
    if (!this.addressNeedsCheck()) return true;
    let taken: boolean;
    try {
      taken = await this.draftContentStore.isSlugTaken(urlSlug, this.typeSlug(), this.contentId || undefined);
    } catch (error) {
      console.error('Error checking the address:', error);
      this.notify.error('admin.contents.editor.slug_check_failed');
      this.writeFailed(error, retry);
      return false;
    }
    if (taken) {
      this.saveStatusMessage = '';
      this.errorSlug = true;
      this.notify.error('admin.contents.editor.slug_exists', { slug: urlSlug });
      this.view.refresh();
      return false;
    }
    this.errorSlug = false;
    this.confirmedSlug = urlSlug;
    return true;
  }

  /** The address changed since it was last found free, so the server is asked again. */
  private addressNeedsCheck(): boolean {
    const urlSlug = this.view.address();
    return !!urlSlug && urlSlug !== this.confirmedSlug;
  }

  /** The values a write of the base document adds: the new mark another save compares with (4.5). */
  private stamped<T extends Record<string, any>>(values: T): T & { modifiedAt: Date } {
    return { ...values, modifiedAt: new Date() };
  }

  /**
   * Writes a stored entry. Unless `overwrite`, the stored entry must still
   * be the one the editor opened (4.5). The new mark is kept for the next save.
   */
  private writeDraft(id: string, written: any, overwrite: boolean): Promise<void> {
    // One write at a time: Save pressed while an auto-save is landing must
    // compare with the mark that auto-save leaves, or it would take the
    // editor's own write for someone else's.
    const run = async () => {
      await firstValueFrom(this.draftContentStore.saveDraft(
        id, written, this.typeSlug(), overwrite ? null : this.openedModifiedAt,
      ), { defaultValue: undefined });
      this.openedModifiedAt = written.modifiedAt;
    };
    const next = this.writeQueue.then(run, run);
    this.writeQueue = next.catch(() => undefined);
    return next;
  }

  /** The write under way, which the next one waits for. */
  private writeQueue: Promise<unknown> = Promise.resolve();

  /**
   * A write that did not land. Someone else's save shows Reload theirs and
   * Keep mine (4.5); anything else shows "Not saved" with Retry, which stays
   * until a write works (4.4).
   */
  private writeFailed(error: unknown, retry: () => void, overwrite?: () => void): void {
    this.saveStatusMessage = '';
    if (isHeld(error)) {
      // Someone else made the first change, or took over: their work is theirs, the words here stay to copy.
      this.heldBy.set((error as HeldError).hold);
      this.lostWords.set(true);
      this.saveFailed.set(false);
      this.retryAction = null;
    } else if (isEntryGone(error)) {
      // Deleted by someone else: no Retry would ever work (RF4 review L3).
      this.entryGone.set(true);
      this.saveFailed.set(false);
      this.retryAction = null;
    } else if (isEntryChanged(error) && overwrite) {
      this.overwriteAction = overwrite;
      this.entryChanged.set(true);
    } else {
      console.error('Error saving content:', error);
      this.retryAction = retry;
      this.saveFailed.set(true);
    }
    this.view.refresh();
  }

  /** A write landed: whatever failed before is behind us. */
  private writeWorked(): void {
    this.savedSincePublish = true;
    if (this.publishedState() === 'published') this.publishedState.set('edited');
    this.saveFailed.set(false);
    this.retryAction = null;
  }

  /** Retry on the "Not saved" line: the write that failed, again. */
  retrySave(): void {
    const action = this.retryAction;
    if (!action) return;
    this.saveFailed.set(false);
    action();
  }

  /** Keep mine: the save that stopped, written over the other admin's (4.5). */
  keepMine(): void {
    const action = this.overwriteAction;
    this.overwriteAction = null;
    this.entryChanged.set(false);
    action?.();
  }

  /** Reload theirs: the stored entry replaces what is on screen, every language included (4.5). */
  async reloadTheirs(): Promise<void> {
    this.overwriteAction = null;
    this.entryChanged.set(false);
    this.lostWords.set(false);
    this.saveFailed.set(false);
    this.retryAction = null;
    if (this.isTranslating()) await this.switchLanguage(this.defaultLang());
    this.baseStash = null;
    this.translationEdits.clear();
    this.loadedTranslations.clear();
    this.dirtyTranslations.clear();
    this.translationDirty.set(false);
    this.storedEcho = null;
    this.loadById(this.contentId);
    void this.refreshTranslatedLanguages();
  }

  /**
   * Writes a new entry: on its first title or body input (4.1), or from Save
   * or Publish. The screen is told its id (the form editor shows the entry's
   * own address, without leaving the page, so a reload opens it).
   */
  private async addContentInDraft(formValues: any, isPublish = false, afterSave?: () => void, fromInput = false): Promise<void> {
    let finish!: () => void;
    this.createPromise = new Promise<void>((resolve) => (finish = resolve));
    try {
      await this.createEntry(formValues, isPublish, afterSave, fromInput);
    } finally {
      this.createPromise = null;
      finish();
    }
  }

  private async createEntry(formValues: any, isPublish: boolean, afterSave: (() => void) | undefined, fromInput: boolean): Promise<void> {
    const savedSignature = this.draftSignature(formValues);
    const stamp = new Date();
    // One id for this entry, kept for a retry: a write that landed but was
    // reported failed is written again, not made twice (RF4 review H1, L1).
    this.newEntryId ??= this.draftContentStore.newDraftId(this.typeSlug());
    // The list's Status filter is a server query, which skips a record without the field.
    const data = { publishedStatus: false, ...formValues, createdAt: stamp, modifiedAt: stamp };
    this.creating.set(true);
    this.view.refresh();
    let newId: string;
    try {
      newId = await firstValueFrom(this.draftContentStore.createDraft(data, this.typeSlug(), this.newEntryId));
    } catch (error) {
      this.creating.set(false);
      // A retry never reruns a Preview's window.open (RF4 review L6).
      this.writeFailed(error, () => void (fromInput
        ? this.createOnFirstInput()
        : isPublish ? this.directPublishContent() : this.saveAsDraft()));
      return;
    }
    this.creating.set(false);
    this.writeWorked();

    // Not through a load: that would fill the screen from the stored entry and
    // drop anything typed while this write ran. The store holds it as loaded,
    // for a later publish and the reference sync (RF4 review M4).
    this.contentId = newId;
    this.draftContentStore.adoptCreated({ ...data, id: newId });
    this.storedEcho = untracked(() => this.draftContentStore.currentItem());
    // Not through a load: what that would set is set here.
    this.entryRead.set(true);
    this.follow(newId);
    this.openedModifiedAt = stamp;
    this.lastDraftSavedDate = new Date();
    // See updateContentInDraft: what was written is the clean state.
    this.savedDraftSignature = savedSignature;
    this.view.entryCreated(newId);

    // Before any await: see updateContentInDraft (window.open).
    if (afterSave) {
      afterSave();
    }

    // Translations belong to the same save. Written before the publish
    // is enqueued so the pipeline copies what was just saved.
    // A publish waits for them: the page must not go live without a translation just typed.
    const translated = await this.persistPendingTranslations(newId, isPublish ? () => void this.directPublishContent() : undefined);

    // Only now does the entry have an id for the others to point at.
    await this.syncSeriesBacklinks(newId, formValues);

    if (isPublish) {
      if (translated) await this.enqueuePublish(newId);
    } else {
      if (translated) this.showSaved();
    }

    // Typed while the first write ran: saved by the next one.
    if (this.hasUnsavedDraftChanges()) this.autoSaveTrigger$.next();
    this.view.refresh();
  }

  /** "Saved", for a few seconds. */
  private showSaved(): void {
    this.saveStatusMessage = this.t('admin.contents.editor.saved');
    this.saveStatusType = 'success';
    this.view.refresh();
    setTimeout(() => {
      if (this.saveStatusType === 'success') {
        this.saveStatusMessage = '';
        this.view.refresh();
      }
    }, 3000);
  }

  private async updateContentInDraft(formValues: any, type?: string, afterSave?: () => void, overwrite = false): Promise<void> {
    formValues.updatedAt = new Date();

    const savedSignature = this.draftSignature(formValues);
    // The reference sync compares with what was stored before this write.
    const id = this.contentId;
    const before = untracked(() => this.draftContentStore.currentItem());
    const isPublish = type === this.constantVariables.PUBLISH;

    // Series links the editor did not change are left as they are stored.
    const written = this.stamped(this.withChangedSeriesLinks(formValues));

    try {
      await this.writeDraft(id, this.marked(written), overwrite);
    } catch (error) {
      // A retry never reruns a Preview's window.open (RF4 review L6).
      const again = (force: boolean) => isPublish ? this.directPublishContent(force) : this.saveAsDraft(undefined, force);
      this.writeFailed(error, () => again(false), () => again(true));
      return;
    }
    this.writeWorked();

    this.refreshStoredItem(id, written);
    this.lastDraftSavedDate = new Date();
    // What we just wrote is now the clean state. Without this a pending
    // auto-save debounce fires later and rewrites the document, bumping
    // modifiedAt past lastPublishedAt and making a just-published item
    // report as "Edited" with nobody having touched it.
    this.savedDraftSignature = savedSignature;

    // Run the caller's continuation before any await: a window.open deferred
    // past a microtask loses the user-gesture context and browsers block it.
    if (afterSave) {
      afterSave();
    }

    // Translations belong to the same save. Written before the publish is
    // enqueued so the pipeline copies what was just saved.
    // A publish waits for them: the page must not go live without a translation just typed.
    const translated = await this.persistPendingTranslations(id, isPublish ? () => void this.directPublishContent() : undefined);

    if (isPublish) {
      if (translated) await this.enqueuePublish(id);
    } else {
      if (translated) this.showSaved();
    }

    // Cascading updates for content that references this one. The series
    // links are transactions, which fail at once offline. The other two write
    // in batches, which wait for a connection: they run after Save and
    // Publish are free again, not before (RF4 review M6).
    await this.syncSeriesBacklinks(id, written);
    void this.updateReferencingContents(formValues, id)
      .then(() => this.triggerCollectionRefSync(formValues, before, id));
    this.view.refresh();
  }

  /**
   * Hands the entry to the publish function and shows "Publishing" until its
   * page is live (4.3). Waits for the queue write: a publish that could not
   * start says so, and the line stays.
   */
  private async enqueuePublish(id: string): Promise<void> {
    this.saveStatusMessage = '';
    this.publishProblem.set('');
    this.deployError.set('');
    this.deployStatus.set('pending');
    this.savedSincePublish = false;
    this.view.refresh();
    try {
      await this.publishQueueService.enqueue('publish', this.typeSlug(), id);
    } catch (error) {
      console.error('Error starting the publish:', error);
      this.deployStatus.set('failed');
      this.publishProblem.set('start');
      this.view.refresh();
      return;
    }
    // Published: the address is the live one now, and no longer follows the title.
    this.slugFollowsTitle = false;
    this.publishedSlug.set(this.view.address());
    this.redirectOldAddress.set(true);
    this.startDeployStatusPolling(id);
  }

  /** Shows "Publishing" until the page is live, and a failure that stays (4.3). */
  private startDeployStatusPolling(docId: string): void {
    this.deployStatusSubscription?.unsubscribe();

    this.deployStatus.set('pending');
    this.deployError.set('');
    this.publishProblem.set('');

    this.deployStatusSubscription = this.contentsService
      .pollDeployStatus(docId, this.typeSlug())
      .subscribe({
        next: (status) => {
          this.ngZone.run(() => {
            // No answer within the wait: a failure, said so, that stays.
            if (status.deployErrorCode === 'TIMEOUT') {
              this.deployStatus.set('failed');
              this.publishProblem.set('no_answer');
              this.deployError.set(status.deployError || '');
              console.error('Publishing gave no answer:', status.deployError);
              this.view.refresh();
              return;
            }
            // Not finished yet (the page is still being built): still publishing.
            if (!status.deployStatus) return;
            this.deployStatus.set(status.deployStatus);
            this.deployError.set(status.deployError || '');

            if (status.deployStatus === 'deployed' || status.deployStatus === 'skipped') this.publishLanded(docId);
            if (status.deployStatus === 'deployed') {
              this.notify.success('admin.contents.editor.deployed_success');
            } else if (status.deployStatus === 'skipped') {
              this.notify.info('admin.contents.editor.deploy_skipped_info');
            } else if (status.deployStatus === 'failed') {
              // A plain sentence for the admin; the technical detail stays in the console (RF5 5.2).
              console.error('Publishing failed:', status.deployErrorCode, status.deployError);
              this.publishProblem.set(status.deployErrorCode === 'TEMPLATE_FOLDER_MISSING' ? 'template' : 'build');
              this.notify.error('admin.contents.editor.publish_failed_toast');
            }

            this.view.refresh();
          });
        },
        error: (err) => {
          console.error('Deploy status polling error:', err);
          this.deployStatus.set('failed');
          this.publishProblem.set('no_answer');
          this.view.refresh();
        },
      });
  }

  /** The save with the page the change was made on (VE-D72), kept out of what the screen compares. */
  private marked(written: any): any {
    if (typeof this.cardOnPage === 'string') return { ...written, changedOnPage: this.cardOnPage };
    if (this.cardOnPage === undefined && this.storedDraft?.['changedOnPage']) return { ...written, changedOnPage: deleteField() };
    return written;
  }

  // ── The hold ─────────────────────────────────────────────────────────────

  /** The entry's draft, as a hold names it. */
  draftPath(): string {
    return this.contentId ? `arc_${this.typeSlug()}_drafts/${this.contentId}` : '';
  }

  /** Follows who holds the entry, and what is published, once per entry. */
  private follow(id: string): void {
    const path = `arc_${this.typeSlug()}_drafts/${id}`;
    if (!this.typeSlug() || this.followedPath === path) return;
    for (const stop of this.stopFollowing) stop();
    this.stopFollowing = [];
    this.followedPath = path;
    this.storedDraft = null;
    this.heldBy.set(null);
    this.lostWords.set(false);
    this.publishedCopy.set(null);
    this.followsPublished = '';
    this.stopFollowing.push(this.holds.follow(path, (data, pending) => this.draftChanged(data, pending)));
    this.followPublished(id);
  }

  private followsPublished = '';

  private followPublished(id: string): void {
    if (!this.publishedId || this.followsPublished === id) return;
    this.followsPublished = id;
    this.stopFollowing.push(this.holds.follow(`arc_${this.typeSlug()}/${id}`, (data) => {
      const before = this.publishedCopy();
      this.publishedCopy.set(data);
      // Someone else's publish: History and the date follow it (VE-D71). One pressed here answers when its page is live.
      // The copy's own date stays with every publish; when it was published last tells one from the next.
      const publishedAt = (copy: Record<string, any> | null) => toDate(copy?.['lastPublishedAt']) ?? toDate(copy?.['publishedOn']);
      const at = publishedAt(data);
      if (before && at && at.getTime() !== publishedAt(before)?.getTime() && this.deployStatus() !== 'pending') {
        this.lastPublishedDate = at;
        this.publishesLanded.update((n) => n + 1);
        this.view.refresh();
      }
      void this.settle();
    }));
  }

  /** The stored draft changed: here, by someone else, or who holds it did. */
  private draftChanged(data: Record<string, any> | null, pending: boolean): void {
    const me = this.holds.me();
    // Our own write on its way: the answer follows.
    if (!data || pending || !me) return;
    const stored = this.storedDraft;
    this.storedDraft = data;
    const hold = heldByOther(data, me.uid);
    const was = this.heldBy();
    // The publish function moved the mark and no words: not someone else's save.
    if (!hold && !was && stored && !entryChanges({ draft: data, published: stored, fields: this.view.fields() }).length) {
      this.openedModifiedAt = data['modifiedAt'] ?? this.openedModifiedAt;
    }
    const theirs = changedSinceOpened(this.openedModifiedAt, data['modifiedAt']);
    this.heldBy.set(hold);
    if (hold && !was && this.hasWordsToLose()) {
      this.lostWords.set(true);
    } else if (!hold && was && this.lostWords()) {
      this.wordsFree(theirs);
    } else if ((hold || was) && !this.lostWords() && theirs) {
      // View only: the screen follows their work (VE-D79), and shows it once they let go.
      void this.showStored(data);
    }
    void this.settle();
    this.view.refresh();
  }

  /** They let go while words here were not saved: ask which to keep when theirs differ, else save these. */
  private wordsFree(theirs: boolean): void {
    this.lostWords.set(false);
    if (!theirs) {
      this.rescheduleIfEdited();
      return;
    }
    this.overwriteAction = () => void this.performAutoSave(true);
    this.entryChanged.set(true);
  }

  /** Words on screen that no save has written. */
  private hasWordsToLose(): boolean {
    return this.hasBaseline() && (this.hasUnsavedDraftChanges() || this.translationDirty() || this.dirtyTranslations.size > 0);
  }

  /**
   * The stored entry on screen again, in the language being read. The default
   * language is filled first, then the language: a translation opened over the
   * old screen would keep its words and write them back later.
   */
  private async showStored(stored?: Record<string, any>): Promise<void> {
    const id = this.contentId;
    const data = stored ?? await this.holds.read(this.draftPath());
    if (!data || this.contentId !== id) return;
    const lang = this.activeLang();
    if (this.isTranslating()) await this.switchLanguage(this.defaultLang());
    this.overwriteAction = null;
    this.entryChanged.set(false);
    this.lostWords.set(false);
    this.saveFailed.set(false);
    this.retryAction = null;
    this.baseStash = null;
    this.translationEdits.clear();
    this.loadedTranslations.clear();
    this.dirtyTranslations.clear();
    this.translationDirty.set(false);
    const item = { ...data, id } as any;
    this.draftContentStore.adoptCreated(item);
    this.storedEcho = untracked(() => this.draftContentStore.currentItem());
    this.load(item);
    void this.refreshTranslatedLanguages();
    if (lang && lang !== this.defaultLang()) {
      // After the load has settled, so what it filled is what the language goes over.
      await new Promise((resolve) => setTimeout(resolve, 0));
      await this.switchLanguage(lang);
    }
    this.view.refresh();
  }

  /** Something is being saved or is still to save, so what is stored is not the last word yet. */
  private unsettled(): boolean {
    return this.isSavingDraft || this.isAutoSaving || this.creating() || this.savingTranslations || this.isSavingTranslation()
      || this.dirtyTranslations.size > 0 || this.translationDirty() || this.deployStatus() === 'pending'
      || (this.hasBaseline() && this.hasUnsavedDraftChanges());
  }

  private settling = false;
  private settleAgain = false;

  /**
   * Once nothing is left to save: whether the stored words are what is live, every
   * language, whatever the dates say (VE6.B1). When they are, this person lets go of
   * the entry (VE-D76). One at a time; a change while it reads asks again.
   */
  private async settle(): Promise<void> {
    if (this.settling) {
      this.settleAgain = true;
      return;
    }
    this.settling = true;
    try {
      do {
        this.settleAgain = false;
        await this.settleOnce();
      } while (this.settleAgain);
    } catch (error) {
      // The dates say where it stands; the next save looks again.
      console.error('[EntryDraft] Could not compare with what is live:', error);
    } finally {
      this.settling = false;
    }
  }

  private async settleOnce(): Promise<void> {
    const published = this.publishedCopy();
    const draft = this.storedDraft;
    if (!published || !draft || this.publishedState() === 'draft' || this.unsettled()) return;
    const mine = !this.heldBy() && holdOf(draft)?.by === this.holds.me()?.uid;
    // Nobody has changes and the dates agree: nothing to read.
    if (this.publishedState() === 'published' && !mine) return;
    const base = entryChanges({ draft, published, fields: this.view.fields() });
    const changed = base.length > 0 || (await this.changes()).length > 0;
    // Something moved while the languages were read: another settle follows it.
    if (this.storedDraft !== draft || this.unsettled()) return;
    this.publishedState.set(changed ? 'edited' : 'published');
    if (!changed) {
      this.publishedStateKnown.set(true);
      if (mine) {
        const stamp = await this.holds.letGo(this.typeSlug(), this.contentId, this.view.fields());
        if (stamp) this.openedModifiedAt = stamp;
      }
    }
    this.view.refresh();
  }

  /** What differs from what is live: every field, every language (VE-D80). Everything, when nothing is. */
  async changes(): Promise<Change[]> {
    if (!this.draftPath()) return [];
    return this.holds.entryChanges(this.typeSlug(), this.contentId, this.view.fields());
  }

  /** Counts what adds a kept draft, so History reads them again. */
  readonly keptChanged = signal(0);

  /** Take over (VE-D81) from the person shown: their draft is kept, and the entry is this person's to change. */
  async takeOver(): Promise<boolean> {
    const hold = this.heldBy();
    if (!hold) return false;
    const taken = await this.holds.takeOver(this.draftPath(), hold.by);
    if (!taken) return false;
    this.heldBy.set(null);
    this.lostWords.set(false);
    this.keptChanged.update((n) => n + 1);
    await this.showStored();
    return true;
  }

  /**
   * Publish these (VE-D80): someone else's changes as they are, through the same
   * checks. Their hold ends when the publish lands; nothing of theirs is written.
   */
  async publishTheirs(): Promise<void> {
    if (!this.heldBy() || this.saveInFlight || this.publishing() || this.entryGone()) return;
    const validation = this.validateForPublish();
    if (!validation.valid) {
      this.toastService.openCustomSnackbar(validation.errors[0], 'error', 'error');
      return;
    }
    if (hasReplacePrompt(this.buildDraftFormValues()) && !(await this.askConfirm({
      titleKey: 'admin.contents.editor.replace_prompt_title',
      message: this.t('admin.contents.editor.replace_prompt_confirm'),
      button: this.t('admin.contents.editor.publish_anyway'),
    }))) return;
    this.saveInFlight = true;
    try {
      await this.holds.markPublished(this.draftPath());
    } catch (error) {
      console.error('Error publishing:', error);
      this.deployStatus.set('failed');
      this.publishProblem.set('start');
      this.view.refresh();
      return;
    } finally {
      this.saveInFlight = false;
    }
    await this.enqueuePublish(this.contentId);
  }

  /** What is on screen and not stored goes first, so nothing is half put back or lost. Throws when it cannot. */
  private async storeScreen(): Promise<void> {
    if (this.heldBy()) throw new HeldError(this.heldBy()!);
    if (this.hasUnsavedChanges()) await this.saveAsDraft();
    if (this.heldBy() || this.hasUnsavedChanges()) throw new Error('What is on screen could not be saved.');
  }

  /** Puts one change back to what is live (VE-D83); without one, everything: Discard changes. */
  async putBack(change?: Change): Promise<void> {
    await this.storeScreen();
    if (!change) await this.holds.keep(this.draftPath(), 'discard');
    await this.holds.restorePublished(this.typeSlug(), this.contentId, this.view.fields(), change);
    this.keptChanged.update((n) => n + 1);
    await this.showStored();
  }

  /** Restores a kept draft (VE-D84): it becomes the draft, which then needs Publish. */
  async restoreKept(kept: KeptDraft): Promise<{ addressTaken: boolean }> {
    await this.storeScreen();
    const done = await this.holds.restoreKept(this.typeSlug(), this.contentId, kept);
    this.keptChanged.update((n) => n + 1);
    await this.showStored();
    return done;
  }

  /** The date the entry's page shows: when it was first published, whenever it last was. */
  publishDate(): Date | null {
    const stored: any = this.draftContentStore.currentItem();
    return toDate(this.publishedCopy()?.['publishedOn']) ?? toDate(stored && stored.id === this.contentId ? stored.publishedOn : null) ?? this.lastPublishedDate;
  }

  /** The entry's state in the words every editor uses (VE-D70). */
  editState(): EditState {
    return editState({
      saving: this.isSavingDraft || this.isAutoSaving || this.creating()
        || (!this.heldBy() && !this.offline() && this.hasUnsavedChanges() && !this.saveFailed() && !this.entryChanged() && !this.entryGone()),
      failed: this.saveFailed() || this.entryChanged() || this.entryGone() || this.lostWords()
        || (this.offline() && !this.heldBy() && this.hasUnsavedChanges()),
      publishing: this.deployStatus() === 'pending',
      changed: this.publishedState() === 'edited',
      live: this.publishedState() !== 'draft',
    });
  }

  /** A publish is on its way to the site: Publish waits for it (it ends in a failure after the wait). */
  publishing(): boolean {
    return this.deployStatus() === 'pending';
  }

  /** Publish has nothing to do: what is stored is live, and the dates can tell (VE-D73). */
  nothingToPublish(): boolean {
    return this.editState() === 'published' && this.publishedStateKnown() && this.deployStatus() !== 'failed';
  }

  /** The published copy is this draft, unless something was saved since Publish was asked for. */
  private publishLanded(id: string): void {
    this.publishedId = id;
    this.followPublished(id);
    this.lastPublishedDate = new Date();
    this.publishedState.set(this.savedSincePublish ? 'edited' : 'published');
    this.publishedStateKnown.set(true);
    this.publishesLanded.update((n) => n + 1);
    void this.settle();
  }

  /**
   * Publish again after a failure: the draft is already stored, so only the
   * publish is asked for once more. Not while a save, a publish or another
   * Publish again is under way (RF4 review L5).
   */
  async retryDeployment(): Promise<void> {
    if (!this.contentId || !this.typeSlug()) return;
    if (this.saveInFlight || this.republishing || this.deployStatus() === 'pending') return;
    this.republishing = true;
    try {
      await this.enqueuePublish(this.contentId);
    } finally {
      this.republishing = false;
    }
  }

  // ── Auto-save ────────────────────────────────────────────────────────────

  /**
   * A quiet save: no navigation, no publish, little on screen. It never
   * writes over someone else's save: it stops and asks (4.5).
   */
  async performAutoSave(overwrite = false): Promise<void> {
    if (!this.contentId || this.isSavingDraft || this.isAutoSaving || this.creating() || this.entryGone() || this.heldBy()) return;
    if (this.entryChanged() && !overwrite) return;

    // Fold whatever language is on screen into its stash first. The base
    // document is then written from the default-language values regardless of
    // which language is on screen: without this, a debounce armed on the
    // default language and fired after a switch would overwrite the
    // default-language content with the translation.
    this.collectCurrentLanguageEdits();

    // Re-checked here too: performAutoSave is also reachable directly.
    if (!this.hasUnsavedDraftChanges() && this.dirtyTranslations.size === 0) return;

    const formValues = this.buildDraftFormValues();
    const savedSignature = this.draftSignature(formValues);
    // Quiet: every few seconds a toast would only distract. "Auto-saved"
    // shows beside the status once it lands.
    this.isAutoSaving = true;

    const id = this.contentId;
    // Series links the editor did not change are left as they are stored.
    const written = this.stamped(this.withChangedSeriesLinks(formValues));
    try {
      await this.writeDraft(id, this.marked(written), overwrite);
    } catch (error) {
      this.isAutoSaving = false;
      this.writeFailed(error, () => void this.performAutoSave(), () => void this.performAutoSave(true));
      return;
    }
    this.isAutoSaving = false;
    this.writeWorked();
    this.refreshStoredItem(id, written);
    this.lastDraftSavedDate = new Date();
    this.justAutoSaved.set(true);
    // What was written, not what is on screen now: an edit made while this
    // write ran is still to save.
    this.savedDraftSignature = savedSignature;
    void this.persistPendingTranslations(id);
    // Picking Next or Previous auto-saves, so the links follow here too.
    void this.syncSeriesBacklinks(id, written)
      .then(() => this.updateReferencingContents(formValues, id));
    if (this.hasUnsavedDraftChanges()) this.autoSaveTrigger$.next();
    this.view.refresh();

    setTimeout(() => {
      this.justAutoSaved.set(false);
      this.view.refresh();
    }, 3000);
  }

  /** Something changed on screen: the preview follows, and the entry saves itself after a pause. */
  triggerAutoSave(): void {
    this.edited$.next();
    // An edit before loading settled (an echo settles first): the load's baseline stands.
    if (this.settleTimer) {
      clearTimeout(this.settleTimer);
      this.settleTimer = null;
      this.awaitingBaselineCapture = false;
      this.view.echoesDone?.();
    }
    // Every change shows in the live preview, saved or not (VE1.5).
    this.schedulePreview();
    // While a translation is on screen the change belongs to that language;
    // auto-save then persists the base document *and* the pending translations
    // together, exactly like Save.
    if (this.isTranslating()) {
      this.markTranslationDirty();
    }
    // A new entry is written on its first title or body input, so from then
    // on it saves itself like any other (4.1).
    if (!this.contentId) {
      void this.createOnFirstInput();
      return;
    }
    this.autoSaveTrigger$.next();
  }

  /**
   * A value the editor set itself changed (the address worked out from the title, which
   * arrives after the server says it is free): the entry saves it like an edit, without
   * marking a translation as changed. Before the first write, that write takes it.
   */
  saveSoon(): void {
    if (this.contentId) this.autoSaveTrigger$.next();
  }

  /** Whether a new entry has a title or a body worth keeping. */
  hasTypedSomething(): boolean {
    const base = this.baseLanguageValues();
    return !!(base.title || '').trim() || !!summaryPlainText(base.content || '');
  }

  /** Writes a new entry once it has a title or body (4.1). */
  async createOnFirstInput(): Promise<void> {
    if (this.contentId || this.creating() || this.createPromise || this.saveInFlight || this.offline()) return;
    if (!this.typeSlug() || !this.hasTypedSomething()) return;
    this.collectCurrentLanguageEdits();
    await this.addContentInDraft(this.buildDraftFormValues(), false, undefined, true);
  }

  /**
   * Something on screen is not stored yet: an edit the auto-save has not
   * written, a write under way or one that failed. The leave guard and the
   * browser's own question on closing the tab ask before it is lost (4.2).
   */
  hasUnsavedChanges(): boolean {
    if (this.isSavingDraft || this.isAutoSaving || this.creating()) return true;
    if (this.saveFailed() || this.entryChanged() || this.entryGone()) return true;
    if (!this.view?.ready()) return false;
    // Every language, not only the default one (RF4 review L11).
    if (this.translationDirty() || this.dirtyTranslations.size > 0) return true;
    if (!this.contentId) return this.hasTypedSomething();
    // Not loaded yet: nothing on screen to lose.
    if (this.savedDraftSignature === null) return false;
    return this.hasUnsavedDraftChanges();
  }

  /** The browser lost its connection. */
  goneOffline(): void {
    this.offline.set(true);
    this.view.refresh();
  }

  /** Back online: a write that failed is tried again at once. */
  backOnline(): void {
    this.offline.set(false);
    if (this.saveFailed()) this.retrySave();
    else if (!this.contentId) void this.createOnFirstInput();
    this.view.refresh();
  }

  /** Arc CMS's own question dialog, never the browser's (4.10): true when the admin pressed the confirm button. */
  async askConfirm(options: { titleKey: TranslationKey; message: string; button: string; warn?: boolean }): Promise<boolean> {
    const ref = this.dialog.open(ConfirmationPopupComponent, {
      width: '380px',
      maxWidth: '92vw',
      data: {
        titleKey: options.titleKey,
        dialogMessage: escapeHtml(options.message),
        btnText: options.button,
        panelType: options.warn ? 'warn' : 'primary',
      },
    });
    return (await firstValueFrom(ref.afterClosed(), { defaultValue: undefined })) === true;
  }

  // ── Entries that point at this one ───────────────────────────────────────

  /** Keeps other entries' copies of this one's data (collection reference fields) in step. */
  private async triggerCollectionRefSync(formValues: any, originalData: any, id: string = this.contentId): Promise<void> {
    const contentType = this.typeSlug() || formValues.type;
    if (!contentType) return;

    try {
      await this.collectionRefSyncService.syncReferencedData(
        contentType,
        id,
        formValues,
        originalData, // what was stored before this save, for optimization
      );
    } catch (error) {
      console.error('Error syncing collection references:', error);
      // Non-blocking
    }
  }

  /**
   * Refresh the copy of this entry kept by entries whose Next or Previous
   * points at it, after its title, summary (metaDescription) or slug changed.
   * Entries whose copy already matches are not touched.
   */
  private async updateReferencingContents(formValues: any, id: string = this.contentId): Promise<void> {
    if (!id) return;
    const { title, summary, slug } = seriesReference(id, {
      ...formValues,
      title: formValues.title || this.view.pageTitle() || '',
    });
    try {
      await this.draftContentStore.updateNextContentReferences(id, { title, summary, slug }, this.typeSlug());
      await this.draftContentStore.updatePreviousContentReferences(id, { title, summary, slug }, this.typeSlug());
    } catch (error) {
      console.error('Error updating referencing contents:', error);
      // Don't block the save operation on cascading update failure
    }
  }

  /**
   * The values a save of a stored entry writes: a series link still pointing
   * where it pointed when the editor last loaded or saved it is left out, so
   * the stored one stands. Another editor's save may have set it in the
   * meantime (picking this entry as its Next sets this entry's Previous), or
   * removed it; writing the editor's older copy would undo that.
   */
  private withChangedSeriesLinks(values: any): any {
    const stored = this.storedSeriesLinks;
    if (!stored) return values;
    const written = { ...values };
    for (const field of SERIES_FIELDS) {
      if (linkedId(written[field]) === linkedId(stored[field])) delete written[field];
    }
    return written;
  }

  /**
   * Keep the other side of this entry's series links in step after a save:
   * the entry picked as Next gets this one as its Previous, the entry picked
   * as Previous gets this one as its Next, and an entry no longer picked loses
   * the link back. Only once the entry has a real id, only for a link the save
   * changed, and never over a link an editor pointed at another entry
   * (series-links.ts). A link whose backlink could not be written is kept
   * as not yet saved, so the next save asks for that backlink again.
   */
  private async syncSeriesBacklinks(id: string, written: any): Promise<void> {
    const contentType = this.typeSlug() || written?.type;
    if (!id || !contentType) return;
    // Compared with the links as last loaded or saved (none for a new entry),
    // then those become the saved ones for the next save. A link the save
    // left out (see withChangedSeriesLinks) keeps its stored value.
    const before = this.storedSeriesLinks;
    const after: SeriesLinks = {};
    for (const field of SERIES_FIELDS) {
      after[field] = field in written ? written[field] ?? null : before?.[field] ?? null;
    }
    this.storedSeriesLinks = after;
    const changes = planBacklinks(id, before, after);
    if (changes.length === 0) return;
    const owner = seriesReference(id, { ...written, title: written.title || this.view.pageTitle() || '' });
    let failed: BacklinkChange[];
    try {
      ({ failed } = await this.draftContentStore.applyBacklinks(contentType, owner, changes));
    } catch (error) {
      console.error('Error updating series links:', error);
      // Non-blocking, like the other reference updates
      failed = changes;
    }
    for (const change of failed) {
      // The field on this entry whose change asked for the failed backlink.
      const field: SeriesField = BACKLINK_FIELD[change.field];
      const stored: SeriesLinks | null = this.storedSeriesLinks;
      // Unless a later save moved the link on already.
      if (stored && linkedId(stored[field]) === linkedId(after[field])) {
        this.storedSeriesLinks = { ...stored, [field]: before?.[field] ?? null };
      }
    }
  }

  // ── Live preview (specs/visual-editing-spec.md, VE1.5) ──────────────────
  /** The channel to the preview window; open once Preview is pressed, or when a saved entry loads. */
  private previewChannel: PreviewChannel | null = null;
  /** This editor session's key, fixed for its life (a new entry keeps its key after its first save). */
  previewKey = '';
  /** The saved entry the channel was opened for, '' for a new entry (which keeps its channel once saved). */
  private previewFor = '';
  /** The preview window's name: one window per entry (VE-D5). */
  private previewName = '';
  private previewTimer: ReturnType<typeof setTimeout> | null = null;
  /** The field last outlined, so moving within one field does not outline it again. */
  private lastHighlighted = '';
  /** How long after the last change the draft goes to the preview. */
  static readonly PREVIEW_DELAY_MS = 150;

  /**
   * Opens the preview window, or brings it forward when it is open: one per
   * entry. It shows the draft as it is on screen, so nothing is saved first,
   * and works for an entry not saved yet.
   */
  openPreview(): void {
    const type = this.entryType();
    if (!type || typeof window === 'undefined') return;
    this.connectPreview(true);
    this.previewName ||= previewWindowName(type, this.contentId);
    const url = previewUrl(type, this.contentId, this.previewKey);
    // Opened by name with no address first, so a window already showing this entry
    // is brought forward rather than reloaded.
    const win = window.open('', this.previewName);
    if (!win) {
      this.notify.error('admin.contents.editor.preview_blocked');
      return;
    }
    let fresh = true;
    try {
      fresh = win.location.href === 'about:blank';
    } catch {
      fresh = true;
    }
    if (fresh) win.location.href = url;
    win.focus();
    this.sendPreviewState();
  }

  /**
   * Opens the channel. A saved entry's key is its type and id, so an editor opened
   * again finds a preview window left open; a new entry's channel opens with Preview.
   */
  connectPreview(force = false): void {
    // The screen moved to another saved entry: that entry gets a channel and a window of its own.
    if (this.previewChannel && this.previewFor && this.contentId && this.previewFor !== this.contentId) {
      this.previewLeaving();
      this.previewChannel.close();
      this.previewChannel = null;
      this.previewName = '';
    }
    if (this.previewChannel || typeof window === 'undefined') return;
    const type = this.entryType();
    if (!type || (!force && !this.contentId)) return;
    this.previewKey = previewSessionKey(type, this.contentId);
    this.previewFor = this.contentId;
    this.previewChannel = new PreviewChannel(this.previewKey, (message) => this.onPreviewMessage(message));
    window.addEventListener('pagehide', this.previewLeaving);
    this.schedulePreview();
  }

  private previewLeaving = (): void => this.previewChannel?.post({ kind: 'bye', from: 'editor' });

  /**
   * The Visual Editor's own frame (review H2): a channel only this screen and its frame
   * share, so another tab editing the same entry never draws its draft in this one's page,
   * and an entry not saved yet is drawn from the first moment. The preview window keeps
   * the entry's shared channel (VE-D5).
   */
  private frameChannel: PreviewChannel | null = null;

  connectFrame(key: string): void {
    if (this.frameChannel || !key || typeof window === 'undefined') return;
    this.frameChannel = new PreviewChannel(key, (message) => {
      if (message.kind === 'hello') this.sendFrameState();
      else this.onPreviewMessage(message);
    });
    this.schedulePreview();
  }

  /**
   * While a spot on the edit-on-page screen is being typed in, the page there
   * shows the change already and must not be redrawn under the cursor
   * (VE-D16): the draft goes when the spot is left.
   */
  private previewHeld = false;

  holdPreview(hold: boolean): void {
    if (this.previewHeld === hold) return;
    this.previewHeld = hold;
    if (!hold) this.schedulePreview();
  }

  /** Sends the draft about 150 ms after the last change. */
  schedulePreview(): void {
    if (!this.previewChannel && !this.frameChannel) return;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => {
      this.previewTimer = null;
      this.sendPreviewState();
    }, EntryDraftSession.PREVIEW_DELAY_MS);
  }

  /**
   * The draft exactly as a save would write it (VE-D2), with the language on
   * screen and, for a translation, its unsaved values.
   */
  previewState(): { draft: Record<string, any>; lang: string; translation: IContentTranslation | null } {
    this.drawingPage = true;
    try {
      return this.buildPreviewState();
    } finally {
      this.drawingPage = false;
    }
  }

  /**
   * True while the draft is read for the page drawn in a preview, never for a save:
   * the Visual Editor draws a row just added, still blank, which a save drops (VE-D33).
   */
  drawingPage = false;

  private buildPreviewState(): { draft: Record<string, any>; lang: string; translation: IContentTranslation | null } {
    const stored: any = untracked(() => this.draftContentStore.currentItem());
    const ownStored = stored && stored.id === this.contentId ? stored : null;
    const draft = {
      ...this.buildDraftFormValues(),
      id: this.contentId || '',
      createdAt: ownStored?.createdAt ?? null,
      // The date the page keeps when this is published.
      publishedOn: untracked(() => this.publishedCopy())?.['publishedOn'] ?? ownStored?.publishedOn ?? null,
    };
    let translation: IContentTranslation | null = null;
    const lang = this.isTranslating() ? this.activeLang() : '';
    if (lang) {
      const values = this.view.capture();
      translation = { lang, ...values, customFields: this.translatableCustomFields(values.customFields) } as IContentTranslation;
    }
    // Plain data only: dates as text, Firestore timestamps as their seconds.
    return JSON.parse(JSON.stringify({ draft, lang, translation }));
  }

  /**
   * The draft to the preview window and the Visual Editor's frame. The hold of a spot
   * being typed in keeps only the frame as it is: the window follows every keystroke.
   */
  private sendPreviewState(): void {
    if (!this.view?.ready()) return;
    const frame = this.previewHeld ? null : this.frameChannel;
    if (!this.previewChannel && !frame) return;
    const state = { kind: 'state' as const, ...this.previewState() };
    this.previewChannel?.post(state);
    frame?.post(state);
  }

  /** The frame asked for the draft (its first draw, a reload). */
  private sendFrameState(): void {
    if (!this.frameChannel || this.previewHeld || !this.view?.ready()) return;
    this.frameChannel.post({ kind: 'state', ...this.previewState() });
  }

  /** A message from the preview window: `hello` asks for the draft, `focus` for a field. */
  onPreviewMessage(message: PreviewMessage): void {
    if (message.kind === 'hello') this.sendPreviewState();
    else if (message.kind === 'focus') this.view.focusField(message.key, message.row);
  }

  /** A field took the cursor: the preview outlines where it is (VE-D8). '' is no field. */
  highlight(key: string): void {
    if (!this.previewChannel) return;
    if (key && key !== this.lastHighlighted) {
      this.lastHighlighted = key;
      this.previewChannel.post({ kind: 'highlight', key });
    }
  }

  /** The cursor left a field. */
  unhighlight(): void {
    this.lastHighlighted = '';
  }

  /** Whether the preview channel is open. */
  previewOpen(): boolean {
    return !!this.previewChannel;
  }

  /** The screen is going away: the preview keeps the last draft and says the editor closed (VE-D6). */
  close(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = null;
    if (this.previewTimer) clearTimeout(this.previewTimer);
    this.previewTimer = null;
    this.previewLeaving();
    this.previewChannel?.close();
    this.previewChannel = null;
    this.frameChannel?.close();
    this.frameChannel = null;
    if (typeof window !== 'undefined') window.removeEventListener('pagehide', this.previewLeaving);
    for (const stop of this.stopFollowing) stop();
    this.stopFollowing = [];
    this.followedPath = '';
    this.deployStatusSubscription?.unsubscribe();
    this.autoSaveSubscription?.unsubscribe();
  }

  ngOnDestroy(): void {
    this.close();
  }
}

/** No values in any language-varying field. */
export function emptyTranslatableValues(): TranslatableValues {
  return { title: '', content: '', summary: '', seoTitle: '', metaDescription: '', customFields: {} };
}

/** A required field with nothing in it. */
export function isEmptyFieldValue(value: unknown): boolean {
  return value === undefined || value === null || value === '' ||
    (Array.isArray(value) && value.length === 0);
}

/**
 * Whether an address is still the one made from a title (`guide`, or a
 * numbered `guide-2` when that was taken), so it may keep following the title.
 */
export function addressFromTitle(slug: string, title: string): boolean {
  const base = toUrlSlug(title || '');
  if (!slug || !base) return false;
  if (slug === base) return true;
  const rest = slug.startsWith(base + '-') ? slug.slice(base.length + 1) : '';
  return /^\d+$/.test(rest);
}

function escapeHtml(text: string): string {
  return (text || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
