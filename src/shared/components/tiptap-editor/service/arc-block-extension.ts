/**
 * Structured content blocks (docs/discoverability-spec.md, D-D10).
 *
 * One Tiptap node, `arcBlock`, with a `kind` attribute: faq, takeaways,
 * howto or definition. Each is a plain wrapper around ordinary block
 * content, so the author edits headings, paragraphs and lists as usual;
 * only the wrapper `<section data-arc-block="…">` is special. That is what
 * lets the publish pipeline recognise the shape (FAQ = h3 + answer pairs,
 * how-to = h3 + ordered list, …) and emit the matching schema.org node
 * without the two ever disagreeing, and what keeps templates and the
 * Markdown twin free of new bindings: to them it is just sections.
 */
import { Node, mergeAttributes } from '@tiptap/core';

export type ArcBlockKind = 'faq' | 'takeaways' | 'howto' | 'definition';

export interface ArcBlockMeta {
    kind: ArcBlockKind;
    title: string;
    icon: string;
    description: string;
    /** The content a fresh block starts with. */
    seed: string;
}

export const ARC_BLOCKS: readonly ArcBlockMeta[] = [
    {
        kind: 'faq',
        title: 'FAQ',
        icon: 'bi bi-patch-question',
        description: 'Questions people ask, each with a direct answer. Emitted as FAQPage.',
        seed: '<h3>What is this about?</h3><p>Answer in one or two sentences, then add detail.</p><h3>Another question?</h3><p>Its answer.</p>',
    },
    {
        kind: 'takeaways',
        title: 'Key takeaways',
        icon: 'bi bi-list-check',
        description: 'Three to five bullet points that summarise the page. Emitted as the abstract.',
        seed: '<h3>Key takeaways</h3><ul><li>First point.</li><li>Second point.</li><li>Third point.</li></ul>',
    },
    {
        kind: 'howto',
        title: 'How-to steps',
        icon: 'bi bi-list-ol',
        description: 'A heading and numbered steps. Emitted as HowTo.',
        seed: '<h3>How to do the thing</h3><ol><li><strong>First step.</strong> What to do and why.</li><li><strong>Second step.</strong> What to do next.</li></ol>',
    },
    {
        kind: 'definition',
        title: 'Definition',
        icon: 'bi bi-book',
        description: 'A "What is X?" heading and a one-sentence answer first. Emitted as DefinedTerm.',
        seed: '<h3>What is X?</h3><p>X is a one-sentence definition. The rest of the paragraph adds context.</p>',
    },
];

export const ARC_BLOCK_KINDS = ARC_BLOCKS.map(b => b.kind);

declare module '@tiptap/core' {
    interface Commands<ReturnType> {
        arcBlock: {
            /** Inserts a block of the given kind, seeded, after the current block. */
            insertArcBlock: (kind: ArcBlockKind) => ReturnType;
            /** Unwraps the block the cursor is in, keeping its content. */
            removeArcBlock: () => ReturnType;
        };
    }
}

export const ArcBlock = Node.create({
    name: 'arcBlock',
    group: 'block',
    content: 'block+',
    defining: true,
    draggable: true,

    addAttributes() {
        return {
            kind: {
                default: 'faq',
                parseHTML: element => element.getAttribute('data-arc-block'),
                renderHTML: attributes => ({ 'data-arc-block': attributes['kind'] }),
            },
        };
    },

    parseHTML() {
        return ARC_BLOCK_KINDS.map(kind => ({ tag: `section[data-arc-block="${kind}"]` }));
    },

    renderHTML({ HTMLAttributes }) {
        return ['section', mergeAttributes(HTMLAttributes, { class: 'arc-block' }), 0];
    },

    addCommands() {
        return {
            insertArcBlock:
                (kind) =>
                ({ chain }) => {
                    const meta = ARC_BLOCKS.find(b => b.kind === kind);
                    if (!meta) return false;
                    return chain()
                        .focus()
                        .insertContent(`<section data-arc-block="${kind}">${meta.seed}</section><p></p>`)
                        .run();
                },
            removeArcBlock:
                () =>
                ({ state, tr, dispatch }) => {
                    // Unwrap the whole block the cursor is in, keeping its
                    // content in place. `lift` would only move one paragraph
                    // out and leave the wrapper behind.
                    const { $from } = state.selection;
                    for (let depth = $from.depth; depth > 0; depth--) {
                        const node = $from.node(depth);
                        if (node.type.name !== this.name) continue;
                        if (dispatch) {
                            const start = $from.before(depth);
                            tr.replaceWith(start, start + node.nodeSize, node.content);
                        }
                        return true;
                    }
                    return false;
                },
        };
    },
});
