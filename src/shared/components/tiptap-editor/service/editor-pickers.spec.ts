/**
 * Insert image and Attach file act on the editor they were typed in
 * (specs/visual-editing-spec.md, VE3.2 build note, fix 3): two editors on one
 * screen, the body on the page and a rich text field in the panel, never mix.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ArcPickers, openEditorPicker } from './editor-pickers';

describe('editor pickers', () => {
    afterEach(() => {
        delete (window as unknown as { uploadImage?: unknown }).uploadImage;
    });

    it('opens the picker of the editor it was asked from', () => {
        const first = vi.fn();
        const second = vi.fn();
        const global = vi.fn();
        (window as unknown as { uploadImage: () => void }).uploadImage = global;
        const a = new Editor({ extensions: [StarterKit, ArcPickers.configure({ uploadImage: first })] });
        const b = new Editor({ extensions: [StarterKit, ArcPickers.configure({ uploadImage: second })] });
        openEditorPicker(b.storage, 'uploadImage');
        openEditorPicker(a.storage, 'uploadImage');
        expect(second).toHaveBeenCalledTimes(1);
        expect(first).toHaveBeenCalledTimes(1);
        expect(global).not.toHaveBeenCalled();
        a.destroy();
        b.destroy();
    });

    it('falls back to the page-wide picker for an editor that gives none', () => {
        const global = vi.fn();
        (window as unknown as { uploadImage: () => void }).uploadImage = global;
        const plain = new Editor({ extensions: [StarterKit] });
        openEditorPicker(plain.storage, 'uploadImage');
        expect(global).toHaveBeenCalled();
        plain.destroy();
    });
});
