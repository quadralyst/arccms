/**
 * The edit-on-page screen (specs/visual-editing-spec.md, VE-D14, VE-D26): the frame's
 * address, the strip's status, Form and back saving first, Escape and the panel, and
 * the panel opening on a line the editor must act on. The form editor it hosts in page
 * mode has its own spec; here it is a stand-in.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ActivatedRoute, Router, convertToParamMap } from '@angular/router';
import EntryEditPage, { editFrameUrl } from './entry-edit.page';
import { previewSessionKey } from '../../../core/preview/preview-channel';

function fakeEditor() {
    const session = {
        isSavingDraft: false,
        isAutoSaving: false,
        creating: signal(false),
        saveFailed: signal(false),
        entryChanged: signal(false),
        entryGone: signal(false),
        publishProblem: signal(''),
        unsaved: false,
        hasUnsavedChanges() { return this.unsaved; },
    };
    return {
        session,
        hasUnsavedChanges: () => session.hasUnsavedChanges(),
        saveAsDraft: vi.fn(async () => { session.unsaved = false; }),
        directPublishContent: vi.fn(async () => undefined),
    };
}

describe('EntryEditPage', () => {
    const router = { navigate: vi.fn(async () => true) };
    let page: EntryEditPage;
    let editor: ReturnType<typeof fakeEditor>;

    beforeEach(() => {
        router.navigate.mockClear();
        TestBed.configureTestingModule({
            providers: [
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

    it('opens the panel for a field the form editor asks for that the page does not show', () => {
        expect(page.hooks.reveal('price')).toBe(false);
        page.hooks.openPanel();
        expect(page.panel.open()).toBe(true);
    });
});
