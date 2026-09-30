/**
 * Every ArcCMS function. `index.ts` exports this module as one group, `arccms`,
 * so each deploys as `arccms-<name>` (specs/coexistence-spec.md, CO-D5). Add new
 * functions here, never to index.ts.
 *
 * Core functions are listed below. A feature's own functions live in
 * `features/<id>.ts` and are exported only when the app has the feature
 * (src/custom/features.ts, specs/feature-flags-spec.md): the generated
 * `feature-exports.gen.ts` lists the files of the features that are on, so a
 * full functions deploy deletes the functions of a feature that is off.
 */

export * from './email-log/createEmailLog.js';

// Email-core (Phase 1): one-click unsubscribe endpoint + retry scheduler.
// queueEmail() is a library helper (imported by senders), not an exported trigger.
export * from './email-core/handleUnsubscribe.js';
// U5: legacy /unsubscribe/:waitlistId/:userId links, server-side.
export * from './email-core/unsubscribeLegacyLink.js';
export * from './email-core/retryPendingEmails.js';

// Email-core (Phase 2): default-template seeding callable + signup OTP callables
// + welcome-on-signup trigger.
export * from './email-core/seedEmailTemplates.js';
export * from './email-core/dedupeEmailTemplates.js';
export * from './auth/signupOtp.js';

// Sign-in with an email, Google, and moving an email or number between
// accounts. Phone sign-in is the sms feature's.
export * from './auth/emailAccount.js';
export * from './auth/linkIdentifiers.js';
export * from './auth/googleAccount.js';
export * from './users/onUserWelcomeEmail.js';

// Email-core (Phase 3): the preference center.
export * from './email-core/handleEmailPreferences.js';

// Email-core (Phase 4): test-send for the block editor.
export * from './email-core/sendTestEmail.js';

// Email-core (Phase 5): notifications, event bus, admin digest.
export * from './email-core/onNotificationCreate.js';
export * from './email-core/appEvents.js';
export * from './email-core/sendAdminDigest.js';
export * from './email-core/notificationPrefs.js';

// User role sync to Firebase Auth custom claims
export * from './users/syncUserRole.js';
export * from './users/adminCreateUser.js';
// The account's own: claim refresh and deleting it (docs/app/account-contract.html).
export * from './users/accountCallables.js';
// Feedback button: sender details and the admins' alert (docs/features/feedback.html).
export * from './feedback/onFeedbackCreated.js';

// Add email_lookup entry when a user document is created
export * from './users/onUserCreate.js';

// Delete Firebase Auth account and email_lookup entry when a user document is deleted
export * from './users/onUserDelete.js';

export * from './email-log/handleEmailWebhook.js';
export * from './email-log/trackEmailOpen.js';
export * from './email-log/purgeEmailLogs.js';
export * from './email-log/scheduledPurgeEmailLogs.js';

export * from './mail-config/testSmtpConfigConnection.js';
export * from './mail-config/testProviderConnection.js';
export * from './AnalyticsDashboard/testAnalyticsConnection.js';
export * from './AnalyticsDashboard/connectGoogleAnalytics.js';
export * from './AnalyticsDashboard/refreshAnalyticsData.js';
export * from './AnalyticsDashboard/disconnectGoogleAnalytics.js';
export * from './AnalyticsDashboard/selectAnalyticsProperty.js';

// Unsplash proxy — keeps API key server-side
export * from './integrations/searchUnsplash.js';

// The features this app has (generated from src/custom/features.ts).
export * from './feature-exports.gen.js';

// The app's own functions (functions/src/custom, docs/app/custom-space.html), deployed
// as arccms-custom-<name>, so they can never collide with a core function.
export * as custom from './custom/index.js';
