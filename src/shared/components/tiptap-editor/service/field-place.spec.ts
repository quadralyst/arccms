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
