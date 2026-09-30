/**
 * Cloud Functions that need both the search and the content features
 * (specs/feature-flags-spec.md): exported only when the app has both.
 */

// The draft search queue: drafts live in collections created at runtime, so the
// browser queues each save and this indexes it (6.5).
export * from '../search/searchQueue.js';
