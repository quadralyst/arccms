import { describe, it, expect } from 'vitest';
import { buildMappedNode, minutesToDuration, normalizeContentTypeSchema } from '../shared/schema-mapping.js';

const ARTICLE = {
    url: 'https://x.com/products/widget',
    headline: 'Widget',
    description: 'A fine widget.',
    imageUrl: 'https://x.com/w.jpg',
    datePublished: '2024-01-15T00:00:00.000Z',
    inLanguage: 'en',
};

describe('normalizeContentTypeSchema (D-D12)', () => {
    it('defaults to Article and drops unknown properties and blank keys', () => {
        expect(normalizeContentTypeSchema(undefined)).toEqual({ type: 'Article', fields: {} });
        expect(normalizeContentTypeSchema({ type: 'Spaceship' })).toEqual({ type: 'Article', fields: {} });
        expect(normalizeContentTypeSchema({ type: 'Product', fields: { price: 'p_price', madeUp: 'x', sku: ' ' } }))
            .toEqual({ type: 'Product', fields: { price: 'p_price' } });
    });
});

describe('buildMappedNode', () => {
    it('builds the Article family with the chosen subtype', () => {
        const node = buildMappedNode({ schema: { type: 'NewsArticle', fields: {} }, customFields: {}, article: ARTICLE })!;
        expect(node['@type']).toBe('NewsArticle');
        expect(node['headline']).toBe('Widget');
        expect(buildMappedNode({ schema: undefined, customFields: {}, article: ARTICLE })!['@type']).toBe('Article');
    });

    it('builds a Product with an Offer from mapped fields, brand from the owner when unmapped', () => {
        const node = buildMappedNode({
            schema: { type: 'Product', fields: { price: 'p_price', priceCurrency: 'p_cur', availability: 'p_avail', sku: 'p_sku' } },
            customFields: { p_price: '1,299', p_cur: 'inr', p_avail: 'In stock', p_sku: 'W-1' },
            article: ARTICLE,
            ownerName: 'Acme',
        })!;
        expect(node['@type']).toBe('Product');
        expect(node['name']).toBe('Widget');
        expect(node['sku']).toBe('W-1');
        expect(node['brand']).toEqual({ '@type': 'Brand', name: 'Acme' });
        expect(node['offers']).toEqual({
            '@type': 'Offer', price: 1299, priceCurrency: 'INR', url: 'https://x.com/products/widget',
            availability: 'https://schema.org/InStock',
        });
    });

    it('omits the Offer without both price and currency, and never invents values', () => {
        const node = buildMappedNode({
            schema: { type: 'Product', fields: { price: 'p_price', priceCurrency: 'p_cur' } },
            customFields: { p_price: 10 },
            article: ARTICLE,
        })!;
        expect(node).not.toHaveProperty('offers');
        expect(node).not.toHaveProperty('sku');
        expect(node).not.toHaveProperty('brand');
    });

    it('builds an Event with dates, a Place, a status and the organizer', () => {
        const node = buildMappedNode({
            schema: { type: 'Event', fields: { startDate: 'e_start', endDate: 'e_end', locationName: 'e_venue', locationAddress: 'e_addr', eventStatus: 'e_status', price: 'e_price', priceCurrency: 'e_cur', ticketUrl: 'e_url' } },
            customFields: {
                e_start: { seconds: 1735689600 }, e_end: '2025-01-02', e_venue: 'Town Hall', e_addr: 'Pune',
                e_status: 'Cancelled', e_price: 0, e_cur: 'INR', e_url: 'https://tickets.example',
            },
            article: ARTICLE,
            publisherId: 'https://x.com/#organization',
        })!;
        expect(node['@type']).toBe('Event');
        expect(node['startDate']).toBe('2025-01-01T00:00:00.000Z');
        expect(node['endDate']).toBe('2025-01-02T00:00:00.000Z');
        expect(node['location']).toEqual({ '@type': 'Place', name: 'Town Hall', address: 'Pune' });
        expect(node['eventStatus']).toBe('https://schema.org/EventCancelled');
        expect(node['organizer']).toEqual({ '@id': 'https://x.com/#organization' });
        expect(node['offers']).toEqual({ '@type': 'Offer', price: 0, priceCurrency: 'INR', url: 'https://tickets.example' });
    });

    it('builds a Service with provider and a Person with worksFor', () => {
        const service = buildMappedNode({
            schema: { type: 'Service', fields: { serviceType: 's_type', areaServed: 's_area' } },
            customFields: { s_type: 'Web design', s_area: 'India' },
            article: ARTICLE, publisherId: 'https://x.com/#organization',
        })!;
        expect(service['serviceType']).toBe('Web design');
        expect(service['provider']).toEqual({ '@id': 'https://x.com/#organization' });

        const person = buildMappedNode({
            schema: { type: 'Person', fields: { jobTitle: 'p_job', affiliation: 'p_org', url: 'p_url' } },
            customFields: { p_job: 'Founder', p_org: 'Acme', p_url: 'https://jane.dev' },
            article: { ...ARTICLE, headline: 'Jane Doe' },
        })!;
        expect(person['@type']).toBe('Person');
        expect(person['name']).toBe('Jane Doe');
        expect(person['jobTitle']).toBe('Founder');
        expect(person['worksFor']).toEqual({ '@type': 'Organization', name: 'Acme' });
        expect(person['url']).toBe('https://jane.dev');
        expect(person['@id']).toBe(ARTICLE.url);
    });

    it('builds a Recipe with durations, ingredient lines and steps from the how-to block', () => {
        const node = buildMappedNode({
            schema: { type: 'Recipe', fields: { prepTime: 'r_prep', cookTime: 'r_cook', recipeYield: 'r_yield', recipeIngredient: 'r_ing' } },
            customFields: { r_prep: '15', r_cook: 75, r_yield: '4 servings', r_ing: '<ul><li>2 eggs</li><li>Salt</li></ul>' },
            article: { ...ARTICLE, author: { name: 'Jane' } },
            howTo: { name: 'Method', steps: [{ text: 'Beat.' }, { text: 'Fry.' }] },
        })!;
        expect(node['prepTime']).toBe('PT15M');
        expect(node['cookTime']).toBe('PT1H15M');
        expect(node['totalTime']).toBe('PT1H30M');
        expect(node['recipeIngredient']).toEqual(['2 eggs', 'Salt']);
        expect(node['recipeInstructions']).toEqual([{ '@type': 'HowToStep', text: 'Beat.' }, { '@type': 'HowToStep', text: 'Fry.' }]);
        expect(node['author']).toEqual({ '@type': 'Person', name: 'Jane' });
    });

    it('makes the page a HowTo only when the body has a how-to block', () => {
        const withBlock = buildMappedNode({
            schema: { type: 'HowTo', fields: { totalTime: 'h_time', estimatedCost: 'h_cost', priceCurrency: 'h_cur' } },
            customFields: { h_time: 30, h_cost: 500, h_cur: 'INR' },
            article: ARTICLE,
            howTo: { name: 'How to fix it', steps: [{ name: 'Open', text: 'Open. Then look.' }] },
        })!;
        expect(withBlock['@type']).toBe('HowTo');
        expect(withBlock['name']).toBe('How to fix it');
        expect((withBlock['step'] as any[])[0]).toEqual({ '@type': 'HowToStep', position: 1, text: 'Open. Then look.', url: 'https://x.com/products/widget#step-1', name: 'Open' });
        expect(withBlock['totalTime']).toBe('PT30M');
        expect(withBlock['estimatedCost']).toEqual({ '@type': 'MonetaryAmount', currency: 'INR', value: 500 });

        const without = buildMappedNode({ schema: { type: 'HowTo', fields: {} }, customFields: {}, article: ARTICLE })!;
        expect(without['@type']).toBe('Article');
    });

    it('minutesToDuration', () => {
        expect(minutesToDuration(0)).toBeUndefined();
        expect(minutesToDuration(45)).toBe('PT45M');
        expect(minutesToDuration(120)).toBe('PT2H');
        expect(minutesToDuration(undefined)).toBeUndefined();
    });
});
