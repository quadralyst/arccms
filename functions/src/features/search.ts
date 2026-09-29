/**
 * The search feature's Cloud Functions (docs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// Search (S1 to S3): wildcard indexer, translation re-index, reindex tool, and the
// one `search` callable every search box uses. docs/search-spec.md.
export * from '../search/onAnyDocumentWritten.js';
export * from '../search/reindexSearch.js';
export * from '../search/search.js';
