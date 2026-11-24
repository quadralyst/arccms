/**
 * The content feature's Cloud Functions (specs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// Content: publishing, content types and static pages.
export * from '../publishQueue/processPublishQueue.js';
export { onSiteSettingsWritten } from '../publishQueue/onSiteSettingsWritten.js';
export * from '../content-types/onContentTypeDelete.js';
export * from '../content-types/createContentListIndexes.js';
// Work that changed hands in the editors (specs/visual-editing-spec.md, VE-D82).
export { onDraftKept } from '../draftContent/onDraftKept.js';
export { seedStaticPages } from '../pages/seedStaticPages.js';
