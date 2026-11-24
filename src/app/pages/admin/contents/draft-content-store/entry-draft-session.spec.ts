import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { Subject, of, throwError } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastService } from '../../../../../shared/services/toast.service';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { PreviewChannel } from '../../../../core/preview/preview-channel';
import { LocalizationService } from '../../../../core/services/localization.service';
import { AuthState } from '../../../(auth)/auth.store';
import { CollectionRefSyncService } from '../content-store/collection-ref-sync.service';
import { ContentsService } from '../content-store/published-contents.service';
import { ContentTypeField } from '../content-types/content-types.model';
import { PublishQueueService } from '../publish-queue/publish-queue.service';
import { DraftContentsService } from './draft-contents.service';
import { DraftContentsStore } from './draft-contents.store';
import { EntryChangedError, EntryGoneError } from './entry-changed';
import { HeldError } from '../../../../core/editing/hold';
import { HoldService } from '../../../../core/editing/hold.service';
import {
  AUTO_SAVE_DELAY_MS, EntryDraftSession, EntryDraftView, TranslatableValues, addressFromTitle, emptyTranslatableValues,
} from './entry-draft-session';

/**
 * The session on its own (specs/visual-editing-spec.md, VE-D15), with a fake
 * screen: the rules the form editor and the edit-on-page screen share.
 */

/** A screen with no forms: its values in plain fields. */
class FakeView implements EntryDraftView {
  values: TranslatableValues = { ...emptyTranslatableValues(), title: '', content: '' };
  shared: Record<string, any> = { type: '', urlSlug: '', tags: [], coverImage: null };
  fieldList: ContentTypeField[] = [];
  filled: any[] = [];
  revealed: string[][] = [];
  created: string[] = [];
  focused: Array<[string, number | undefined]> = [];
  echoes = 0;

  ready() { return true; }
  formType() { return this.shared['type'] || ''; }
  fields() { return this.fieldList; }
  fieldLabel(field: ContentTypeField) { return field.label; }
  pageTitle() { return this.values.title; }
  address() { return this.shared['urlSlug'] || ''; }
  capture(): TranslatableValues { return { ...this.values, customFields: { ...this.values.customFields } }; }
  apply(values: TranslatableValues) { this.values = { ...values, customFields: { ...values.customFields } }; }
  prepareCustomFields(values: Record<string, any>) { return { ...values }; }
  sharedValues() { return { ...this.shared }; }
  fill(item: any) {
    this.filled.push(item);
    this.values = {
      title: item.title || '', content: item.content || '', summary: item.summary || '',
      seoTitle: item.seoTitle || '', metaDescription: item.metaDescription || '',
      customFields: { ...(item.customFields ?? {}) },
    };
    this.shared = { ...this.shared, type: item.type || '', urlSlug: item.urlSlug || '' };
  }
  expectEchoes() { this.echoes++; }
  revealMissing(missing: string[]) { this.revealed.push(missing); }
  entryCreated(id: string) { this.created.push(id); }
  focusField(key: string, row?: number) { this.focused.push([key, row]); }
  refresh() { /* nothing to draw */ }
}

describe('EntryDraftSession', () => {
  let session: EntryDraftSession;
  let view: FakeView;
  let store: any;
  let drafts: any;
  let localization: any;
  let toast: any;
  let dialog: any;
  let publishQueue: any;
  let contents: any;
  let holds: any;

  const flush = async () => { for (let i = 0; i < 6; i++) await new Promise((resolve) => setTimeout(resolve, 0)); };

  const ENGLISH = { code: 'en', label: 'English', nativeLabel: 'English' };
  const HINDI = { code: 'hi', label: 'Hindi', nativeLabel: 'Hindi' };

  beforeEach(() => {
    store = {
      currentItem: signal<any>({}),
      getByCustomField: vi.fn(),
      createDraft: vi.fn().mockReturnValue(of('new-id')),
      newDraftId: vi.fn().mockReturnValue('pre-id'),
      adoptCreated: vi.fn((item: any) => store.currentItem.set(item)),
      saveDraft: vi.fn().mockReturnValue(of(undefined)),
      refreshCurrentItem: vi.fn((id: string, saved: any) => {
        const current = store.currentItem();
        if (current?.id === id) store.currentItem.set({ ...current, ...saved });
      }),
      isSlugTaken: vi.fn().mockResolvedValue(false),
      publishedSlug: vi.fn().mockResolvedValue(''),
      updateNextContentReferences: vi.fn().mockResolvedValue(undefined),
      updatePreviousContentReferences: vi.fn().mockResolvedValue(undefined),
      applyBacklinks: vi.fn().mockResolvedValue({ changed: [], failed: [] }),
    };
    drafts = {
      getTranslation: vi.fn().mockResolvedValue(null),
      getTranslatedLanguages: vi.fn().mockResolvedValue([]),
      saveTranslation: vi.fn().mockResolvedValue(undefined),
      deleteTranslation: vi.fn().mockResolvedValue(undefined),
    };
    localization = {
      load: vi.fn().mockResolvedValue(undefined),
      defaultLanguage: signal('en'),
      enabledLanguages: signal([ENGLISH]),
      isMultilingual: signal(false),
      find: vi.fn((code: string) => [ENGLISH, HINDI].find((l) => l.code === code)),
    };
    toast = { openCustomSnackbar: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn() };
    dialog = { open: vi.fn().mockReturnValue({ afterClosed: () => of(true) }) };
    publishQueue = { enqueue: vi.fn().mockResolvedValue(undefined) };
    contents = { pollDeployStatus: vi.fn().mockReturnValue(of({})) };

    holds = {
      listeners: {} as Record<string, (data: any, pending: boolean) => void>,
      follow: vi.fn((path: string, next: any) => { holds.listeners[path] = next; return () => delete holds.listeners[path]; }),
      me: vi.fn(() => ({ uid: 'me', name: 'Me' })),
      entryChanges: vi.fn().mockResolvedValue([]),
      takeOver: vi.fn().mockResolvedValue(true), keep: vi.fn().mockResolvedValue(undefined),
      restorePublished: vi.fn().mockResolvedValue(undefined), markPublished: vi.fn().mockResolvedValue(undefined),
      restoreKept: vi.fn().mockResolvedValue({ addressTaken: false }), read: vi.fn().mockResolvedValue(null), letGo: vi.fn().mockResolvedValue(null),
    };
    TestBed.configureTestingModule({
      providers: [
        { provide: HoldService, useFactory: () => holds },
        EntryDraftSession,
        { provide: DraftContentsStore, useValue: store },
        { provide: DraftContentsService, useValue: drafts },
        { provide: CollectionRefSyncService, useValue: { syncReferencedData: vi.fn().mockResolvedValue(undefined) } },
        { provide: PublishQueueService, useValue: publishQueue },
        { provide: ContentsService, useValue: contents },
        { provide: LocalizationService, useValue: localization },
        { provide: AuthState, useValue: { currentUser: signal({ id: 'admin-1' }) } },
        { provide: MatDialog, useValue: dialog },
        { provide: ToastService, useValue: toast },
      ],
    });
    session = TestBed.inject(EntryDraftSession);
    view = new FakeView();
    session.attach(view);
    session.typeSlug.set('article');
  });

  afterEach(() => {
    session.close();
    vi.useRealTimers();
  });

  /** A stored entry, loaded as the screen's watch on the store would. */
  function loadStored(extra: Record<string, any> = {}): any {
    const item = {
      id: 'doc-1', title: 'Guide', content: '<p>Body</p>', urlSlug: 'guide', type: 'article',
      modifiedAt: 'stamp-1', ...extra,
    };
    session.contentId = 'doc-1';
    store.currentItem.set(item);
    session.load(item);
    return item;
  }

  describe('loading', () => {
    it('shows the entry and takes it as the clean state', () => {
      loadStored();
      expect(view.filled).toHaveLength(1);
      expect(view.echoes).toBe(1);
      expect(session.hasUnsavedChanges()).toBe(false);

      view.values.title = 'Guide, edited';
      expect(session.hasUnsavedChanges()).toBe(true);
    });

    it('asks the store for the entry by id and type', () => {
      session.loadById('doc-9');
      expect(store.getByCustomField).toHaveBeenCalledWith('id', '==', 'doc-9', 'article');
    });

    it('a stored item its own save left is not loaded again', async () => {
      const item = loadStored();
      expect(session.isNewStoredItem(item)).toBe(true);
      expect(session.isNewStoredItem({})).toBe(false);

      view.values.title = 'Changed';
      await session.saveAsDraft();
      expect(session.isNewStoredItem(store.currentItem())).toBe(false);
    });

    it('the entry opened before, still in the store, is never taken for this one', () => {
      const item = loadStored();
      session.contentId = 'doc-2';
      expect(session.isNewStoredItem(item)).toBe(false);
      expect(session.isNewStoredItem({ ...item, id: 'doc-2' })).toBe(true);
    });

    it('the body editor giving back its value settles the baseline, once', () => {
      loadStored();
      // The editor reserializes the body on its way back.
      view.values.content = '<p>Body</p>\n';
      session.settleLoad();
      expect(session.hasUnsavedChanges()).toBe(false);
      view.values.content = '<p>Typed</p>';
      session.settleLoad();
      expect(session.hasUnsavedChanges()).toBe(true);
    });

    it('a published entry links to its live version and reads its live address', async () => {
      store.publishedSlug.mockResolvedValue('guide-old');
      loadStored({ publishedStatus: true, publishedOn: { seconds: 1_700_000_000 } });
      await flush();
      expect(session.publishedId).toBe('doc-1');
      expect(session.lastPublishedDate?.getTime()).toBe(1_700_000_000_000);
      expect(session.publishedSlug()).toBe('guide-old');
      expect(session.slugFollowsTitle).toBe(false);
    });

    it('an unpublished entry whose address came from its title keeps following it', () => {
      loadStored({ title: 'Guide', urlSlug: 'guide-2' });
      expect(session.slugFollowsTitle).toBe(true);
      expect(addressFromTitle('guide-2', 'Guide')).toBe(true);
      expect(addressFromTitle('my-guide', 'Guide')).toBe(false);
    });
  });

  describe('the checks', () => {
    it('Save needs a title, says so and points at it; nothing is written', async () => {
      loadStored({ title: '' });
      await session.saveAsDraft();
      expect(toast.openCustomSnackbar).toHaveBeenCalledWith(expect.stringContaining('Title'), 'error', 'error');
      expect(view.revealed).toEqual([['title']]);
      expect(store.saveDraft).not.toHaveBeenCalled();
    });

    it('Publish needs every required field, named with the label on screen, in screen order', async () => {
      view.fieldList = [
        { key: 'price', label: 'Price', type: 'text', required: true, order: 0 } as ContentTypeField,
        { key: 'venue', label: 'Venue', type: 'text', required: true, order: 1 } as ContentTypeField,
      ];
      loadStored({ customFields: { venue: 'Hall' } });
      const result = session.validateForPublish();
      expect(result.valid).toBe(false);
      expect(result.missing).toEqual(['price']);
      expect(result.errors[0]).toContain('Price');

      await session.directPublishContent();
      expect(view.revealed).toEqual([['price']]);
      expect(publishQueue.enqueue).not.toHaveBeenCalled();
    });

    it('Publish asks before outline text still to replace goes live, and Cancel publishes nothing', async () => {
      dialog.open.mockReturnValue({ afterClosed: () => of(false) });
      loadStored({ content: '<p>[Replace: your opening line]</p>' });
      await session.directPublishContent();
      expect(dialog.open).toHaveBeenCalled();
      expect(store.saveDraft).not.toHaveBeenCalled();
    });
  });

  describe('a new entry', () => {
    it('is written on its first title, with an id chosen first, and the screen is told', async () => {
      view.values.title = 'Hello';
      session.triggerAutoSave();
      await flush();
      expect(store.newDraftId).toHaveBeenCalledWith('article');
      expect(store.createDraft).toHaveBeenCalledWith(expect.objectContaining({ title: 'Hello', publishedStatus: false }), 'article', 'pre-id');
      expect(session.contentId).toBe('new-id');
      expect(view.created).toEqual(['new-id']);
      expect(session.hasUnsavedChanges()).toBe(false);
    });

    it('a failed first write shows Not saved, and Retry uses the same id', async () => {
      store.createDraft.mockReturnValueOnce(throwError(() => new Error('offline')));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      view.values.title = 'Hello';
      await session.saveAsDraft();
      expect(session.saveFailed()).toBe(true);
      expect(session.hasUnsavedChanges()).toBe(true);

      session.retrySave();
      await flush();
      expect(store.createDraft).toHaveBeenLastCalledWith(expect.anything(), 'article', 'pre-id');
      expect(session.saveFailed()).toBe(false);
    });
  });

  describe('saving a stored entry', () => {
    it('saves against the modifiedAt it opened, then against its own', async () => {
      loadStored();
      view.values.title = 'One';
      await session.saveAsDraft();
      expect(store.saveDraft.mock.calls[0][3]).toBe('stamp-1');
      const ownStamp = store.saveDraft.mock.calls[0][1].modifiedAt;

      view.values.title = 'Two';
      await session.saveAsDraft();
      expect(store.saveDraft.mock.calls[1][3]).toBe(ownStamp);
    });

    it('stops when someone else saved, and Keep mine writes over theirs', async () => {
      loadStored();
      store.saveDraft.mockReturnValueOnce(throwError(() => new EntryChangedError()));
      view.values.title = 'Mine';
      await session.saveAsDraft();
      expect(session.entryChanged()).toBe(true);

      session.keepMine();
      await flush();
      expect(session.entryChanged()).toBe(false);
      expect(store.saveDraft).toHaveBeenLastCalledWith('doc-1', expect.objectContaining({ title: 'Mine' }), 'article', null);
    });

    it('Reload theirs reads the entry again', async () => {
      loadStored();
      store.saveDraft.mockReturnValueOnce(throwError(() => new EntryChangedError()));
      view.values.title = 'Mine';
      await session.saveAsDraft();
      await session.reloadTheirs();
      expect(session.entryChanged()).toBe(false);
      expect(store.getByCustomField).toHaveBeenCalledWith('id', '==', 'doc-1', 'article');
    });

    it('an entry deleted by someone else says so, with no Retry', async () => {
      loadStored();
      store.saveDraft.mockReturnValueOnce(throwError(() => new EntryGoneError()));
      view.values.title = 'Mine';
      await session.saveAsDraft();
      expect(session.entryGone()).toBe(true);
      expect(session.saveFailed()).toBe(false);
      await session.saveAsDraft();
      expect(store.saveDraft).toHaveBeenCalledTimes(1);
    });

    it('a taken address stops the save and is not written', async () => {
      loadStored();
      store.isSlugTaken.mockResolvedValue(true);
      view.shared['urlSlug'] = 'taken';
      await session.saveAsDraft();
      expect(session.errorSlug).toBe(true);
      expect(store.saveDraft).not.toHaveBeenCalled();
    });
  });

  describe('a load no editor echoes', () => {
    it('settles by itself, so the first edit after it is saved, not taken for the echo', async () => {
      vi.useFakeTimers();
      loadStored();
      await vi.advanceTimersByTimeAsync(0);
      // The body changes: the form editor's body handler settles loading, then saves.
      view.values.content = '<p>Pasted</p>';
      session.settleLoad();
      session.triggerAutoSave();
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
      expect(store.saveDraft).toHaveBeenCalledWith('doc-1', expect.objectContaining({ content: '<p>Pasted</p>' }), 'article', 'stamp-1');
    });
  });

  describe('auto-save', () => {
    it('saves a few seconds after the last change, and not when nothing changed', async () => {
      vi.useFakeTimers();
      loadStored();
      session.triggerAutoSave();
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS + 10);
      expect(store.saveDraft).not.toHaveBeenCalled();

      view.values.title = 'Edited';
      session.triggerAutoSave();
      await vi.advanceTimersByTimeAsync(AUTO_SAVE_DELAY_MS - 100);
      expect(store.saveDraft).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(200);
      expect(store.saveDraft).toHaveBeenCalledWith('doc-1', expect.objectContaining({ title: 'Edited' }), 'article', 'stamp-1');
      expect(session.justAutoSaved()).toBe(true);
    });
  });

  describe('translations', () => {
    beforeEach(() => {
      localization.enabledLanguages.set([ENGLISH, HINDI]);
      localization.isMultilingual.set(true);
    });

    it('a switch keeps the default language as the base document and saves the translation beside it', async () => {
      await session.initLanguages();
      loadStored();
      await session.switchLanguage('hi');
      expect(session.isTranslating()).toBe(true);
      expect(view.values.title).toBe('');
      expect(session.baseValues().title).toBe('Guide');

      view.values.title = 'Hindi title';
      session.triggerAutoSave();
      expect(session.translationDirty()).toBe(true);
      await session.saveAsDraft();
      await flush();

      expect(store.saveDraft).toHaveBeenCalledWith('doc-1', expect.objectContaining({ title: 'Guide' }), 'article', 'stamp-1');
      expect(drafts.saveTranslation).toHaveBeenCalledWith('article', 'doc-1', expect.objectContaining({ lang: 'hi', title: 'Hindi title' }));
      expect(session.hasTranslation('hi')).toBe(true);

      await session.switchLanguage('en');
      expect(view.values.title).toBe('Guide');
    });

    it('the stored entry, or words typed, that arrive while the translation loads stay the default language\'s', async () => {
      await session.initLanguages();
      loadStored();
      let land!: (value: unknown) => void;
      drafts.getTranslation.mockImplementation(() => new Promise((resolve) => { land = resolve; }));
      const toHindi = session.switchLanguage('hi');
      view.values.title = 'Guide, read again';
      land(null);
      await toHindi;
      expect(session.isTranslating()).toBe(true);
      expect(session.baseValues().title).toBe('Guide, read again');
      await session.switchLanguage('en');
      expect(view.values.title).toBe('Guide, read again');
    });

    it('the last of two quick switches wins: a translation still loading is not put on screen (VE3.11)', async () => {
      await session.initLanguages();
      loadStored();
      let landHindi!: (value: unknown) => void;
      drafts.getTranslation.mockImplementation((_type: string, _id: string, code: string) =>
        code === 'hi' ? new Promise((resolve) => { landHindi = resolve; }) : Promise.resolve(null));

      // Hindi, then back to English before it loaded: English stays.
      const toHindi = session.switchLanguage('hi');
      await session.switchLanguage('en');
      landHindi({ lang: 'hi', title: 'Hindi title' });
      await toHindi;
      expect(session.activeLang()).toBe('en');
      expect(view.values.title).toBe('Guide');
      // Hindi, loaded meanwhile, shows at once when asked for again.
      await session.switchLanguage('hi');
      expect(view.values.title).toBe('Hindi title');
    });

    it('a switch to a language still loading, then another still loading: the last one shows (VE3.11)', async () => {
      const TAMIL = { code: 'ta', label: 'Tamil', nativeLabel: 'Tamil' };
      localization.enabledLanguages.set([ENGLISH, HINDI, TAMIL]);
      await session.initLanguages();
      loadStored();
      const landing: Record<string, (value: unknown) => void> = {};
      drafts.getTranslation.mockImplementation((_type: string, _id: string, code: string) =>
        new Promise((resolve) => { landing[code] = resolve; }));
      const toHindi = session.switchLanguage('hi');
      const toTamil = session.switchLanguage('ta');
      // Tamil lands first, Hindi after it: Tamil, the last asked for, stays.
      landing['ta']({ lang: 'ta', title: 'Tamil title' });
      await toTamil;
      landing['hi']({ lang: 'hi', title: 'Hindi title' });
      await toHindi;
      expect(session.activeLang()).toBe('ta');
      expect(view.values.title).toBe('Tamil title');
      // Hindi's copy was kept for when it is asked for.
      await session.switchLanguage('hi');
      expect(view.values.title).toBe('Hindi title');
    });

    it('a publish whose translation did not save does not go live, and Retry publishes', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      contents.pollDeployStatus.mockReturnValue(of({}));
      await session.initLanguages();
      loadStored();
      await session.switchLanguage('hi');
      view.values.title = 'Hindi title';
      session.triggerAutoSave();
      drafts.saveTranslation.mockRejectedValueOnce(new Error('offline'));
      await session.directPublishContent();
      await flush();
      expect(publishQueue.enqueue).not.toHaveBeenCalled();
      expect(session.saveFailed()).toBe(true);

      session.retrySave();
      await flush();
      await vi.waitFor(() => expect(publishQueue.enqueue).toHaveBeenCalledWith('publish', 'article', 'doc-1'));
    });

    it('only translatable custom fields go into a translation', () => {
      view.fieldList = [
        { key: 'blurb', label: 'Blurb', type: 'text', order: 0 } as ContentTypeField,
        { key: 'price', label: 'Price', type: 'number', order: 1 } as ContentTypeField,
      ];
      expect(session.translatableCustomFields({ blurb: 'Hi', price: 5 })).toEqual({ blurb: 'Hi' });
    });
  });

  describe('publishing', () => {
    it('writes the draft as published, hands it to the publish function and shows Publishing', async () => {
      contents.pollDeployStatus.mockReturnValue(of({}));
      loadStored();
      await session.directPublishContent();
      expect(store.saveDraft).toHaveBeenCalledWith('doc-1', expect.objectContaining({ status: 'publish', publishedStatus: true }), 'article', 'stamp-1');
      expect(publishQueue.enqueue).toHaveBeenCalledWith('publish', 'article', 'doc-1');
      expect(session.deployStatus()).toBe('pending');
      expect(session.publishedSlug()).toBe('guide');
      expect(session.slugFollowsTitle).toBe(false);
    });

    it('a publish that cannot start says so, and the line stays', async () => {
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      publishQueue.enqueue.mockRejectedValue(new Error('denied'));
      loadStored();
      await session.directPublishContent();
      expect(session.deployStatus()).toBe('failed');
      expect(session.publishProblem()).toBe('start');
    });

    it('says when the page is live', async () => {
      const notify = TestBed.inject(NotifyService);
      const success = vi.spyOn(notify, 'success').mockImplementation(() => undefined as any);
      contents.pollDeployStatus.mockReturnValue(of({ deployStatus: 'deployed' }));
      loadStored();
      await session.directPublishContent();
      expect(session.deployStatus()).toBe('deployed');
      expect(success).toHaveBeenCalledWith('admin.contents.editor.deployed_success');
    });
  });

  describe('the preview channel', () => {
    let post: ReturnType<typeof vi.spyOn>;
    beforeEach(() => { post = vi.spyOn(PreviewChannel.prototype, 'post'); });
    afterEach(() => post.mockRestore());

    it('a saved entry opens its channel and sends the unsaved draft shortly after a change', async () => {
      loadStored();
      session.connectPreview();
      expect(session.previewKey).toBe('article.doc-1');
      view.values.title = 'Typed, not saved';
      session.triggerAutoSave();
      await new Promise((resolve) => setTimeout(resolve, EntryDraftSession.PREVIEW_DELAY_MS + 30));
      const state = post.mock.calls.map((call: any[]) => call[0]).filter((m: any) => m.kind === 'state').at(-1);
      expect(state.draft.title).toBe('Typed, not saved');
      expect(store.saveDraft).not.toHaveBeenCalled();
    });

    it('holds the page while a spot on it is typed in, and sends the draft when it is left (VE-D16)', async () => {
      loadStored();
      session.connectPreview();
      session.connectFrame('article.doc-1.edit.abc');
      await new Promise((resolve) => setTimeout(resolve, EntryDraftSession.PREVIEW_DELAY_MS + 30));
      post.mockClear();
      // Which channel each state went on: the entry's (the preview window) or the screen's frame.
      const states = (name: string) => post.mock.calls
        .map((call: any[], i: number) => ({ message: call[0], channel: (post.mock.contexts[i] as any)?.channel?.name }))
        .filter((c: any) => c.message.kind === 'state' && c.channel === `arc-preview:${name}`)
        .map((c: any) => c.message);
      session.holdPreview(true);
      view.values.title = 'Typed on the page';
      session.triggerAutoSave();
      session.onPreviewMessage({ kind: 'hello' });
      await new Promise((resolve) => setTimeout(resolve, EntryDraftSession.PREVIEW_DELAY_MS + 30));
      expect(states('article.doc-1.edit.abc')).toHaveLength(0);
      // The preview window follows every keystroke (review L2).
      expect(states('article.doc-1').at(-1)?.draft.title).toBe('Typed on the page');
      session.holdPreview(false);
      await new Promise((resolve) => setTimeout(resolve, EntryDraftSession.PREVIEW_DELAY_MS + 30));
      expect(states('article.doc-1.edit.abc')).toHaveLength(1);
      expect(states('article.doc-1.edit.abc')[0].draft.title).toBe('Typed on the page');
    });

    it('draws the Visual Editor\'s frame on a channel of its own, a new entry too (review H2, H3)', async () => {
      session.connectFrame('article.new.x.edit.abc');
      expect(session.previewOpen()).toBe(false);
      await new Promise((resolve) => setTimeout(resolve, EntryDraftSession.PREVIEW_DELAY_MS + 30));
      const names = post.mock.calls.map((call: any[], i: number) => [call[0].kind, (post.mock.contexts[i] as any)?.channel?.name]);
      expect(names).toContainEqual(['state', 'arc-preview:article.new.x.edit.abc']);
      expect(names.some(([, name]: string[]) => name === 'arc-preview:article.new')).toBe(false);
      session.close();
    });

    it('redraws the page with an entry loaded again, such as the other admin\'s after Reload theirs', async () => {
      loadStored();
      session.connectPreview();
      await new Promise((resolve) => setTimeout(resolve, EntryDraftSession.PREVIEW_DELAY_MS + 30));
      post.mockClear();
      session.load({ id: 'doc-1', title: 'Their title', modifiedAt: 2 });
      view.values.title = 'Their title';
      await new Promise((resolve) => setTimeout(resolve, EntryDraftSession.PREVIEW_DELAY_MS + 30));
      const states = post.mock.calls.map((call: any[]) => call[0]).filter((m: any) => m.kind === 'state');
      expect(states).toHaveLength(1);
      expect(states[0].draft.title).toBe('Their title');
    });

    it('a click on the preview asks the screen for the field', () => {
      session.onPreviewMessage({ kind: 'focus', key: 'price', row: 2 });
      expect(view.focused).toEqual([['price', 2]]);
    });

    it('outlines a field once per focus, and says goodbye on close', () => {
      loadStored();
      session.connectPreview();
      session.highlight('title');
      session.highlight('title');
      session.unhighlight();
      session.highlight('title');
      const kinds = () => post.mock.calls.map((call: any[]) => call[0].kind);
      expect(kinds().filter((k: string) => k === 'highlight')).toHaveLength(2);
      session.close();
      expect(kinds()).toContain('bye');
    });
  });

  describe('where the entry stands (VE-D70, VE-D71, VE-D73)', () => {
    const day = (n: number) => ({ seconds: Date.UTC(2026, 9, n) / 1000 });

    it('opens as published, changed or never published, as the entries list says', () => {
      expect(session.entryRead()).toBe(false);
      loadStored({ publishedStatus: false });
      expect(session.entryRead()).toBe(true);
      expect(session.editState()).toBe('never');
      loadStored({ publishedStatus: true, modifiedAt: day(2), lastPublishedAt: day(3) });
      expect(session.editState()).toBe('published');
      expect(session.nothingToPublish()).toBe(true);
      loadStored({ publishedStatus: true, modifiedAt: day(5), lastPublishedAt: day(3) });
      expect(session.editState()).toBe('changes');
      expect(session.nothingToPublish()).toBe(false);
    });

    it('shows the last publish, not the first one the draft keeps', () => {
      loadStored({ publishedStatus: true, publishedOn: day(1), lastPublishedAt: day(9), modifiedAt: day(8) });
      expect(session.lastPublishedDate).toEqual(new Date(day(9).seconds * 1000));
      // Published before `lastPublishedAt` was kept: the only date there is, and changes cannot be told.
      loadStored({ publishedStatus: true, publishedOn: day(1), modifiedAt: day(8) });
      expect(session.lastPublishedDate).toEqual(new Date(day(1).seconds * 1000));
      expect(session.nothingToPublish()).toBe(false);
    });

    it('someone else\'s publish moves Last published by its own time: the entry\'s date stays', () => {
      let published: (data: Record<string, any> | null) => void = () => undefined;
      vi.spyOn((session as any).holds, 'follow').mockImplementation(((path: string, next: typeof published) => {
        if (!path.includes('_drafts/')) published = next;
        return () => undefined;
      }) as never);
      loadStored({ publishedStatus: true, publishedOn: day(1), lastPublishedAt: day(3), modifiedAt: day(2) });
      (session as any).followedPath = '';
      (session as any).follow(session.contentId);
      published({ publishedOn: day(1), lastPublishedAt: day(3) });
      expect(session.publishesLanded()).toBe(0);
      published({ publishedOn: day(1), lastPublishedAt: day(9) });
      expect(session.publishesLanded()).toBe(1);
      expect(session.lastPublishedDate).toEqual(new Date(day(9).seconds * 1000));
      // What the page shows, and what the checks and previews use, is the first publish.
      expect(session.publishDate()).toEqual(new Date(day(1).seconds * 1000));
      published({ publishedOn: day(4), lastPublishedAt: day(9) });
      expect((session as any).buildPreviewState().draft.publishedOn).toEqual(day(4));
    });

    it('a saved change is waiting, and a landed publish is what visitors see', async () => {
      const deploy$ = new Subject<any>();
      contents.pollDeployStatus.mockReturnValue(deploy$);
      loadStored({ publishedStatus: true, publishedOn: day(1), modifiedAt: day(2), lastPublishedAt: day(3) });
      view.values.title = 'Guide 2';
      await session.directPublishContent();
      expect(session.editState()).toBe('publishing');
      expect(session.lastPublishedDate).toEqual(new Date(day(3).seconds * 1000));
      expect(session.publishesLanded()).toBe(0);
      deploy$.next({ deployStatus: 'deployed' });
      expect(session.editState()).toBe('published');
      expect(session.publishesLanded()).toBe(1);
      expect(session.lastPublishedDate!.getTime()).toBeGreaterThan(day(3).seconds * 1000);
    });

    it('a failed publish leaves the date alone, and the changes waiting', async () => {
      const deploy$ = new Subject<any>();
      contents.pollDeployStatus.mockReturnValue(deploy$);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      loadStored({ publishedStatus: true, modifiedAt: day(2), lastPublishedAt: day(3) });
      view.values.title = 'Guide 2';
      await session.directPublishContent();
      deploy$.next({ deployStatus: 'failed', deployErrorCode: 'X' });
      expect(session.editState()).toBe('changes');
      expect(session.nothingToPublish()).toBe(false);
      expect(session.lastPublishedDate).toEqual(new Date(day(3).seconds * 1000));
      expect(session.publishesLanded()).toBe(0);
    });

    it('a save while the publish runs still waits once it has landed', async () => {
      const deploy$ = new Subject<any>();
      contents.pollDeployStatus.mockReturnValue(deploy$);
      loadStored({ publishedStatus: true, modifiedAt: day(2), lastPublishedAt: day(3) });
      view.values.title = 'Guide 2';
      await session.directPublishContent();
      view.values.title = 'Guide 3';
      await session.performAutoSave();
      deploy$.next({ deployStatus: 'deployed' });
      expect(session.editState()).toBe('changes');
    });
  });

  describe('one person holds the entry (VE-D76 to VE-D84)', () => {
    const DRAFT = 'arc_article_drafts/doc-1';
    const PRIYA = { by: 'priya', name: 'Priya' };
    const arrives = (data: Record<string, any>) => holds.listeners[DRAFT]({ modifiedAt: 'stamp-1', title: 'Guide', ...data }, false);

    it('follows the draft once, and is view only while someone else holds it', async () => {
      const stored = loadStored();
      session.load(stored);
      expect(holds.follow).toHaveBeenCalledTimes(1);
      arrives({ editing: PRIYA });
      expect(session.heldBy()?.name).toBe('Priya');
      view.values.title = 'Mine';
      await session.performAutoSave();
      await session.saveAsDraft();
      await session.directPublishContent();
      expect(store.saveDraft).not.toHaveBeenCalled();
      expect(publishQueue.enqueue).not.toHaveBeenCalled();
    });

    it('follows their work while looking, and shows it once they let go', async () => {
      loadStored();
      arrives({ editing: PRIYA });
      arrives({ editing: PRIYA, modifiedAt: 'stamp-2', title: 'Guide 2' });
      await flush();
      expect(view.values.title).toBe('Guide 2');
      arrives({ modifiedAt: 'stamp-3', title: 'Guide 3' });
      await flush();
      expect(session.heldBy()).toBeNull();
      expect(view.values.title).toBe('Guide 3');
      // And what is now on screen is the clean state: the next save compares with it.
      expect(session.hasUnsavedChanges()).toBe(false);
    });

    it('shown again in a translation, the default language\'s older words are never written back', async () => {
      localization.enabledLanguages.set([ENGLISH, HINDI]);
      localization.isMultilingual.set(true);
      drafts.getTranslation.mockResolvedValue({ lang: 'hi', title: 'हिन्दी' });
      await session.initLanguages();
      loadStored();
      await session.switchLanguage('hi');
      arrives({ editing: PRIYA });
      arrives({ editing: PRIYA, modifiedAt: 'stamp-2', title: 'New English', content: '<p>New</p>' });
      await flush();
      expect(session.activeLang()).toBe('hi');
      expect(view.values.title).toBe('हिन्दी');
      arrives({ modifiedAt: 'stamp-2', title: 'New English', content: '<p>New</p>' });
      view.values.title = 'हिन्दी 2';
      session.triggerAutoSave();
      await session.performAutoSave();
      await flush();
      expect(store.saveDraft).toHaveBeenCalled();
      expect(store.saveDraft.mock.calls[0][1].title).toBe('New English');
      expect(store.saveDraft.mock.calls[0][1].content).toBe('<p>New</p>');
    });

    it('words typed and not saved when it is taken over stay, and nothing replaces them (VE-D82)', () => {
      loadStored();
      view.values.title = 'Typing this';
      store.getByCustomField.mockClear();
      arrives({ editing: PRIYA, modifiedAt: 'stamp-2' });
      expect(session.lostWords()).toBe(true);
      arrives({ editing: PRIYA, modifiedAt: 'stamp-3' });
      expect(store.getByCustomField).not.toHaveBeenCalled();
      expect(view.values.title).toBe('Typing this');
    });

    it('a save refused because someone made the first change goes view only, with no Retry', async () => {
      loadStored();
      view.values.title = 'Second';
      store.saveDraft.mockReturnValue(throwError(() => new HeldError({ by: 'priya', name: 'Priya' })));
      await session.performAutoSave();
      expect(session.heldBy()?.name).toBe('Priya');
      expect(session.lostWords()).toBe(true);
      expect(session.saveFailed()).toBe(false);
    });

    it('our own save does not read as someone else\'s', () => {
      loadStored();
      holds.listeners[DRAFT]({ modifiedAt: 'stamp-9', editing: { by: 'me', name: 'Me' } }, true);
      arrives({ editing: { by: 'me', name: 'Me' } });
      expect(session.heldBy()).toBeNull();
    });

    it('takes over from the person shown, and is then free to edit', async () => {
      loadStored();
      arrives({ editing: PRIYA });
      holds.read.mockResolvedValue({ title: 'Guide', modifiedAt: 'stamp-1' });
      expect(await session.takeOver()).toBe(true);
      expect(holds.takeOver).toHaveBeenCalledWith(DRAFT, 'priya');
      expect(session.heldBy()).toBeNull();
    });

    it('takes over nothing when someone else holds it by then', async () => {
      loadStored();
      arrives({ editing: PRIYA });
      holds.takeOver.mockResolvedValue(false);
      expect(await session.takeOver()).toBe(false);
      expect(session.heldBy()?.name).toBe('Priya');
    });

    it('words typed and not saved are asked about, or saved, once the entry is let go', async () => {
      loadStored();
      view.values.title = 'Typing this';
      arrives({ editing: PRIYA, modifiedAt: 'stamp-2' });
      expect(session.editState()).toBe('not_saved');
      arrives({ modifiedAt: 'stamp-3', title: 'Theirs' });
      expect(session.lostWords()).toBe(false);
      expect(session.entryChanged()).toBe(true);
      session.keepMine();
      await flush();
      expect(store.saveDraft.mock.calls[0][1].title).toBe('Typing this');
    });

    it('a new entry is followed and its state known from its first write', async () => {
      view.values.title = 'New one';
      await session.saveAsDraft();
      await flush();
      expect(session.entryRead()).toBe(true);
      expect(Object.keys(holds.listeners)).toContain('arc_article_drafts/new-id');
      expect(session.editState()).toBe('never');
    });

    it('a mark the publish function moved, with no words changed, is not someone else\'s save', async () => {
      loadStored();
      arrives({ editing: { by: 'me', name: 'Me' } });
      arrives({ editing: { by: 'me', name: 'Me' }, modifiedAt: 'stamp-server' });
      view.values.title = 'Next';
      await session.performAutoSave();
      expect(store.saveDraft.mock.calls[0][3]).toBe('stamp-server');
    });

    it('publishes theirs as it is, through the same checks', async () => {
      contents.pollDeployStatus.mockReturnValue(of({}));
      loadStored();
      arrives({ editing: PRIYA });
      view.values.title = '';
      await session.publishTheirs();
      expect(holds.markPublished).not.toHaveBeenCalled();
      view.values.title = 'Guide';
      await session.publishTheirs();
      expect(holds.markPublished).toHaveBeenCalledWith(DRAFT);
      expect(store.saveDraft).not.toHaveBeenCalled();
      expect(publishQueue.enqueue).toHaveBeenCalledWith('publish', 'article', 'doc-1');
    });

    describe('lets go once what is stored is what is live (VE-D76)', () => {
      const LIVE = { title: 'Guide', content: '<p>Body</p>', urlSlug: 'guide', modifiedAt: new Date(5) };
      const mine = { editing: { by: 'me', name: 'Me' }, content: '<p>Body</p>', urlSlug: 'guide' };
      beforeEach(() => {
        loadStored({ publishedStatus: true, modifiedAt: { seconds: 9 }, lastPublishedAt: { seconds: 5 } });
        holds.listeners['arc_article/doc-1'](LIVE, false);
        holds.letGo.mockResolvedValue('stamp-live');
      });

      it('after any save, and the next save compares with the mark it leaves', async () => {
        holds.listeners[DRAFT]({ ...mine, title: 'Guide', modifiedAt: { seconds: 9 } }, false);
        await flush();
        expect(holds.letGo).toHaveBeenCalledWith('article', 'doc-1', []);
        expect(session.editState()).toBe('published');
        view.values.title = 'Again';
        await session.performAutoSave();
        expect(store.saveDraft.mock.calls[0][3]).toBe('stamp-live');
      });

      it('not while a language still differs, while something is unsaved, or while a publish runs', async () => {
        holds.entryChanges.mockResolvedValue([{ id: 'hi|title', field: 'title', lang: 'hi', kind: 'text', before: '', after: 'x' }]);
        holds.listeners[DRAFT]({ ...mine, title: 'Guide', modifiedAt: { seconds: 9 } }, false);
        await flush();
        expect(session.editState()).toBe('changes');
        holds.entryChanges.mockResolvedValue([]);
        view.values.title = 'Typing';
        holds.listeners[DRAFT]({ ...mine, title: 'Guide', modifiedAt: { seconds: 9 } }, false);
        await flush();
        view.values.title = 'Guide';
        session.deployStatus.set('pending');
        holds.listeners[DRAFT]({ ...mine, title: 'Guide', modifiedAt: { seconds: 9 } }, false);
        await flush();
        expect(holds.letGo).not.toHaveBeenCalled();
      });

      it('never with a link, a word or a picture that differs', async () => {
        holds.listeners[DRAFT]({ ...mine, title: 'Guide', nextContent: { id: 'x', title: 'X' }, modifiedAt: { seconds: 9 } }, false);
        await flush();
        expect(session.editState()).toBe('changes');
        expect(holds.letGo).not.toHaveBeenCalled();
      });

      it('a read that fails leaves saving as it was', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        holds.entryChanges.mockRejectedValue(new Error('offline'));
        holds.listeners[DRAFT]({ ...mine, title: 'Guide', modifiedAt: { seconds: 9 } }, false);
        await flush();
        view.values.title = 'Still saves';
        await session.performAutoSave();
        expect(store.saveDraft).toHaveBeenCalled();
      });
    });

    it('is Published when only the dates differ (VE6.B1)', async () => {
      const live = { title: 'Guide', content: '<p>Body</p>', urlSlug: 'guide' };
      loadStored({ publishedStatus: true, modifiedAt: { seconds: 9 }, lastPublishedAt: { seconds: 5 } });
      expect(session.editState()).toBe('changes');
      holds.listeners[DRAFT]({ ...live, modifiedAt: { seconds: 9 } }, false);
      holds.listeners['arc_article/doc-1'](live, false);
      await flush();
      expect(session.editState()).toBe('published');
    });

    it('Discard keeps the draft first; nothing is put back over unsaved words that could not be saved', async () => {
      loadStored({ publishedStatus: true });
      await session.putBack();
      expect(session.keptChanged()).toBe(1);
      expect(holds.keep).toHaveBeenCalledWith(DRAFT, 'discard');
      expect(holds.restorePublished).toHaveBeenCalledTimes(1);
      view.values.title = 'Unsaved';
      store.saveDraft.mockReturnValue(throwError(() => new Error('offline')));
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      await expect(session.putBack()).rejects.toThrow();
      await expect(session.restoreKept({ id: 'k' } as any)).rejects.toThrow();
      expect(holds.restorePublished).toHaveBeenCalledTimes(1);
      expect(holds.restoreKept).not.toHaveBeenCalled();
    });

    it('clearing a translation is a change that can be published', async () => {
      localization.enabledLanguages.set([ENGLISH, HINDI]);
      localization.isMultilingual.set(true);
      drafts.getTranslation.mockResolvedValue({ lang: 'hi', title: 'हिन्दी' });
      drafts.deleteTranslation.mockResolvedValue('stamp-cleared');
      await session.initLanguages();
      loadStored({ publishedStatus: true, modifiedAt: { seconds: 3 }, lastPublishedAt: { seconds: 5 } });
      expect(session.nothingToPublish()).toBe(true);
      await session.switchLanguage('hi');
      await session.clearTranslation();
      expect(session.editState()).toBe('changes');
      expect(session.nothingToPublish()).toBe(false);
    });

    it('marks the page a card is changed on, and clears it in the entry\'s own editor (VE-D72)', async () => {
      loadStored();
      session.cardOnPage = 'home';
      view.values.title = 'On the page';
      await session.performAutoSave();
      expect(store.saveDraft.mock.calls[0][1].changedOnPage).toBe('home');
      session.cardOnPage = null;
      view.values.title = 'Looked through';
      await session.performAutoSave();
      expect('changedOnPage' in store.saveDraft.mock.calls[1][1]).toBe(false);
      session.cardOnPage = undefined;
      arrives({ changedOnPage: 'home', editing: { by: 'me', name: 'Me' } });
      view.values.title = 'In its own editor';
      await session.performAutoSave();
      expect(store.saveDraft.mock.calls[2][1].changedOnPage).not.toBe('home');
      expect('changedOnPage' in store.saveDraft.mock.calls[2][1]).toBe(true);
    });
  });
});
