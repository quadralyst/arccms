/**
 * The forms feature's Cloud Functions (specs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// Signup forms: form lifecycle, OTP and signup, referrals, leaderboards, and the
// per-form templates and their one-time migrations.
export * from '../waitlists/waitlist-details/onWaitlistUserCreate.js';
export * from '../waitlists/waitlist-details/onWaitlistUserUpdate.js';
export * from '../waitlists/waitlist-details/onWaitlistUserDelete.js';
// U6 cutover: onWaitlistedUsersCreate / onWaitlistedUserUpdate are deleted. Both
// existed only to email an OTP when `verificationCode` was written to a registry doc.
// U5 stopped writing that field entirely (requestFormOtp sends the code directly), so
// both had been dormant since, and joinForm no longer creates registry docs at all.
export * from '../waitlists/onWaitlistsCreate.js';
export * from '../waitlists/onWaitlistsUpdate.js';
export * from '../waitlists/onWaitlistsDelete.js';
export * from '../waitlists/ensureWaitlistExists.js';
export * from '../waitlists/formOtp.js';
export * from '../waitlists/finalizeFormSignup.js';
export * from '../email-core/syncOtpEnabledFlag.js';
export * from '../email-core/backfillWaitlistTemplates.js';
export * from '../email-core/getWaitlistTemplateDefaults.js';
export * from '../email-core/normalizeWaitlistTemplateIds.js';
export * from '../email-core/stampFormTargetLists.js';
export * from '../email-core/migrateWaitlistedUsers.js';
export * from '../waitlists/publicWaitlistViews.js';
export * from '../waitlists/joinForm.js';
export * from '../waitlists/creditReferral.js';
export * from '../waitlists/leaderboard/getLeaderBoardData.js';
export * from '../waitlists/referral/onReferralCreate.js';
export * from '../waitlists/referral/onReferralUpdate.js';
