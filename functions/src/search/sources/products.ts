/**
 * Products: the pricing page's plans, searchable from the public site.
 *
 * The worked example from docs/search-developer-guide.md, added by
 * following that guide. Also useful: "gold" finds the Gold plan.
 */

import type { SearchSource } from '../source.js';

export const PRODUCTS_SOURCE_ID = 'products';

function priceBadge(doc: Record<string, unknown>): string {
    const price = doc['price'];
    if (typeof price !== 'number') return 'Plan';
    const currency = typeof doc['currency'] === 'string' ? doc['currency'].toUpperCase() : 'USD';
    const interval = doc['type'] === 'subscription' && typeof doc['interval'] === 'string'
        ? `/${doc['interval']}`
        : '';
    return `${currency} ${price}${interval}`;
}

export const productsSource: SearchSource = {
    id: PRODUCTS_SOURCE_ID,
    collection: 'Products',
    scope: 'public',
    fields: [
        { path: 'name', weight: 3, prefix: true },
        { path: 'description', weight: 2, prefix: true },
        { path: 'features', weight: 1 },
    ],
    display: (doc, ctx) => ({
        title: String(doc['name'] ?? ''),
        snippet: String(doc['description'] ?? ''),
        badge: priceBadge(doc),
        link: '/pricing',
        meta: { productId: ctx.docId, premiumType: doc['premiumType'] },
        sortAt: doc['modifiedAt'] ?? doc['createdAt'],
    }),
    include: (doc) => doc['active'] === true,
};
