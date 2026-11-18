import { Editor } from '@tiptap/core';
import { NodeSelection } from 'prosemirror-state';
import { insertImageAndMoveOn } from './insert-image';

/**
 * A picture in the body: select it, replace it, remove it, give it alt text. The
 * form editor's selection menu and the Visual Editor's box beside the picture
 * both use these, so pictures are handled the same way in both
 * (specs/visual-editing-spec.md, VE-D16).
 */
export interface SelectedImage {
    /** Where the picture's node starts. */
    pos: number;
    src: string;
    alt: string;
}

function imageAt(editor: Editor, pos: number) {
    const node = editor.state.doc.nodeAt(pos);
    return node && node.type.name === 'image' ? node : null;
}

/** The picture the selection is on, else null. */
export function selectedImage(editor: Editor | null | undefined): SelectedImage | null {
    const selection = editor?.state.selection;
    if (!(selection instanceof NodeSelection) || selection.node.type.name !== 'image') return null;
    return { pos: selection.from, src: String(selection.node.attrs['src'] ?? ''), alt: String(selection.node.attrs['alt'] ?? '') };
}

/** Selects the nth picture with this address (0 first), as clicked on the page. Returns its position, or null. */
export function selectImage(editor: Editor, src: string, nth = 0): number | null {
    let seen = 0;
    let found: number | null = null;
    editor.state.doc.descendants((node, pos) => {
        if (found !== null) return false;
        if (node.type.name === 'image' && String(node.attrs['src'] ?? '') === src) {
            if (seen === nth) found = pos;
            seen++;
        }
        return true;
    });
    if (found !== null) editor.view.dispatch(editor.state.tr.setSelection(NodeSelection.create(editor.state.doc, found)));
    return found;
}

/** Puts another picture in this one's place, keeping its alt text when the new one has none. It stays selected. */
export function replaceImage(editor: Editor, pos: number, src: string, alt?: string): boolean {
    const node = imageAt(editor, pos);
    if (!node) return false;
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src, alt: alt?.trim() || node.attrs['alt'] || null });
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    editor.view.dispatch(tr);
    return true;
}

/** Takes the picture out. */
export function removeImage(editor: Editor, pos: number): boolean {
    const node = imageAt(editor, pos);
    if (!node) return false;
    editor.view.dispatch(editor.state.tr.delete(pos, pos + node.nodeSize));
    return true;
}

/** What the picture shows, for screen readers and search; empty removes it. It stays selected. */
export function setImageAlt(editor: Editor, pos: number, alt: string): boolean {
    const node = imageAt(editor, pos);
    if (!node) return false;
    const value = alt.trim() || null;
    if ((node.attrs['alt'] ?? null) === value) return true;
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, alt: value });
    tr.setSelection(NodeSelection.create(tr.doc, pos));
    editor.view.dispatch(tr);
    return true;
}

/** A picture chosen in the media picker: it replaces the selected picture, else goes in at the cursor. */
export function placeImage(editor: Editor, src: string, alt?: string): void {
    const selected = selectedImage(editor);
    if (selected) replaceImage(editor, selected.pos, src, alt);
    else insertImageAndMoveOn(editor, src, alt);
}
