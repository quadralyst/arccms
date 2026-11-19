/**
 * The edit-on-page screen (specs/visual-editing-spec.md, VE-D14, VE-D26): the frame's
 * address, the strip's status, Form and back saving first, Escape and the panel, and
 * the panel opening on a line the editor must act on. The form editor it hosts in page
 * mode has its own spec; here it is a stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import EntryEditPage, { editFrameUrl, inSentence, textPos } from './entry-edit.page';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { previewSessionKey } from '../../../core/preview/preview-channel';
import { MatDialog } from '@angular/material/dialog';
import { ContentTypesStore } from '../contents/content-types/content-types.store';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';

function fakeEditor() {
    const session = {
        isSavingDraft: false,
        isAutoSaving: false,
        creating: signal(false),
        saveFailed: signal(false),
        entryChanged: signal(false),
        entryGone: signal(false),
        publishProblem: signal(''),
        showLanguageBar: signal(false),
        enabledLanguages: signal([{ code: 'en', label: 'English' }, { code: 'hi', label: 'Hindi' }]),
        defaultLang: signal('en'),
        activeLang: signal('en'),
        isTranslating: signal(false),
        deployStatus: signal<string | null>(null),
        unsaved: false,
        hasUnsavedChanges() { return this.unsaved; },
    };
    const summary = { value: 'Short', setValue: vi.fn(function (this: { value: string }, v: string) { summary.value = v; }) };
    const content = { value: '<p>Body</p>' };
    return {
        session: Object.assign(session, { holdPreview: vi.fn() }),
        hasUnsavedChanges: () => session.hasUnsavedChanges(),
        saveAsDraft: vi.fn(async () => { session.unsaved = false; }),
        directPublishContent: vi.fn(async () => undefined),
        pageTitle: 'Concert',
        coverImage: '' as string | null,
        customFieldValues: { 'events-venue': 'Hall' } as Record<string, unknown>,
        publishForm: { get: (name: string) => (name === 'summary' ? summary : name === 'content' ? content : null) },
        currentFields: [{ key: 'events-price', label: 'Price', type: 'number' }],
        activeTab: 'seo',
        cdr: { detectChanges: vi.fn() },
        fieldLabel: (f: { label: string }) => f.label,
        createSlag: vi.fn(),
        triggerAutoSave: vi.fn(),
        onCustomFieldChange: vi.fn(),
        passEditorContentToParent: vi.fn(),
        openMediaManager: vi.fn(),
        openMediaManagerForField: vi.fn(),
        removeCoverImage: vi.fn(),
        removeCustomFieldImage: vi.fn(),
        focusField: vi.fn(),
        currentContentType: () => null,
        switchLanguage: vi.fn(async (code: string) => { session.activeLang.set(code); session.isTranslating.set(code !== 'en'); }),
    };
}

describe('EntryEditPage', () => {
    const router = { navigate: vi.fn(async () => true) };
    let page: EntryEditPage;
    let editor: ReturnType<typeof fakeEditor>;

    beforeEach(() => {
        router.navigate.mockClear();
        TestBed.configureTestingModule({
            imports: [translocoTestingModule()],
            providers: [
                { provide: MatDialog, useValue: { open: vi.fn() } },
                { provide: ContentTypesStore, useValue: { items: signal([]), getAll: vi.fn() } },
                { provide: Router, useValue: router },
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: convertToParamMap({ type: 'articles', id: 'doc1' }) } } },
            ],
        });
        TestBed.overrideComponent(EntryEditPage, { set: { template: '<div></div>', imports: [] } });
        const fixture = TestBed.createComponent(EntryEditPage);
        page = fixture.componentInstance;
        editor = fakeEditor();
        page.editor = editor as never;
    });

    afterEach(() => TestBed.resetTestingModule());

    it('frames the preview route in edit mode, on the entry\'s own channel', () => {
        expect(editFrameUrl('articles', 'doc1')).toBe(`/admin/preview/articles/doc1?edit=1#s=${encodeURIComponent(previewSessionKey('articles', 'doc1'))}`);
        expect(editFrameUrl('a b', 'x/y')).toMatch(/^\/admin\/preview\/a%20b\/x%2Fy\?edit=1#s=/);
        expect(page.type).toBe('articles');
        expect(page.id).toBe('doc1');
    });

    it('says Saved, Unsaved changes, Saving and Not saved as the draft is', () => {
        page.readStatus();
        expect(page.status()).toBe('saved');
        editor.session.unsaved = true;
        page.readStatus();
        expect(page.status()).toBe('unsaved');
        editor.session.isAutoSaving = true;
        page.readStatus();
        expect(page.status()).toBe('saving');
        editor.session.isAutoSaving = false;
        editor.session.saveFailed.set(true);
        page.readStatus();
        expect(page.status()).toBe('not_saved');
    });

    it('says Publishing until the page is live, then Published until the next change', () => {
        editor.session.deployStatus.set('pending');
        page.readStatus();
        expect(page.status()).toBe('publishing');
        editor.session.deployStatus.set('deployed');
        page.readStatus();
        expect(page.status()).toBe('published');
        editor.session.unsaved = true;
        page.readStatus();
        expect(page.status()).toBe('unsaved');
        editor.session.unsaved = false;
    });

    it('opens the panel when a line the editor must act on appears, once', () => {
        page.readStatus();
        expect(page.panel.open()).toBe(false);
        editor.session.entryChanged.set(true);
        page.readStatus();
        expect(page.panel.open()).toBe(true);
        page.panel.setOpen(false);
        page.readStatus();
        expect(page.panel.open()).toBe(false);
        editor.session.entryChanged.set(false);
        page.readStatus();
        editor.session.publishProblem.set('build');
        page.readStatus();
        expect(page.panel.open()).toBe(true);
    });

    it('goes to the form editor for the same entry, saving first', async () => {
        editor.session.unsaved = true;
        await page.toForm();
        expect(editor.saveAsDraft).toHaveBeenCalled();
        expect(router.navigate).toHaveBeenCalledWith(['/admin/contents', 'articles', 'edit', 'doc1']);
    });

    it('stays, with the panel open on why, when the save did not land', async () => {
        editor.session.unsaved = true;
        editor.saveAsDraft.mockImplementation(async () => { editor.session.saveFailed.set(true); });
        await page.toForm();
        expect(router.navigate).not.toHaveBeenCalled();
        expect(page.panel.open()).toBe(true);
    });

    it('publishes through the editor\'s own checks, and closes to the type\'s entries', () => {
        page.publish();
        expect(editor.directPublishContent).toHaveBeenCalled();
        page.close();
        expect(router.navigate).toHaveBeenCalledWith(['/admin/contents', 'articles']);
    });

    it('closes the panel on Escape, but leaves Escape to a dialog over the screen', () => {
        page.panel.setOpen(true);
        const dialog = document.createElement('div');
        dialog.className = 'cdk-overlay-container';
        dialog.innerHTML = '<div class="mat-mdc-dialog-container"></div>';
        document.body.appendChild(dialog);
        page.onKey(new KeyboardEvent('keydown', { key: 'Escape' }));
        expect(page.panel.open()).toBe(true);
        dialog.remove();
        const event = new KeyboardEvent('keydown', { key: 'Escape', cancelable: true });
        page.onKey(event);
        expect(page.panel.open()).toBe(false);
        expect(event.defaultPrevented).toBe(true);
    });

    it('asks before leaving with work not stored, as the form editor does', () => {
        expect(page.hasUnsavedChanges()).toBe(false);
        editor.session.unsaved = true;
        expect(page.hasUnsavedChanges()).toBe(true);
    });

    describe('editing in place (VE-D16)', () => {
        const spot = (field: string, el: HTMLElement = document.createElement('span')) =>
            ({ el, key: field, field, builtin: !field.includes('-'), kind: 'popover', attr: '', row: null }) as never;

        it('writes typed values through the form editor, as its own boxes do', () => {
            page.setText('title', 'Concert night');
            expect(editor.pageTitle).toBe('Concert night');
            expect(editor.createSlag).toHaveBeenCalled();
            expect(editor.triggerAutoSave).toHaveBeenCalled();
            page.setText('summary', 'Longer');
            expect(editor.publishForm.get('summary')!.setValue).toHaveBeenCalledWith('Longer');
            page.setText('events-venue', 'Big hall');
            expect(editor.onCustomFieldChange).toHaveBeenCalledWith('events-venue', 'Big hall');
            editor.triggerAutoSave.mockClear();
            page.setText('title', 'Concert night');
            expect(editor.triggerAutoSave).not.toHaveBeenCalled();
            page.setRich('content', '<p>New</p>');
            expect(editor.passEditorContentToParent).toHaveBeenCalledWith('<p>New</p>');
            page.setRich('events-notes', '<p>N</p>');
            expect(editor.onCustomFieldChange).toHaveBeenCalledWith('events-notes', '<p>N</p>');
        });

        it('holds the page in the session while a spot is typed in', () => {
            page.inPlaceHost.hold(true);
            expect(editor.session.holdPreview).toHaveBeenCalledWith(true);
        });

        it('picks an image at once for an empty image spot, else offers Replace and Remove', () => {
            page.openImage(spot('coverImage'));
            expect(editor.openMediaManager).toHaveBeenCalled();
            expect(page.pop()).toBeNull();
            editor.coverImage = '/c.jpg';
            page.openImage(spot('coverImage'));
            expect(page.pop()?.image).toBe(true);
            page.removeImage();
            expect(editor.removeCoverImage).toHaveBeenCalled();
            expect(page.pop()).toBeNull();
            editor.customFieldValues['events-poster'] = '/p.jpg';
            page.openImage(spot('events-poster'));
            page.replaceImage();
            expect(editor.openMediaManagerForField).toHaveBeenCalledWith('events-poster', 'events-poster');
        });

        it('puts the form editor\'s own control for a field in the box, and back in the panel after', () => {
            const panel = document.createElement('div');
            panel.innerHTML = '<div id="req-events-price"><label for="p">Price</label><input id="p" type="number"></div>';
            document.body.appendChild(panel);
            const body = document.createElement('div');
            page.popBody = { nativeElement: body } as never;
            page.openPopover(spot('events-price'));
            expect(editor.activeTab).toBe('basic');
            expect(body.querySelector('#req-events-price')).not.toBeNull();
            expect(page.pop()?.image).toBe(false);
            page.closePopover();
            expect(panel.querySelector('#req-events-price')).not.toBeNull();
            expect(body.children).toHaveLength(0);
            expect(page.pop()).toBeNull();
            panel.remove();
        });

        it('opens the panel on a field with no control to move', () => {
            vi.useFakeTimers();
            page.openPopover(spot('tags'));
            expect(page.panel.open()).toBe(true);
            vi.advanceTimersByTime(300);
            expect(editor.focusField).toHaveBeenCalledWith('tags', undefined);
            vi.useRealTimers();
        });

        it('closes a box before the panel on Escape', () => {
            page.panel.setOpen(true);
            editor.coverImage = '/c.jpg';
            page.openImage(spot('coverImage'));
            page.onKey(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }));
            expect(page.pop()).toBeNull();
            expect(page.panel.open()).toBe(true);
        });
    });

    it('offers the site\'s languages on a multilingual site, edits a translation, and locks what every language shares', async () => {
        page.readStatus();
        expect(page.langs()).toEqual([]);
        editor.session.showLanguageBar.set(true);
        page.readStatus();
        expect(page.langs().map((l) => l.code)).toEqual(['en', 'hi']);
        expect(page.sharedField('events-price', false)).toBe(false);
        await page.switchLanguage('hi');
        expect(editor.switchLanguage).toHaveBeenCalledWith('hi');
        expect(page.lang()).toBe('hi');
        // A number is the same in every language; the title and body are translated.
        expect(page.sharedField('events-price', false)).toBe(true);
        expect(page.sharedField('coverImage', true)).toBe(true);
        expect(page.sharedField('title', true)).toBe(false);
        expect(page.sharedField('content', true)).toBe(false);
    });

    it('opens the panel for a field the form editor asks for that the page does not show', () => {
        expect(page.hooks.reveal('price')).toBe(false);
        page.hooks.openPanel();
        expect(page.panel.open()).toBe(true);
    });
});

describe('textPos', () => {
    it('finds the clicked text in the editor, the same piece of several alike, else nothing', () => {
        const el = document.createElement('div');
        const editor = new Editor({ element: el, extensions: [StarterKit], content: '<p>Same</p><p><strong>Same</strong> and more</p>' });
        try {
            const second = textPos(editor, { data: 'Same', nth: 1, offset: 2 })!;
            expect(editor.state.doc.textBetween(second, second + 2)).toBe('me');
            expect(editor.state.doc.resolve(second).parent.textContent).toBe('Same and more');
            expect(textPos(editor, { data: 'Missing', nth: 0, offset: 0 })).toBeNull();
            expect(textPos(editor, undefined)).toBeNull();
        } finally {
            editor.destroy();
        }
    });
});

describe('inSentence', () => {
    it('puts a label inside "Add ..." with a small first letter, and leaves an acronym alone', () => {
        expect(inSentence('Cover image')).toBe('cover image');
        expect(inSentence('FAQ')).toBe('FAQ');
        expect(inSentence('URL slug')).toBe('URL slug');
        expect(inSentence('टिकट मूल्य')).toBe('टिकट मूल्य');
    });
});

describe('the Page settings panel scrolls (layout rules)', () => {
    // jsdom draws no layout, so the rules themselves are checked: without them the form
    // editor grows to its full height, its own list never scrolls and a jump to a field
    // scrolls the clipped panel instead, pushing the tabs out of sight.
    const source = readFileSync(resolve(__dirname, 'entry-edit.page.ts'), 'utf8');

    it('holds the form editor to the panel height', () => {
        expect(source).toMatch(/\.arc-ed-panel-body > arc-create-content \{[^}]*min-height: 0;[^}]*height: 100%;/);
    });

    it('clips the panel body so a jump to a field cannot scroll it', () => {
        expect(source).toMatch(/\.arc-ed-panel-body \{[^}]*overflow: clip;/);
    });
});
