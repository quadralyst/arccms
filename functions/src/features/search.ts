/**
 * The search feature's Cloud Functions (specs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// Search (S1 to S3, reworked in F5): the `search` callable every search box uses,
// the reindex tool, what Search settings shows, and one trigger per collection
// the app made searchable. specs/search-spec.md, specs/feature-flags-spec.md 6.
export * from '../search/search.js';
export * from '../search/reindexSearch.js';
export * from '../search/adminCollections.js';
export * from '../search/collectionTriggers.js';
