import { describe, it, expect } from 'vitest';
import { cardsWithDraft, cardsWithDrafts, type PageCardsOfType } from './card-draft';

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

    it('keeps its live copy\'s date and place, whatever its draft says', () => {
        const shown = cardsWithDraft(published, entry('a', 1, { title: 'Edited' }), 'newest', 3);
        expect(shown.cards.map((c) => c.id)).toEqual(['a', 'b', 'c']);
        expect(shown.cards[0]).toEqual(entry('a', 3, { title: 'Edited' }));
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

describe('cardsWithDrafts (VE-D53, VE-D54)', () => {
    const published = [entry('a', 3), entry('b', 2), entry('c', 1)];
    const page = (over: Partial<PageCardsOfType<Record<string, any>>> = {}): PageCardsOfType<Record<string, any>> =>
        ({ changed: [], hidden: new Set(), sortOrder: {}, focus: null, ...over });
    const ids = (cards: Record<string, any>[]) => cards.map((card) => card['id']);

    it('without drafts, the published cards, none leaving', () => {
        const shown = cardsWithDrafts(published, page(), 'newest', 2);
        expect(ids(shown.cards)).toEqual(['a', 'b']);
        expect(shown.leaving).toEqual([]);
        expect(shown.changedIds.size).toBe(0);
    });

    it('a changed card, the one being edited and one being published keep their live date and place', () => {
        const older = (id: string) => entry(id, 1, { title: 'Edited' });
        for (const over of [{ changed: [older('a')] }, { focus: older('a') }, { publishing: [older('a')] }]) {
            const shown = cardsWithDrafts(published, page(over), 'newest', 3);
            expect(ids(shown.cards)).toEqual(['a', 'b', 'c']);
            expect(shown.cards[0]).toEqual(entry('a', 3, { title: 'Edited' }));
        }
    });

    it('draws a card being published from its draft, as no change any more; one changed again wins', () => {
        const going = entry('b', 2, { title: 'Going' });
        const shown = cardsWithDrafts(published, page({ publishing: [going] }), 'newest', 3);
        expect(shown.cards[1]).toEqual(going);
        expect(shown.changedIds.size).toBe(0);
        // Added on the page, and not on the site yet: it does not vanish meanwhile.
        expect(ids(cardsWithDrafts(published, page({ publishing: [entry('n', 9)] }), 'newest', 3).cards)).toEqual(['n', 'a', 'b']);
        const again = entry('b', 2, { title: 'Again' });
        expect(cardsWithDrafts(published, page({ publishing: [going], changed: [again] }), 'newest', 3).cards[1]).toEqual(again);
    });

    it('draws every changed card from its draft, and says which', () => {
        const shown = cardsWithDrafts(published, page({ changed: [entry('a', 3, { title: 'A2' }), entry('b', 2, { title: 'B2' })] }), 'newest', 3);
        expect(shown.cards.map((card) => card['title'] ?? card['id'])).toEqual(['A2', 'B2', 'c']);
        expect([...shown.changedIds].sort()).toEqual(['a', 'b']);
    });

    it('a new card that fills a full block pushes the last live card out, which is returned as leaving', () => {
        const shown = cardsWithDrafts(published, page({ changed: [entry('n', 9)] }), 'newest', 3);
        expect(ids(shown.cards)).toEqual(['n', 'a', 'b']);
        expect(ids(shown.leaving)).toEqual(['c']);
        expect([...shown.changedIds]).toEqual(['n']);
    });

    it('a card taken off the page is never drawn, and nothing leaves for it', () => {
        const shown = cardsWithDrafts(published, page({ hidden: new Set(['a']) }), 'newest', 2);
        expect(ids(shown.cards)).toEqual(['b', 'c']);
        expect(shown.leaving).toEqual([]);
    });

    it('a move saved in the drafts shows at once in a type\'s own order', () => {
        const ordered = [entry('a', 3, { sortOrder: 1 }), entry('b', 2, { sortOrder: 2 }), entry('c', 1, { sortOrder: 3 })];
        const shown = cardsWithDrafts(ordered, page({ sortOrder: { a: 2, b: 1, c: 3 } }), 'manual', 3);
        expect(ids(shown.cards)).toEqual(['b', 'a', 'c']);
    });

    it('the card being edited follows its form, and takes the last place when the cut leaves it out', () => {
        const typed = cardsWithDrafts(published, page({ focus: entry('b', 2, { title: 'Typing' }) }), 'newest', 2);
        expect(typed.cards[1]['title']).toBe('Typing');
        expect(typed.changedIds.size).toBe(0);
        const cut = cardsWithDrafts(published, page({ focus: entry('c', 1, { title: 'Old' }) }), 'newest', 2);
        expect(ids(cut.cards)).toEqual(['a', 'c']);
        expect(cut.tookLastPlace).toBe(true);
        // Covered for now, not pushed out by Publish.
        expect(cut.leaving).toEqual([]);
    });

    it('a changed card the cut leaves out is not counted as shown', () => {
        const shown = cardsWithDrafts(published, page({ changed: [entry('c', 1, { title: 'C2' })] }), 'newest', 2);
        expect(ids(shown.cards)).toEqual(['a', 'b']);
        expect(shown.changedIds.size).toBe(0);
    });
});
