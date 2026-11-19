/**
 * A custom field placed in the text (specs/visual-editing-spec.md, VE-D28): the
 * marker the text keeps, the card the editor shows, and one marker per field.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { FieldPlace, FieldPlaces, fieldSummary, isPlaceable } from './field-place';

const MARKER = '<div data-arc-place="articles-faq"></div>';

function places(over: Partial<FieldPlaces> = {}): FieldPlaces {
    return {
        fields: () => [{ key: 'articles-faq', label: 'FAQ', type: 'faq' }],
        open: vi.fn(),
        summary: () => ['One?', 'Two?'],
        translate: (key) => key.split('.').pop()!,
        ...over,
    };
}

describe('FieldPlace', () => {
    let editor: Editor | null = null;
    afterEach(() => {
        editor?.destroy();
        editor = null;
    });

    function mount(content: string, p: FieldPlaces | null = places()) {
        editor = new Editor({ element: document.createElement('div'), extensions: [StarterKit, FieldPlace.configure({ places: p })], content });
        return editor;
    }

    it('starts with a marker in the text: the card, and the marker kept as it was', () => {
        const e = mount(`<p>Intro</p>${MARKER}<p>After</p>`);
        const card = e.view.dom.querySelector('.arc-field-place')!;
        expect(card.querySelector('.arc-field-place-tag')!.textContent).toBe('tag');
        expect(card.querySelector('.arc-field-place-name')!.textContent).toBe('FAQ');
        expect([...card.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['One?', 'Two?']);
        expect(e.getHTML()).toBe(`<p>Intro</p>${MARKER}<p>After</p>`);
    });

    it('Edit opens the field', () => {
        const p = places();
        const e = mount(MARKER, p);
        (e.view.dom.querySelector('.arc-field-place-edit') as HTMLButtonElement).click();
        expect(p.open).toHaveBeenCalledWith('articles-faq');
    });

    it('shows the field as the page drew it, when the screen has it', () => {
        const drawn = document.createElement('section');
        drawn.className = 'arc-faq';
        const e = mount(MARKER, places({ drawn: () => drawn }));
        expect(e.view.dom.querySelector('.arc-field-place-drawn > .arc-faq')).toBe(drawn);
    });

    it('says so when the field is empty, or the type no longer has it', () => {
        expect(mount(MARKER, places({ summary: () => [] })).view.dom.querySelector('.arc-field-place-empty')!.textContent).toBe('empty');
        editor!.destroy();
        expect(mount('<div data-arc-place="gone"></div>').view.dom.querySelector('.arc-field-place-body')!.textContent).toBe('gone');
    });

    it('places a field once: placing it again moves its marker', () => {
        const e = mount(`${MARKER}<p>One</p><p>Two</p>`);
        e.commands.setTextSelection(e.state.doc.content.size - 1);
        e.commands.placeField('articles-faq');
        expect(e.getHTML().match(/data-arc-place/g)).toHaveLength(1);
        expect(e.getHTML().indexOf('Two')).toBeLessThan(e.getHTML().indexOf('data-arc-place'));
    });

    it('follows the field when it changes on screen, and draws again only when the card would change', () => {
        let lines = ['One?'];
        let redraw: () => void = () => undefined;
        const stop = vi.fn();
        const e = mount(MARKER, places({ summary: () => lines, changes: (cb) => { redraw = cb; return stop; } }));
        const card = () => e.view.dom.querySelector('.arc-field-place')!;
        const firstBody = card().querySelector('.arc-field-place-body');
        redraw();
        expect(card().querySelector('.arc-field-place-body')).toBe(firstBody);
        lines = ['One?', 'Three?'];
        redraw();
        expect([...card().querySelectorAll('li')].map((li) => li.textContent)).toEqual(['One?', 'Three?']);
        e.destroy();
        editor = null;
        expect(stop).toHaveBeenCalled();
    });

    it('keeps a marker in a text with no places offered', () => {
        expect(mount(`<p>x</p>${MARKER}`, null).getHTML()).toContain(MARKER);
    });

    describe('markers pasted or dropped in (VE3.11)', () => {
        // A paste as the browser makes one (the test page has no ClipboardEvent).
        const paste = (e: Editor, html: string) => e.view.pasteHTML(html, new Event('paste') as ClipboardEvent);
        const count = (e: Editor, key = 'articles-faq') => e.getHTML().split(`data-arc-place="${key}"`).length - 1;
        const both = () => places({ fields: () => [{ key: 'articles-faq', label: 'FAQ', type: 'faq' }, { key: 'articles-gallery', label: 'Gallery', type: 'gallery' }] });

        it('a pasted copy of a placed field moves it: one marker, the pasted one', () => {
            const e = mount(`${MARKER}<p>Middle</p><p>End</p>`);
            e.commands.setTextSelection(e.state.doc.content.size - 1);
            paste(e, `<p>Pasted</p>${MARKER}`);
            expect(count(e)).toBe(1);
            // The older one, at the top, went.
            expect(e.state.doc.firstChild!.type.name).toBe('paragraph');
        });

        it('a pasted field placed nowhere yet stays, but only once', () => {
            const e = mount(`<p>Text</p>`, both());
            e.commands.setTextSelection(2);
            paste(e, `${MARKER}<div data-arc-place="articles-gallery"></div>${MARKER}`);
            expect(count(e)).toBe(1);
            expect(count(e, 'articles-gallery')).toBe(1);
        });

        it('a text that places no fields takes none pasted into it', () => {
            const e = mount(`<p>Text</p>`, null);
            e.commands.setTextSelection(2);
            paste(e, `<p>Words</p>${MARKER}`);
            expect(count(e)).toBe(0);
            expect(e.getHTML()).toContain('Words');
        });

        it('a pasted marker for a field this entry cannot place goes', () => {
            const e = mount(`<p>Text</p>`);
            e.commands.setTextSelection(2);
            paste(e, '<div data-arc-place="other-type-faq"></div>');
            expect(e.getHTML()).not.toContain('other-type-faq');
        });

        it('a copy dropped in moves the field; a marker already there is never touched by typing', () => {
            const e = mount(`${MARKER}<p>End</p>`);
            const card = e.state.schema.nodes['fieldPlace'].create({ field: 'articles-faq' });
            e.view.dispatch(e.state.tr.insert(e.state.doc.content.size, card).setMeta('uiEvent', 'drop'));
            expect(count(e)).toBe(1);
            // The older one, at the top, went; the dropped one is after End.
            expect(e.state.doc.firstChild!.textContent).toBe('End');
            e.destroy();
            // A card dragged to another place stays, even for a field the type no longer has.
            const moved = mount(`<div data-arc-place="gone"></div><p>x</p>`, null);
            const from = moved.state.doc.firstChild!;
            const tr = moved.state.tr.delete(0, from.nodeSize);
            tr.insert(tr.doc.content.size, from);
            moved.view.dispatch(tr.setMeta('uiEvent', 'drop'));
            expect(moved.getHTML()).toContain('data-arc-place="gone"');
            expect(moved.state.doc.firstChild!.textContent).toBe('x');
            moved.destroy();
            // Typing keeps whatever markers the text holds, even a field it no longer has.
            const old = mount(`<div data-arc-place="gone"></div><p>x</p>`);
            old.commands.insertContentAt(old.state.doc.content.size - 1, 'y');
            expect(old.getHTML()).toContain('data-arc-place="gone"');
        });
    });
});

describe('fieldSummary', () => {
    it('lists a few lines of each placeable type', () => {
        expect(fieldSummary('faq', [{ question: 'A?' }, { question: ' ' }, { question: 'B?' }])).toEqual(['A?', 'B?']);
        expect(fieldSummary('labelvalue', [{ label: 'Size', value: 'L' }])).toEqual(['Size: L']);
        expect(fieldSummary('image', 'https://x.example/a/cat%20one.jpg?v=1')).toEqual(['cat one.jpg']);
        expect(fieldSummary('richtext', '<p>Hello <b>there</b></p>')).toEqual(['Hello there']);
        expect(fieldSummary('faq', Array.from({ length: 7 }, (_, i) => ({ question: `Q${i}` })))).toEqual(['Q0', 'Q1', 'Q2', 'Q3', 'Q4', '+2']);
        expect(fieldSummary('faq', undefined)).toEqual([]);
    });

    it('knows which types can be placed', () => {
        expect(isPlaceable('gallery')).toBe(true);
        expect(isPlaceable('number')).toBe(false);
    });
});
