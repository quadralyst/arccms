/** The checks and moves of the page's cards (page-card-actions.ts, specs/visual-editing-spec.md VE-D53, VE-D54). */
import { describe, it, expect } from 'vitest';
import { cardHasReplace, cardProblem, movedBeside, placeAfter, sameTime } from './page-card-actions';
import type { ContentType } from '../contents/content-types/content-types.model';

const quotes = { slug: 'quotes', name: 'Quotes', hasPublicUrl: false, fields: [{ key: 'person', label: 'Person', type: 'text', required: true }] } as unknown as ContentType;
const posts = { slug: 'posts', name: 'Posts', fields: [] } as unknown as ContentType;

describe('cardProblem', () => {
    it('passes a card with its title and required fields', () => {
        expect(cardProblem({ title: 'Kind words', customFields: { person: 'Asha' } }, quotes)).toBeNull();
    });

    it('names the title, then the first empty required field, as the entry editor checks', () => {
        expect(cardProblem({ title: '  ', customFields: { person: 'Asha' } }, quotes)).toEqual({ field: 'title', kind: 'required' });
        expect(cardProblem({ title: 'Kind words', customFields: {} }, quotes)).toEqual({ field: 'person', kind: 'required' });
    });

    it('asks a type with pages for an address', () => {
        expect(cardProblem({ title: 'A post', urlSlug: '' }, posts)).toEqual({ field: 'urlSlug', kind: 'address' });
        expect(cardProblem({ title: 'A post', urlSlug: 'a-post' }, posts)).toBeNull();
    });
});

describe('cardHasReplace', () => {
    it('finds text still to replace anywhere in the card', () => {
        expect(cardHasReplace({ id: 'x', title: '[Replace: new quote]' })).toBe(true);
        expect(cardHasReplace({ id: 'x', title: 'Done', customFields: { person: '[Replace: name]' } })).toBe(true);
        expect(cardHasReplace({ id: 'x', title: 'Done' })).toBe(false);
    });
});

describe('movedBeside', () => {
    const ids = ['a', 'b', 'c', 'd'];
    it('puts a card before or after its neighbour, the rest in their order', () => {
        expect(movedBeside(ids, 'c', 'b', false)).toEqual(['a', 'c', 'b', 'd']);
        expect(movedBeside(ids, 'b', 'c', true)).toEqual(['a', 'c', 'b', 'd']);
        expect(movedBeside(ids, 'a', 'd', true)).toEqual(['b', 'c', 'd', 'a']);
    });

    it('changes nothing for an unknown card or neighbour', () => {
        expect(movedBeside(ids, 'x', 'b', false)).toEqual(ids);
        expect(movedBeside(ids, 'a', 'x', true)).toEqual(ids);
        expect(movedBeside(ids, 'a', 'a', true)).toEqual(ids);
    });
});

describe('placeAfter and sameTime', () => {
    const entries = [{ id: 'a', sortOrder: 1 }, { id: 'b', sortOrder: 2 }, { id: 'c', sortOrder: 4 }];
    it('places a new card right after the one whose Add was pressed, else last', () => {
        expect(placeAfter(entries, 'a')).toBe(1.5);
        expect(placeAfter(entries, 'b')).toBe(3);
        expect(placeAfter(entries, 'c')).toBe(5);
        expect(placeAfter(entries, 'gone')).toBe(5);
        expect(placeAfter(entries)).toBe(5);
    });
    it('compares stored times of any kind', () => {
        expect(sameTime({ toMillis: () => 5 }, new Date(5))).toBe(true);
        expect(sameTime(5, { toMillis: () => 6 })).toBe(false);
        expect(sameTime(undefined, null)).toBe(true);
    });
});
