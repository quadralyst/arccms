/** The page's cards in the Visual Editor's frame (page-cards.ts, specs/visual-editing-spec.md VE-D53, VE-D54). */
import { describe, it, expect } from 'vitest';
import { isPageChange, pageCardsOf, parsePageCardsMessage } from './page-cards';

describe('pageCardsOf', () => {
    const drafts = [
        { id: 'edited', status: 'draft', publishedStatus: true, title: 'Edited', publishedOn: '2026-01-02T00:00:00Z', sortOrder: 2 },
        { id: 'live', status: 'publish', publishedStatus: true, title: 'Live', sortOrder: 1 },
        { id: 'added', status: 'draft', publishedStatus: false, addedOnPage: 'home', title: 'New', createdAt: '2026-01-05T00:00:00Z' },
        { id: 'other-page', status: 'draft', publishedStatus: false, addedOnPage: 'p-about', title: 'Elsewhere' },
        { id: 'removed', status: 'draft', publishedStatus: false, title: 'Taken off' },
        // Added here, published elsewhere, then unpublished on purpose: it keeps addedOnPage.
        { id: 'unpublished', status: 'draft', publishedStatus: false, addedOnPage: 'home', lastPublishedAt: '2026-01-03T00:00:00Z', publishedOn: '2026-01-02T00:00:00Z', title: 'Off on purpose' },
    ];

    it('counts a changed published entry and a card added on this page as changes, drawn published-looking', () => {
        const cards = pageCardsOf(drafts, 'home');
        expect(cards.changed.map((c) => c['id'])).toEqual(['edited', 'added']);
        const added = cards.changed.find((c) => c['id'] === 'added')!;
        expect(added['publishedStatus']).toBe(true);
        // Never published: it sorts where a publish now would put it.
        expect(added['publishedOn']).toBe('2026-01-05T00:00:00Z');
    });

    it('hides a draft taken off the site and one added on another page, and keeps every place in the order', () => {
        const cards = pageCardsOf(drafts, 'home');
        expect([...cards.hidden].sort()).toEqual(['other-page', 'removed', 'unpublished']);
        expect(cards.sortOrder).toEqual({ edited: 2, live: 1 });
    });
});

describe('isPageChange', () => {
    it('takes an edited published entry and a card added here never published, nothing else', () => {
        expect(isPageChange({ status: 'draft', publishedStatus: true }, 'home')).toBe(true);
        expect(isPageChange({ status: 'draft', publishedStatus: false, addedOnPage: 'home' }, 'home')).toBe(true);
        expect(isPageChange({ status: 'publish', publishedStatus: true }, 'home')).toBe(false);
        expect(isPageChange({ status: 'draft', publishedStatus: false, addedOnPage: 'home', lastPublishedAt: '2026-01-01' }, 'home')).toBe(false);
        expect(isPageChange({ status: 'draft', publishedStatus: false, addedOnPage: 'home', publishedOn: '2026-01-01' }, 'home')).toBe(false);
        expect(isPageChange({ status: 'draft', publishedStatus: false }, 'home')).toBe(false);
    });
});

describe('parsePageCardsMessage', () => {
    it('reads a focus, none, and a hold', () => {
        expect(parsePageCardsMessage({ arcPageCards: 'focus', focus: { type: 'quotes', id: 'a' } })).toEqual({ arcPageCards: 'focus', focus: { type: 'quotes', id: 'a' } });
        expect(parsePageCardsMessage({ arcPageCards: 'focus', focus: null })).toEqual({ arcPageCards: 'focus', focus: null });
        expect(parsePageCardsMessage({ arcPageCards: 'hold', on: true })).toEqual({ arcPageCards: 'hold', on: true });
        expect(parsePageCardsMessage({ arcPageCards: 'reorder', type: 'quotes' })).toEqual({ arcPageCards: 'reorder', type: 'quotes' });
    });

    it('ignores anything else', () => {
        for (const bad of [null, 'x', {}, { arcPageCards: 'focus' }, { arcPageCards: 'focus', focus: { type: '', id: 'a' } },
            { arcPageCards: 'focus', focus: { type: 'q', id: 3 } }, { arcPageCards: 'hold', on: 'yes' }, { arcPageCards: 'other' }, { arcPageCards: 'reorder', type: '' },
            { arcPageCards: 'focus', focus: { type: 'q'.repeat(101), id: 'a' } }]) {
            expect(parsePageCardsMessage(bad)).toBeNull();
        }
    });
});
