
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
export * from './users/onUserWelcomeEmail.js';

// Email-core (Phase 3): Contacts/Lists sync triggers, backfill, preference
// center, CSV import.
export * from './email-core/contactSync.js';
export * from './email-core/backfillContacts.js';
export * from './email-core/handleEmailPreferences.js';
export * from './email-core/csvImport.js';
export * from './email-core/adminContacts.js';

// Audience unification (U1): form→list backfill + template id normalization.
export * from './email-core/backfillFormLists.js';
export * from './email-core/normalizeWaitlistTemplateIds.js';

// Audience unification (U2): global contact tags + migration off per-waitlist tags.
export * from './email-core/migrateTagsToContacts.js';
export * from './email-core/contactTagSync.js';

// Audience unification (U4.5): contact custom fields + formData backfill.
export * from './email-core/adminContactFields.js';

// Audience unification (U5): welcome → day-0 sequence migration.
export * from './email-core/migrateWelcomeToSequences.js';

// Audience unification (U3): form → list decoupling backfill.
export * from './email-core/stampFormTargetLists.js';

// Audience unification (U2): pending contacts at signup.
export * from './email-core/backfillPendingContacts.js';

// Email-core (Phase 4): test-send for the block editor.
export * from './email-core/sendTestEmail.js';

// Email-core (Phase 5): notifications, event bus, announcements, admin digest.
export * from './email-core/onNotificationCreate.js';
export * from './email-core/appEvents.js';
export * from './email-core/announcements.js';
export * from './email-core/sendAdminDigest.js';
export * from './email-core/notificationPrefs.js';

// Email-core (Phase 7): drip campaigns.
export * from './email-core/processDripQueue.js';
export * from './email-core/dripCampaigns.js';

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
export * from './waitlists/onWaitlistsUpdate.js';
export * from './waitlists/onWaitlistsDelete.js';
export * from './waitlists/ensureWaitlistExists.js';

// Audience unification (U5): server-authoritative form OTP (double opt-in) and
// signup completion — the two together are what allow the rules lockdown.
export * from './waitlists/formOtp.js';
export * from './waitlists/finalizeFormSignup.js';

// Audience unification (U5.5): per-form default templates that heal themselves,
// and the mirror that keeps the public form's OTP switch honest.
export * from './email-core/syncOtpEnabledFlag.js';
export * from './email-core/backfillWaitlistTemplates.js';
export * from './email-core/getWaitlistTemplateDefaults.js';

//For increase total referrals
export * from './waitlists/leaderboard/getLeaderBoardData.js';
export * from './waitlists/referral/onReferralCreate.js';
export * from './waitlists/referral/onReferralUpdate.js';

export * from './email-log/handleEmailWebhook.js';
export * from './email-log/trackEmailOpen.js';
export * from './email-log/purgeEmailLogs.js';
export * from './email-log/processBroadcast.js';
export * from './email-log/continueBroadcast.js';
export * from './email-log/processScheduledBroadcasts.js';
export * from './email-log/previewBroadcastAudience.js';
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

// Dodo Payments — checkout, webhook ingestion, event processing, trial reminders
export * from './dodo-payments/createCheckoutSession.js';
export * from './dodo-payments/createTestCheckoutLink.js';
export * from './dodo-payments/dodoWebhook.js';
export * from './dodo-payments/handlePaymentEvent.js';
export * from './dodo-payments/testDodoConnection.js';
export * from './dodo-payments/scanTrialEndings.js';
export * from './dodo-payments/scanUpdatesEnding.js';
export * from './dodo-payments/scanExpiredEntitlements.js';
export * from './dodo-payments/consumeCredits.js';

// One-time seed function — deploy all existing content as static HTML
export { seedStaticPages } from './pages/seedStaticPages.js';
