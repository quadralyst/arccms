/**
 * Empty lines on the edit-on-page screen are drawn as the page draws them, except
 * the one the cursor is in (specs/visual-editing-spec.md, VE-D16).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { ArcEmptyLines, EMPTY_LINE_CLASS } from './empty-lines';
import { IN_PLACE_CSS } from './in-place';

describe('ArcEmptyLines', () => {
    let editor: Editor | null = null;

    const open = (content: string) => {
        editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, ArcEmptyLines], content });
        return editor;
    };
    const marked = () => Array.from(editor!.view.dom.children).map((el) => el.classList.contains(EMPTY_LINE_CLASS));

    afterEach(() => {
        editor?.destroy();
        editor = null;
    });

    it('marks every empty line, and not the one the cursor is in', () => {
        const e = open('<p>One</p><p></p><p>Two</p><p></p>');
        e.commands.setTextSelection(1);
        expect(marked()).toEqual([false, true, false, true]);
        // Into the first empty line: it shows, so what is typed there is seen.
        e.commands.setTextSelection(6);
        expect(marked()).toEqual([false, false, false, true]);
        e.commands.insertContent('typed');
        expect(marked()).toEqual([false, false, false, true]);
    });

    it('leaves the line of an empty body, so there is somewhere to type', () => {
        open('<p></p>');
        expect(marked()).toEqual([false]);
    });

    it('changes nothing in the saved HTML', () => {
        const e = open('<p>One</p><p></p><p>Two</p>');
        expect(e.getHTML()).toBe('<p>One</p><p></p><p>Two</p>');
    });

    it('is drawn with no height, and the page\'s own wrapping beats TipTap\'s', () => {
        expect(IN_PLACE_CSS).toContain('.ProseMirror.arc-in-place-rich .arc-empty-line { display: none; }');
        expect(IN_PLACE_CSS).toMatch(/\.ProseMirror\.arc-in-place-rich \{ white-space: pre-wrap;/);
    });
});
