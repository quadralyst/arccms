/**
 * The pwa feature's Cloud Functions (specs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// Installable app: install tracking (docs/features/pwa.html).
export * from '../pwa/trackPwaEvent.js';
