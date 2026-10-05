/**
 * The app and publishing build the same card (B4/B7 in
 * specs/website-docs-review.md): this file is the source and
 * functions/src/shared/content-cards.ts its mirror.
 */
import { describe, it, expect } from 'vitest';
import { cardData, getExcerpt } from './content-cards';
import * as published from '../../../../functions/src/shared/content-cards';

const ENTRY = {
    id: 'e1',
    title: 'Spring fair',
    urlSlug: 'spring-fair',
    content: `<p>${'word '.repeat(300)}</p>`,
    publishedOn: { seconds: 1767600000 },
    authorName: 'Asha Rao',
    tags: ['Food', 'Music', 'Kids', 'Late'],
    tagsWithColors: [{ name: 'Food', color: '#f00' }],
    customFields: { 'events-price': '25' },
};

describe('content cards', () => {
    it.each([
        ['the default language', ENTRY, 'en', ''],
        ['a translated page', { ...ENTRY, metaDescription: 'मेला' }, 'hi', '/hi'],
        ['an entry with almost nothing', { id: 'e2', urlSlug: 'x' }, 'en', ''],
    ])('match the published card on %s', (_label, entry, lang, prefix) => {
        expect(cardData(entry, 'events', 'Events', lang, prefix)).toEqual(published.cardData(entry, 'events', 'Events', lang, prefix));
        expect(getExcerpt(entry)).toBe(published.getExcerpt(entry));
    });

    it('link and date in the page\'s language', () => {
        const card = cardData(ENTRY, 'events', 'कार्यक्रम', 'hi', '/hi');
        expect(card['url']).toBe('/hi/events/spring-fair');
        expect(card['contentType']).toBe('कार्यक्रम');
        expect(card['publishedOn']).toContain('2026');
        expect(card['publishedOn']).not.toBe(cardData(ENTRY, 'events', 'Events', 'en', '')['publishedOn']);
    });

    it('make the excerpt from the meta description, else the body, without markup, cut at 25 words', () => {
        expect(getExcerpt({ metaDescription: 'The meta', content: '<p>Body</p>' })).toBe('The meta');
        expect(getExcerpt({ content: '<p>This is a <b>test</b> content</p>' })).toBe('This is a test content');
        const long = getExcerpt({ content: 'word '.repeat(50) });
        expect(long.endsWith('...')).toBe(true);
        expect(long.split(' ')).toHaveLength(25);
    });

    it('keep a stored read time, else count it, and print no date for none', () => {
        expect(cardData({ readTime: 5, content: 'Short' }, 't', 'T', 'en', '')['readTime']).toBe(5);
        expect(cardData({ content: 'word '.repeat(400) }, 't', 'T', 'en', '')['readTime']).toBeGreaterThan(1);
        expect(cardData({}, 't', 'T', 'en', '')['publishedOn']).toBe('');
    });
});
