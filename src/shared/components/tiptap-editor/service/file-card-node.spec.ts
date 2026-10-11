import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { FileCard, safeFileHref } from './file-card-node';

const file = { url: 'https://firebasestorage.googleapis.com/v0/b/x/o/mediaFiles%2Freport.pdf?alt=media', title: 'Annual <Report>', type: 'pdf' as const, bytes: 2411724, pages: 24 };

let editor: Editor | null = null;
afterEach(() => {
    editor?.destroy();
    editor = null;
});

function makeEditor(content = ''): Editor {
    editor = new Editor({ extensions: [StarterKit, FileCard], content });
    return editor;
}

describe('file card (MF-D20)', () => {
    it('is stored as one link with its title and type, the title as text', () => {
        const ed = makeEditor('<p>Before</p>');
        ed.commands.insertFileCard(file);
        const html = ed.getHTML();
        expect(html).toContain('<a class="arc-file" data-arc-file="pdf" data-bytes="2411724"');
        expect(html).toContain('target="_blank" rel="noopener"');
        expect(html).toContain('<span class="arc-file-title">Annual &lt;Report&gt;</span>');
        expect(html).toContain('<span class="arc-file-meta">PDF · 2.3 MB</span>');
        expect(html).toContain('data-pages="24"');
    });

    it('reads back from saved HTML as a card, not a plain link', () => {
        const ed = makeEditor('<p>x</p>');
        ed.commands.insertFileCard(file);
        const again = makeEditor(ed.getHTML());
        const cards: any[] = [];
        again.state.doc.descendants((node) => {
            if (node.type.name === 'fileCard') cards.push(node.attrs);
        });
        expect(cards).toEqual([{ href: file.url, title: 'Annual <Report>', type: 'pdf', bytes: 2411724, pages: 24 }]);
    });

    it('never links anything but the web', () => {
        expect(safeFileHref('javascript:alert(1)')).toBeNull();
        expect(safeFileHref('data:text/html,x')).toBeNull();
        expect(safeFileHref('not a url')).toBeNull();
        expect(safeFileHref('https://a.b/c.pdf')).toBe('https://a.b/c.pdf');
        const ed = makeEditor();
        expect(ed.commands.insertFileCard({ ...file, url: 'javascript:alert(1)' })).toBe(false);
        const parsed = makeEditor('<a class="arc-file" href="javascript:alert(1)"><span class="arc-file-title">x</span></a>');
        expect(parsed.getHTML()).not.toContain('javascript:');
    });
});
