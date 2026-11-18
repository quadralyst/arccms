import { Extension } from '@tiptap/core';
import type { Node as PmNode } from '@tiptap/pm/model';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

/** The class an empty line gets while the cursor is elsewhere: drawn with no height, as on the page. */
export const EMPTY_LINE_CLASS = 'arc-empty-line';

/**
 * Empty lines as the page draws them (specs/visual-editing-spec.md, VE-D16). The
 * site draws an empty paragraph as nothing, while the editor gives it a line so
 * the cursor can go there; opening the body in place then pushed the page down.
 * Every empty line except the one the cursor is in is marked, and IN_PLACE_CSS
 * draws it with no height. The cursor still moves into one, and it shows while it
 * is there. A body of one empty line keeps it, so there is somewhere to type.
 */
export function emptyLineDecorations(doc: PmNode, cursor: number): DecorationSet {
    if (doc.childCount === 1 && doc.firstChild?.isTextblock && doc.firstChild.content.size === 0) return DecorationSet.empty;
    const marks: Decoration[] = [];
    doc.descendants((node, pos) => {
        if (!node.isTextblock) return true;
        const end = pos + node.nodeSize;
        if (node.content.size === 0 && !(cursor > pos && cursor < end)) {
            marks.push(Decoration.node(pos, end, { class: EMPTY_LINE_CLASS }));
        }
        return false;
    });
    return DecorationSet.create(doc, marks);
}

export const ArcEmptyLines = Extension.create({
    name: 'arcEmptyLines',
    addProseMirrorPlugins() {
        return [
            new Plugin({
                key: new PluginKey('arcEmptyLines'),
                props: {
                    decorations: (state) => emptyLineDecorations(state.doc, state.selection.head),
                },
            }),
        ];
    },
});
