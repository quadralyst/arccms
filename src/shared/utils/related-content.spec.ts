import { describe, it, expect } from 'vitest';
import { pickRelated, relatedQuery } from './related-content';

const hit = (title: string, contentType: string, urlSlug: string) => ({
    source: 'content', docId: urlSlug, lang: 'en', title, snippet: '', badge: 'Articles',
    link: `/${contentType}/${urlSlug}`, meta: { contentType, urlSlug }, score: 1, highlights: { title: [], snippet: [] },
});

describe('related-content (client mirror)', () => {
    it('builds a query from title words and tags', () => {
        expect(relatedQuery('The Future of AI in Decision-Making!', ['ai', 'decisions'])).toBe('the future decision making decisions');
        expect(relatedQuery('', [])).toBe('');
    });

    it('drops the item itself and caps the list', () => {
        const items = pickRelated([hit('Self', 'a', 'self'), hit('B', 'a', 'b'), hit('C', 'a', 'c'), hit('D', 'a', 'd'), hit('E', 'a', 'e'), hit('F', 'a', 'f')], { contentType: 'a', urlSlug: 'self' });
        expect(items.map(i => i.title)).toEqual(['B', 'C', 'D', 'E']);
    });
});
