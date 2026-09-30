/**
 * The seo feature's Cloud Functions (specs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// SEO: robots.txt, llms.txt and the IndexNow key (specs/discoverability-spec.md, D3).
export { regenerateSeoFiles } from '../pages/regenerateSeoFiles.js';
