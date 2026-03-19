
export * from './email-log/createEmailLog.js';

export * from './publishQueue/processPublishQueue.js';

export * from './content-types/onContentTypeDelete.js';

// User role sync to Firebase Auth custom claims
export * from './users/syncUserRole.js';

// Add email_lookup entry when a user document is created
export * from './users/onUserCreate.js';

// Delete Firebase Auth account and email_lookup entry when a user document is deleted
export * from './users/onUserDelete.js';

// For wait list user lifecycle
export * from './waitlists/waitlist-details/onWaitlistUserCreate.js';
export * from './waitlists/waitlist-details/onWaitlistUserUpdate.js';
export * from './waitlists/waitlist-details/onWaitlistUserDelete.js';
export * from './waitlists/waitlistedUsers/onWaitlistedUsersCreate.js';
export * from './waitlists/waitlistedUsers/onWaitlistedUsersUpdate.js';

export * from './waitlists/onWaitlistsCreate.js';
export * from './waitlists/onWaitlistsDelete.js';
export * from './waitlists/ensureWaitlistExists.js';

//For increase total referrals
export * from './waitlists/leaderboard/getLeaderBoardData.js';
export * from './waitlists/referral/onReferralCreate.js';
export * from './waitlists/referral/onReferralUpdate.js';

export * from './email-log/handleEmailWebhook.js';
export * from './email-log/trackEmailOpen.js';
export * from './email-log/purgeEmailLogs.js';
export * from './email-log/processBroadcast.js';
export * from './email-log/continueBroadcast.js';
export * from './email-log/scheduledPurgeEmailLogs.js';

export * from './mail-config/testSmtpConfigConnection.js';
export * from './mail-config/testProviderConnection.js';
export * from './mail-config/onEmailConnectionTestCreate.js';
export * from './AnalyticsDashboard/testAnalyticsConnection.js';
export * from './AnalyticsDashboard/connectGoogleAnalytics.js';
export * from './AnalyticsDashboard/refreshAnalyticsData.js';
export * from './AnalyticsDashboard/disconnectGoogleAnalytics.js';
export * from './AnalyticsDashboard/selectAnalyticsProperty.js';

// Unsplash proxy — keeps API key server-side
export * from './integrations/searchUnsplash.js';

// One-time seed function — deploy all existing content as static HTML
export { seedStaticPages } from './pages/seedStaticPages.js';
