/**
 * The email-marketing feature's Cloud Functions (specs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// Email marketing: broadcasts, drip campaigns and announcements.
export * from '../email-log/processBroadcast.js';
export * from '../email-log/continueBroadcast.js';
export * from '../email-log/processScheduledBroadcasts.js';
export * from '../email-log/previewBroadcastAudience.js';
export * from '../email-core/processDripQueue.js';
export * from '../email-core/dripCampaigns.js';
export * from '../email-core/migrateWelcomeToSequences.js';
export * from '../email-core/announcements.js';
