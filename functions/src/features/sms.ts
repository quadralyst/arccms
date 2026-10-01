/**
 * The sms feature's Cloud Functions (specs/feature-flags-spec.md). Exported only
 * when the app has the feature: functions/src/feature-exports.gen.ts lists this file.
 */

// SMS: the test send, and phone sign-in, which cannot work without an SMS provider.
export * from '../auth/phoneAuth.js';
export * from '../auth/phoneSignInCheck.js';
export * from '../sms/sendTestSms.js';
