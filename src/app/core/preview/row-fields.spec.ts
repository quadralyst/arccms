/**
 * Repeating fields on the Visual Editor (specs/visual-editing-spec.md, VE-D30):
 * which loop is a repeating field, which row value a binding shows, and which
 * heading belongs to which field.
 */
import { describe, it, expect } from 'vitest';
import { REPEATER_SCHEMAS } from '../../../shared/models/repeater.model';
import { headingFieldOf, repeaterFieldOf, rowEditing, rowSubField, withoutBlankRows } from './row-fields';

const type = {
    slug: 'events',
    fields: [
        { key: 'events-faq', type: 'faq' },
        { key: 'events_cards', type: 'infocard' },
        { key: 'events-media', type: 'gallery' },
        { key: 'events-where', type: 'maplocation' },
        { key: 'events-price', type: 'text' },
    ],
};

describe('repeaterFieldOf', () => {
    it('finds a repeating field by its stored key or its bare name, either prefix', () => {
        expect(repeaterFieldOf('events-faq', type)?.key).toBe('events-faq');
        expect(repeaterFieldOf('faq', type)?.key).toBe('events-faq');
        expect(repeaterFieldOf('cards', type)?.key).toBe('events_cards');
    });

    it('is null for a field that does not repeat, a loop the site fills, or no type', () => {
        expect(repeaterFieldOf('price', type)).toBeNull();
        expect(repeaterFieldOf('related', type)).toBeNull();
        expect(repeaterFieldOf('faq_heading', type)).toBeNull();
        expect(repeaterFieldOf('faq', null)).toBeNull();
    });
});

describe('headingFieldOf', () => {
    it('finds the field of a section heading, by bare or stored name', () => {
        expect(headingFieldOf('faq_heading', type)?.key).toBe('events-faq');
        expect(headingFieldOf('events-where_heading', type)?.key).toBe('events-where');
    });

    it('is null for a field whose rows have no heading, or any other key', () => {
        expect(headingFieldOf('cards_heading', type)).toBeNull();
        expect(headingFieldOf('price_heading', type)).toBeNull();
        expect(headingFieldOf('faq', type)).toBeNull();
    });
});

describe('rowSubField', () => {
    it('names a row value itself as exact', () => {
        expect(rowSubField(REPEATER_SCHEMAS['faq'], 'question')).toEqual({ sub: expect.objectContaining({ key: 'question' }), exact: true });
    });

    it('points a value the site works out at what is stored', () => {
        expect(rowSubField(REPEATER_SCHEMAS['faq'], 'answer_html')?.sub.key).toBe('answer');
        expect(rowSubField(REPEATER_SCHEMAS['gallery'], 'video_thumb')?.sub.key).toBe('image');
        expect(rowSubField(REPEATER_SCHEMAS['infocard'], 'icon')?.sub.key).toBe('image');
        expect(rowSubField(REPEATER_SCHEMAS['maplocation'], 'map_directions')?.sub.key).toBe('address');
        expect(rowSubField(REPEATER_SCHEMAS['maplocation'], 'lat')?.exact).toBe(false);
    });

    it('is null for a value no row holds', () => {
        expect(rowSubField(REPEATER_SCHEMAS['faq'], 'title')).toBeNull();
    });
});

describe('rowEditing', () => {
    it('keeps a row\'s empty text and its picture, not its icon or video', () => {
        const cards = rowEditing('cards', type)!;
        expect(cards.keepEmpty('headline', {})).toBe(true);
        expect(cards.keepEmpty('image', { image: '', icon: null })).toBe(true);
        expect(cards.keepEmpty('icon', {})).toBe(false);
        expect(rowEditing('media', type)!.keepEmpty('video_thumb', {})).toBe(false);
    });

    it('keeps no empty picture on a row that shows an icon or a video instead', () => {
        expect(rowEditing('cards', type)!.keepEmpty('image', { image: '', icon: { name: 'star' } })).toBe(false);
        expect(rowEditing('media', type)!.keepEmpty('image', { image: '', video: 'https://youtu.be/x' })).toBe(false);
    });

    it('keeps a value worked out from a row\'s text, so a blank answer has a place', () => {
        expect(rowEditing('faq', type)!.keepEmpty('answer_html', {})).toBe(true);
        expect(rowEditing('faq', type)!.keepEmpty('title', {})).toBe(false);
    });

    it('is null for a loop that is not a repeating field', () => {
        expect(rowEditing('items', type)).toBeNull();
        expect(rowEditing('price', type)).toBeNull();
    });
});

describe('withoutBlankRows', () => {
    it('drops blank rows from repeating fields only, as a save does (VE-D33)', () => {
        const entry = { title: 'T', customFields: {
            'events-faq': [{ id: 'a', position: 1, question: 'Q', answer: 'A' }, { id: 'b', position: 2, question: '', answer: '' }],
            'events-price': '10',
        } };
        const out = withoutBlankRows(entry, type);
        expect(out.customFields['events-faq'].map((r: { id: string }) => r.id)).toEqual(['a']);
        expect(out.customFields['events-price']).toBe('10');
        expect(entry.customFields['events-faq']).toHaveLength(2);
    });

    it('gives back the same entry when there is nothing to drop', () => {
        const entry = { customFields: { 'events-faq': [{ id: 'a', position: 1, question: 'Q' }] } };
        expect(withoutBlankRows(entry, type)).toBe(entry);
        expect(withoutBlankRows(entry, null)).toBe(entry);
    });
});
