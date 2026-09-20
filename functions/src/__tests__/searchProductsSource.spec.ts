/**
 * The Products source, the developer guide's worked example: a source is
 * plain data, so it is tested by building entries from a fixture document.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../init.js', () => ({ db: {}, owner: {} }));

import { buildEntries } from '../search/writer.js';
import { productsSource } from '../search/sources/products.js';
import { findSources } from '../search/registry.js';
import type { SearchContext } from '../search/source.js';

const ctx: SearchContext = {
    collection: 'Products',
    docId: 'gold',
    localization: { defaultLanguage: 'en', enabledLanguages: [] },
    contentTypes: new Map(),
};

describe('productsSource', () => {
    it('is registered for the Products collection', () => {
        expect(findSources('Products').map(s => s.id)).toEqual(['products']);
    });

    it('indexes name, description and features, and shows the price as the badge', async () => {
        const [entry] = await buildEntries(productsSource, {
            name: 'Gold Plan', description: 'Everything in Plus and more', features: ['Priority support', 'Unlimited pages'],
            active: true, price: 29, currency: 'usd', type: 'subscription', interval: 'month', premiumType: 'gold',
        }, ctx);

        expect(entry.lang).toBe('*');
        expect(entry.scope).toBe('public');
        expect(entry.tokens).toEqual(expect.arrayContaining(['gold', 'go', 'gol', 'everything', 'priority', 'unlimited']));
        expect(entry.tokens).not.toContain('pr');
        expect(entry.weights).toEqual({ name: 3, description: 2, features: 1 });
        expect(entry.title).toBe('Gold Plan');
        expect(entry.badge).toBe('USD 29/month');
        expect(entry.link).toBe('/pricing');
        expect(entry.meta).toEqual({ productId: 'gold', premiumType: 'gold' });
    });

    it('leaves inactive products out', async () => {
        expect(await buildEntries(productsSource, { name: 'Old', active: false }, ctx)).toEqual([]);
    });

    it('labels a one-time product without an interval and a priceless one as a plan', async () => {
        const [oneTime] = await buildEntries(productsSource, { name: 'Lifetime', active: true, price: 199, type: 'one_time' }, ctx);
        expect(oneTime.badge).toBe('USD 199');
        const [free] = await buildEntries(productsSource, { name: 'Free', active: true }, ctx);
        expect(free.badge).toBe('Plan');
    });
});
