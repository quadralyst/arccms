import { describe, it, expect } from 'vitest';
import { buildProductNodes } from './product-jsonld';

describe('buildProductNodes (D5, pricing page)', () => {
    it('builds Product + Offer with a subscription price specification and a seller', () => {
        const nodes = buildProductNodes([
            { id: 'gold', name: 'Gold', description: 'All features.', price: 29, currency: 'usd', type: 'subscription', interval: 'month', features: ['Unlimited pages', ''] },
        ], 'https://x.com/pricing', 'https://x.com/#organization');
        expect(nodes).toHaveLength(1);
        const node = nodes[0];
        expect(node['@type']).toBe('Product');
        expect(node['@id']).toBe('https://x.com/pricing#gold');
        expect(node['additionalProperty']).toEqual([{ '@type': 'PropertyValue', name: 'Unlimited pages' }]);
        expect(node['offers']).toEqual(expect.objectContaining({
            '@type': 'Offer', price: 29, priceCurrency: 'USD', url: 'https://x.com/pricing',
            seller: { '@id': 'https://x.com/#organization' },
            priceSpecification: expect.objectContaining({ unitCode: 'MON', price: 29 }),
        }));
    });

    it('rounds discounted prices to two decimals', () => {
        const [node] = buildProductNodes([{ id: 'x', name: 'X', price: 25.740000000000002, currency: 'USD' }], 'https://x.com/pricing');
        expect((node['offers'] as any).price).toBe(25.74);
    });

    it('omits the Offer without a price or currency and skips nameless products', () => {
        const nodes = buildProductNodes([
            { id: 'a', name: 'Free', price: null, currency: 'USD' },
            { id: 'b', name: 'Mystery', price: 10 },
            { id: 'c', name: '  ', price: 10, currency: 'USD' },
            { id: 'd', name: 'Once', price: 0, currency: 'inr', type: 'one_time' },
        ], 'https://x.com/pricing');
        expect(nodes.map(n => n['name'])).toEqual(['Free', 'Mystery', 'Once']);
        expect(nodes[0]).not.toHaveProperty('offers');
        expect(nodes[1]).not.toHaveProperty('offers');
        expect(nodes[2]['offers']).toEqual(expect.objectContaining({ price: 0, priceCurrency: 'INR' }));
        expect(nodes[2]['offers']).not.toHaveProperty('priceSpecification');
    });
});
