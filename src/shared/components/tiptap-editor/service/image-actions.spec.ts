/**
 * A picture in the body (specs/visual-editing-spec.md, VE-D16): the actions the
 * form editor's selection menu and the Visual Editor's box share.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { placeImage, removeImage, replaceImage, selectImage, selectedImage, setImageAlt } from './image-actions';

describe('image actions', () => {
    let editor: Editor;
    const open = (content: string) => (editor = new Editor({ extensions: [StarterKit, Image], content }));
    const images = () => {
        const found: { src: string; alt: string | null }[] = [];
        editor.state.doc.descendants((node) => {
            if (node.type.name === 'image') found.push({ src: node.attrs['src'], alt: node.attrs['alt'] });
        });
        return found;
    };

    afterEach(() => editor?.destroy());

    it('selects the picture clicked, the nth of several alike, and says which is selected', () => {
        open('<p>A</p><img src="/a.jpg"><p>B</p><img src="/a.jpg" alt="Second">');
        expect(selectedImage(editor)).toBeNull();
        const pos = selectImage(editor, '/a.jpg', 1);
        expect(pos).not.toBeNull();
        expect(selectedImage(editor)).toEqual({ pos, src: '/a.jpg', alt: 'Second' });
        expect(selectImage(editor, '/missing.jpg')).toBeNull();
    });

    it('replaces a picture in place, keeping its alt text when the new one has none, and keeps it selected', () => {
        open('<p>A</p><img src="/old.jpg" alt="A hill">');
        const pos = selectImage(editor, '/old.jpg')!;
        replaceImage(editor, pos, '/new.jpg');
        expect(images()).toEqual([{ src: '/new.jpg', alt: 'A hill' }]);
        expect(selectedImage(editor)?.src).toBe('/new.jpg');
        replaceImage(editor, pos, '/other.jpg', 'A lake');
        expect(images()).toEqual([{ src: '/other.jpg', alt: 'A lake' }]);
    });

    it('sets and clears alt text, and removes a picture', () => {
        open('<p>A</p><img src="/a.jpg">');
        const pos = selectImage(editor, '/a.jpg')!;
        setImageAlt(editor, pos, '  Mountain at dusk ');
        expect(images()[0].alt).toBe('Mountain at dusk');
        setImageAlt(editor, pos, '');
        expect(images()[0].alt).toBeNull();
        removeImage(editor, pos);
        expect(images()).toEqual([]);
        // Nothing there: nothing done.
        expect(removeImage(editor, 0)).toBe(false);
    });

    it('places a picture from the picker over the selected one, else at the cursor', () => {
        open('<p>A</p><img src="/a.jpg">');
        selectImage(editor, '/a.jpg');
        placeImage(editor, '/b.jpg', 'B');
        expect(images()).toEqual([{ src: '/b.jpg', alt: 'B' }]);
        editor.commands.setTextSelection(1);
        placeImage(editor, '/c.jpg');
        expect(images().map((i) => i.src)).toEqual(['/c.jpg', '/b.jpg']);
    });
});
