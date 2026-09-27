import { describe, it, expect } from 'vitest';
import { buildMappedNode, normalizeContentTypeSchema } from './schema-mapping';

const ARTICLE = { url: 'https://x.com/products/widget', headline: 'Widget', description: 'A fine widget.' };

describe('schema-mapping (client mirror, D-D12)', () => {
    it('normalises like the server', () => {
        expect(normalizeContentTypeSchema({ type: 'Product', fields: { price: 'p', junk: 'j' } })).toEqual({ type: 'Product', fields: { price: 'p' } });
        expect(normalizeContentTypeSchema(null).type).toBe('Article');
    });

    it('builds a Product with an Offer and falls back to Article when unmapped', () => {
        const product = buildMappedNode({
            schema: { type: 'Product', fields: { price: 'p_price', priceCurrency: 'p_cur' } },
            customFields: { p_price: 99, p_cur: 'usd' },
            article: ARTICLE, ownerName: 'Acme',
        })!;
        expect(product['@type']).toBe('Product');
        expect(product['offers']).toEqual({ '@type': 'Offer', price: 99, priceCurrency: 'USD', url: ARTICLE.url });
        expect(buildMappedNode({ schema: undefined, customFields: {}, article: ARTICLE })!['@type']).toBe('Article');
    });

    it('builds an Event with a Place and a Recipe with steps from the how-to block', () => {
        const event = buildMappedNode({
            schema: { type: 'Event', fields: { startDate: 'e_start', locationName: 'e_venue' } },
            customFields: { e_start: '2025-01-01', e_venue: 'Hall' },
            article: ARTICLE,
        })!;
        expect(event['startDate']).toBe('2025-01-01T00:00:00.000Z');
        expect(event['location']).toEqual({ '@type': 'Place', name: 'Hall' });

        const recipe = buildMappedNode({
            schema: { type: 'Recipe', fields: { recipeIngredient: 'r_ing', prepTime: 'r_prep' } },
            customFields: { r_ing: 'Eggs\nSalt', r_prep: 10 },
            article: ARTICLE,
            howTo: { name: 'Method', steps: [{ text: 'Beat.' }] },
        })!;
        expect(recipe['recipeIngredient']).toEqual(['Eggs', 'Salt']);
        expect(recipe['prepTime']).toBe('PT10M');
        expect(recipe['recipeInstructions']).toEqual([{ '@type': 'HowToStep', text: 'Beat.' }]);
    });
});
