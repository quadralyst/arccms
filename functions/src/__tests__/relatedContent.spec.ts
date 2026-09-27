import { describe, it, expect } from 'vitest';
import { pickRelated, relatedQuery } from '../shared/related-content.js';

const hit = (title: string, contentType: string, urlSlug: string) => ({
    source: 'content', docId: urlSlug, lang: 'en', title, snippet: `${title} snippet`, badge: 'Articles',
    link: `/${contentType}/${urlSlug}`, meta: { contentType, urlSlug }, score: 1, highlights: { title: [], snippet: [] },
});

describe('related content (D-D15)', () => {
    it('builds the query from title words and tags, de-duplicated and capped', () => {
        expect(relatedQuery('The Future of AI in Decision-Making', ['ai', 'decisions'])).toBe('future ai decision making decisions');
        expect(relatedQuery('', [])).toBe('');
        expect(relatedQuery('x'.repeat(300), []).length).toBeLessThanOrEqual(120);
    });

    it('drops the item itself and keeps the top few', () => {
        const items = pickRelated(
            [hit('Self', 'articles', 'self'), hit('A', 'articles', 'a'), hit('B', 'manuals', 'b'), hit('C', 'articles', 'c'), hit('D', 'articles', 'd'), hit('E', 'articles', 'e')],
            { contentType: 'articles', urlSlug: 'self' },
        );
        expect(items.map(i => i.title)).toEqual(['A', 'B', 'C', 'D']);
        expect(items[1]).toEqual({ title: 'B', snippet: 'B snippet', url: '/manuals/b', badge: 'Articles' });
    });
});
