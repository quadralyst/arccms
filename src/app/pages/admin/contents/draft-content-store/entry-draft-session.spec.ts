import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { of, throwError } from 'rxjs';
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

    TestBed.configureTestingModule({
      providers: [
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
});
