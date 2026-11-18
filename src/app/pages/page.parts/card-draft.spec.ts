import { describe, it, expect } from 'vitest';
import { cardsWithDraft } from './card-draft';

const entry = (id: string, day: number, extra: Record<string, unknown> = {}) => ({ id, publishedOn: `2026-01-${String(day).padStart(2, '0')}T00:00:00Z`, ...extra });

describe('cardsWithDraft (VE2.2)', () => {
    const published = [entry('a', 3), entry('b', 2), entry('c', 1)];

    it('without a draft, the published cards in order', () => {
        expect(cardsWithDraft(published, null, 'newest', 2)).toEqual({ cards: [published[0], published[1]], draftIndex: -1, tookLastPlace: false });
    });

    it('swaps the draft in for its published copy, in its place', () => {
        const draft = entry('b', 2, { title: 'Edited' });
        const shown = cardsWithDraft(published, draft, 'newest', 3);
        expect(shown.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
        expect(shown.cards[1]).toBe(draft);
        expect(shown.draftIndex).toBe(1);
        expect(shown.tookLastPlace).toBe(false);
    });

    it('adds a draft never published where the type\'s order puts it', () => {
        const draft = entry('new', 9);
        expect(cardsWithDraft(published, draft, 'newest', 4).cards.map((c) => c.id)).toEqual(['new', 'a', 'b', 'c']);
        // In an arranged order, an unnumbered entry goes after the numbered ones.
        const arranged = [entry('a', 3, { sortOrder: 1 }), entry('b', 2, { sortOrder: 2 })];
        expect(cardsWithDraft(arranged, draft, 'manual', 4).cards.map((c) => c.id)).toEqual(['a', 'b', 'new']);
    });

    it('takes the last card\'s place when the block\'s count would leave it out', () => {
        const draft = entry('old', 0, { sortOrder: 9 });
        const arranged = [entry('a', 3, { sortOrder: 1 }), entry('b', 2, { sortOrder: 2 }), entry('c', 1, { sortOrder: 3 })];
        const shown = cardsWithDraft(arranged, draft, 'manual', 2);
        expect(shown.cards.map((c) => c.id)).toEqual(['a', 'old']);
        expect(shown.draftIndex).toBe(1);
        expect(shown.tookLastPlace).toBe(true);
    });

    it('a block of one card shows the draft', () => {
        const shown = cardsWithDraft(published, entry('z', 0), 'newest', 1);
        expect(shown.cards.map((c) => c.id)).toEqual(['z']);
        expect(shown.tookLastPlace).toBe(true);
    });
});
