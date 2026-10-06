/**
 * The analytics feature's Cloud Functions (specs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// The admin dashboard's Google Analytics numbers (docs/features/analytics.html).
export * from '../AnalyticsDashboard/testAnalyticsConnection.js';
export * from '../AnalyticsDashboard/connectGoogleAnalytics.js';
export * from '../AnalyticsDashboard/refreshAnalyticsData.js';
export * from '../AnalyticsDashboard/disconnectGoogleAnalytics.js';
export * from '../AnalyticsDashboard/selectAnalyticsProperty.js';
