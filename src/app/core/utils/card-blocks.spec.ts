/**
 * The app copy of cardBlockTypes runs the same cases as the publish pipeline's
 * (functions/src/pages/card-blocks.ts), and wherePreviewed (VE-D10, VE2.1).
 */
import { describe, it, expect, vi } from 'vitest';
import { cardBlockTypes, cardPlaces, wherePreviewed } from './card-blocks';

vi.mock('../../../../functions/src/init.js', () => ({ db: {} }));
import { cardBlockTypes as publishCardBlockTypes } from '../../../../functions/src/pages/card-blocks';

const CASES: [string, string[]][] = [
    ['<arc-content-partials content-type="news" count="3"></arc-content-partials>', ['news']],
    [`<arc-content-partials count="2" content-type='team'></arc-content-partials><ARC-CONTENT-PARTIALS CONTENT-TYPE="faq">`, ['team', 'faq']],
    ['<!-- <arc-content-partials content-type="hidden"></arc-content-partials> -->', []],
    ['<arc-content-partials content-type=" spaced "></arc-content-partials><arc-content-partials content-type="spaced">', ['spaced']],
    ['<arc-content-partialsx content-type="no">', []],
    ['', []],
];

describe('cardBlockTypes', () => {
    for (const [html, types] of CASES) {
        it(`${JSON.stringify(html).slice(0, 60)}: ${types.join(', ') || 'none'}, as when published`, () => {
            expect(cardBlockTypes(html)).toEqual(types);
            expect(cardBlockTypes(html)).toEqual(publishCardBlockTypes(html));
        });
    }
});

describe('wherePreviewed (VE-D10)', () => {
    const block = (type: string) => `<arc-content-partials content-type="${type}"></arc-content-partials>`;

    it('the home page when it has a block for the type', () => {
        const places = cardPlaces('hero', block('hero'), block('hero'), '');
        expect(places).toEqual({ home: true, everyPage: true });
        expect(wherePreviewed(places)).toBe('home');
    });

    it('a page with the header or footer when only they have one', () => {
        expect(wherePreviewed(cardPlaces('partners', block('news'), '', block('partners')))).toBe('every-page');
        expect(wherePreviewed(cardPlaces('partners', '', block('partners'), ''))).toBe('every-page');
    });

    it('the cards alone when no page shows the type', () => {
        expect(wherePreviewed(cardPlaces('quotes', block('news'), '', ''))).toBe('cards');
    });
});
