/**
 * The content feature's Cloud Functions (specs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// Content: publishing, content types and static pages.
export * from '../publishQueue/processPublishQueue.js';
export { onSiteSettingsWritten } from '../publishQueue/onSiteSettingsWritten.js';
// Runs again a whole-site republish or items-from rebuild whose run never finished.
export * from '../publishQueue/recoverPublishQueue.js';
export * from '../content-types/onContentTypeDelete.js';
export { seedStaticPages } from '../pages/seedStaticPages.js';
