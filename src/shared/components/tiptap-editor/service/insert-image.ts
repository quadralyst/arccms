import { Editor } from '@tiptap/core';
import { Selection } from 'prosemirror-state';

/**
 * Inserts an image at the cursor and puts the cursor past it, in the next
 * paragraph (a new one when the image ends the text). Left selected, the
 * image would be replaced by the next Insert image, and taking several photos
 * from one PDF is Insert image, Insert, again and again
 * (docs/features/media.html, From a PDF).
 */
export function insertImageAndMoveOn(editor: Editor, src: string, alt?: string): void {
    editor.chain().focus()
        .setImage({ src, ...(alt ? { alt } : {}) })
        .command(({ tr, state }) => {
            const after = tr.selection.to;
            let next = Selection.findFrom(tr.doc.resolve(after), 1, true);
            if (!next) {
                tr.insert(after, state.schema.nodes['paragraph'].create());
                next = Selection.findFrom(tr.doc.resolve(after), 1, true);
            }
            if (next) tr.setSelection(next);
            return true;
        })
        .run();
}
