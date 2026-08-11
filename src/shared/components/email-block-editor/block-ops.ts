import { EmailBlock, EmailBlockType } from '../../email-compiler/email-design.model';

/** Generate a reasonably unique block id (client-side only). */
export function newBlockId(): string {
    return 'blk_' + Math.random().toString(36).slice(2, 10);
}

/** Create a new block of the given type with sensible defaults. */
export function createBlock(type: EmailBlockType): EmailBlock {
    const id = newBlockId();
    switch (type) {
        case 'heading': return { id, type, text: 'New heading', level: 2, align: 'left' };
        case 'paragraph': return { id, type, html: 'New paragraph text.', align: 'left' };
        case 'image': return { id, type, src: '', alt: '', width: 520, align: 'center' };
        case 'button': return { id, type, text: 'Click here', href: 'https://', align: 'center' };
        case 'divider': return { id, type };
        case 'spacer': return { id, type, height: 24 };
        case 'columns': return { id, type, left: [], right: [] };
        case 'social': return { id, type };
        case 'raw': return { id, type, html: '<!-- custom HTML -->' };
        default: return { id, type: 'paragraph', html: '' } as EmailBlock;
    }
}

/** Move the block at `index` up (-1) or down (+1); returns a new array. */
export function moveBlock(blocks: EmailBlock[], index: number, dir: -1 | 1): EmailBlock[] {
    const target = index + dir;
    if (index < 0 || index >= blocks.length || target < 0 || target >= blocks.length) return blocks;
    const next = [...blocks];
    [next[index], next[target]] = [next[target], next[index]];
    return next;
}

/** Remove the block at `index`; returns a new array. */
export function removeBlock(blocks: EmailBlock[], index: number): EmailBlock[] {
    return blocks.filter((_, i) => i !== index);
}

/** Append a merge tag (e.g. "##NAME##") to an existing text/html value. */
export function appendTag(value: string, tag: string): string {
    const base = value || '';
    return base.length && !base.endsWith(' ') ? `${base} ${tag}` : `${base}${tag}`;
}
