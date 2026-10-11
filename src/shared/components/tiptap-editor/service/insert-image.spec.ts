import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { insertImageAndMoveOn } from './insert-image';

describe('insertImageAndMoveOn', () => {
    let editor: Editor;
    afterEach(() => editor?.destroy());

    it('keeps each image when several are inserted one after another', () => {
        editor = new Editor({ extensions: [StarterKit, Image], content: '<p>Intro</p>' });
        editor.commands.focus('end');
        insertImageAndMoveOn(editor, 'https://x/1.webp', 'Plant one');
        insertImageAndMoveOn(editor, 'https://x/2.webp');
        insertImageAndMoveOn(editor, 'https://x/3.webp');
        const images = Array.from(editor.view.dom.querySelectorAll('img')).map((img) => img.getAttribute('src'));
        expect(images).toEqual(['https://x/1.webp', 'https://x/2.webp', 'https://x/3.webp']);
        expect(editor.getHTML()).toContain('alt="Plant one"');
    });
});

describe('insertImageAndMoveOn in the middle of the text', () => {
    it('puts the cursor in the paragraph that follows, adding none', () => {
        const editor = new Editor({ extensions: [StarterKit, Image], content: '<p>One</p><p>Two</p>' });
        editor.commands.focus('start');
        editor.commands.setTextSelection(4);
        insertImageAndMoveOn(editor, 'https://x/1.webp');
        insertImageAndMoveOn(editor, 'https://x/2.webp');
        expect(editor.view.dom.querySelectorAll('img')).toHaveLength(2);
        expect(editor.view.dom.querySelectorAll('p')).toHaveLength(2);
        editor.destroy();
    });
});
