/**
 * The pwa feature's Cloud Functions (docs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// Installable app: install tracking (docs/pwa.md).
export * from '../pwa/trackPwaEvent.js';
