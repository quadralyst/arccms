/**
 * Copy this file to add a search source, then register it in registry.ts.
 *
 * Walkthrough: docs/search-developer-guide.md.
 *
 * The file is not imported anywhere, so it compiles without being deployed.
 * Delete the `_` prefix when you copy it.
 */

import type { SearchSource } from '../source.js';

export const exampleSource: SearchSource = {
    // Part of every index document ID. Do not rename after the first reindex
    // without reindexing again.
    id: 'example',

    // One collection, or a RegExp for a family of them.
    collection: 'Example',

    // 'public' for visitor-facing data, 'authenticated' for signed-in users,
    // 'admin' for admin-only data. The callable enforces it.
    scope: 'public',

    // What to index. Weights feed the ranking; prefix: true enables type-ahead
    // on that field. Dotted paths reach into maps. Keep it to short fields.
    fields: [
        { path: 'name', weight: 3, prefix: true },
        { path: 'tagline', weight: 2, prefix: true },
        { path: 'city', weight: 1 },
    ],

    // What a hit shows. THE CLIENT SEES ALL OF THIS: never put private
    // fields here. `sortAt` orders candidates and breaks ties.
    display: (doc) => ({
        title: String(doc['name'] ?? ''),
        snippet: String(doc['tagline'] ?? ''),
        badge: 'Example',
        link: `/example/${String(doc['slug'] ?? '')}`,
        meta: { city: doc['city'] },
        sortAt: doc['createdAt'],
    }),

    // Optional. Leave a document out of the index.
    include: (doc) => doc['status'] === 'active',

    // Optional. The document's language, if each carries one. Default: any.
    // lang: (doc) => String(doc['lang'] ?? '*'),

    // Optional. Rank this source above (>1) or below (<1) the others.
    // boost: 1,
};
