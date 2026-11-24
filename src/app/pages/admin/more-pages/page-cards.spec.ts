/** The page's cards in the Visual Editor's frame (page-cards.ts, specs/visual-editing-spec.md VE-D53, VE-D54). */
import { describe, it, expect } from 'vitest';
import { cardState, isPageChange, pageCardsOf, parsePageCardsMessage } from './page-cards';

describe('pageCardsOf', () => {
    const drafts = [
        { id: 'edited', status: 'draft', publishedStatus: true, changedOnPage: 'home', title: 'Edited', publishedOn: '2026-01-02T00:00:00Z', sortOrder: 2 },
        { id: 'live', status: 'publish', publishedStatus: true, title: 'Live', sortOrder: 1 },
        { id: 'added', status: 'draft', publishedStatus: false, addedOnPage: 'home', title: 'New', createdAt: '2026-01-05T00:00:00Z' },
        { id: 'other-page', status: 'draft', publishedStatus: false, addedOnPage: 'p-about', title: 'Elsewhere' },
        { id: 'removed', status: 'draft', publishedStatus: false, title: 'Taken off' },
        // Added here, published elsewhere, then unpublished on purpose: it keeps addedOnPage.
        { id: 'unpublished', status: 'draft', publishedStatus: false, addedOnPage: 'home', lastPublishedAt: '2026-01-03T00:00:00Z', publishedOn: '2026-01-02T00:00:00Z', title: 'Off on purpose' },
    ];

    it('counts a changed published entry and a card added on this page as changes, drawn published-looking', () => {
        const cards = pageCardsOf(drafts, 'home', { uid: 'me' });
        expect(cards.changed.map((c) => c['id'])).toEqual(['edited', 'added']);
        const added = cards.changed.find((c) => c['id'] === 'added')!;
        expect(added['publishedStatus']).toBe(true);
        // Never published: it sorts where a publish now would put it.
        expect(added['publishedOn']).toBe('2026-01-05T00:00:00Z');
    });

    it('hides a draft taken off the site and one added on another page, and keeps every place in the order', () => {
        const cards = pageCardsOf(drafts, 'home', { uid: 'me' });
        expect([...cards.hidden].sort()).toEqual(['other-page', 'removed', 'unpublished']);
        expect(cards.sortOrder).toEqual({ edited: 2, live: 1 });
    });
});

describe('cardState, which cards Publish takes (VE-D72)', () => {
    const live = { status: 'draft', publishedStatus: true };
    const by = (uid: string) => ({ editing: { by: uid, name: uid === 'me' ? 'Me' : 'Priya' } });
    const at = (draft: Record<string, any>, shows?: string) => cardState(draft, 'home', { uid: 'me', shows });

    it('takes a card changed on this page, and one added here never published, by this person', () => {
        expect(at({ ...live, changedOnPage: 'home' })).toBe('mine');
        expect(at({ ...live, changedOnPage: 'home', ...by('me') })).toBe('mine');
        expect(at({ status: 'draft', publishedStatus: false, addedOnPage: 'home', ...by('me') })).toBe('mine');
        expect(isPageChange({ ...live, changedOnPage: 'home' }, 'home', 'me')).toBe(true);
    });

    it('leaves out a colleague\'s unfinished draft, changed here or elsewhere', () => {
        expect(at({ ...live, changedOnPage: 'home', ...by('priya') })).toBe('held');
        expect(at({ ...live, ...by('priya') })).toBe('held');
        expect(isPageChange({ ...live, changedOnPage: 'home', ...by('priya') }, 'home', 'me')).toBe(false);
        expect(at({ status: 'draft', publishedStatus: false, addedOnPage: 'home', ...by('priya') })).toBe('hidden');
    });

    it('leaves out this person\'s own work from elsewhere, and from another page', () => {
        expect(at({ ...live, ...by('me') })).toBe('elsewhere');
        expect(at({ ...live, changedOnPage: 'p-about', ...by('me') })).toBe('elsewhere');
        // From before the hold existed.
        expect(at(live)).toBe('elsewhere');
    });

    it('shows a page being looked at as its holder left it', () => {
        expect(at({ ...live, changedOnPage: 'home', ...by('priya') }, 'priya')).toBe('theirs');
        expect(at({ ...live, changedOnPage: 'home', ...by('ravi') }, 'priya')).toBe('held');
        const cards = pageCardsOf([{ id: 'a', ...live, changedOnPage: 'home', ...by('priya') }, { id: 'b', ...live, ...by('me') }], 'home', { uid: 'me', shows: 'priya' });
        expect(cards.changed.map((c) => c['id'])).toEqual(['a']);
        expect(cards.notes).toEqual({ a: { theirs: true }, b: { elsewhere: true } });
    });

    it('is nothing once published, and hidden off the site', () => {
        expect(at({ status: 'publish', publishedStatus: true })).toBeNull();
        expect(at({ status: 'draft', publishedStatus: false })).toBe('hidden');
        expect(at({ status: 'draft', publishedStatus: false, addedOnPage: 'home', lastPublishedAt: '2026-01-01' })).toBe('hidden');
        expect(at({ status: 'draft', publishedStatus: false, addedOnPage: 'home', publishedOn: '2026-01-01' })).toBe('hidden');
    });
});

describe('parsePageCardsMessage', () => {
    it('reads a focus, none, and a hold', () => {
        expect(parsePageCardsMessage({ arcPageCards: 'focus', focus: { type: 'quotes', id: 'a' } })).toEqual({ arcPageCards: 'focus', focus: { type: 'quotes', id: 'a' } });
        expect(parsePageCardsMessage({ arcPageCards: 'focus', focus: null })).toEqual({ arcPageCards: 'focus', focus: null });
        expect(parsePageCardsMessage({ arcPageCards: 'hold', on: true })).toEqual({ arcPageCards: 'hold', on: true });
        expect(parsePageCardsMessage({ arcPageCards: 'reorder', type: 'quotes' })).toEqual({ arcPageCards: 'reorder', type: 'quotes' });
        expect(parsePageCardsMessage({ arcPageCards: 'shows', uid: 'u1' })).toEqual({ arcPageCards: 'shows', uid: 'u1' });
        expect(parsePageCardsMessage({ arcPageCards: 'shows', uid: null })).toEqual({ arcPageCards: 'shows', uid: null });
        expect(parsePageCardsMessage({ arcPageCards: 'shows', uid: 5 })).toBeNull();
    });

    it('ignores anything else', () => {
        for (const bad of [null, 'x', {}, { arcPageCards: 'focus' }, { arcPageCards: 'focus', focus: { type: '', id: 'a' } },
            { arcPageCards: 'focus', focus: { type: 'q', id: 3 } }, { arcPageCards: 'hold', on: 'yes' }, { arcPageCards: 'other' }, { arcPageCards: 'reorder', type: '' },
            { arcPageCards: 'focus', focus: { type: 'q'.repeat(101), id: 'a' } }]) {
            expect(parsePageCardsMessage(bad)).toBeNull();
        }
    });
});
