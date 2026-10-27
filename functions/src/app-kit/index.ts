/**
 * The app kit: the supported, documented way for an app's own Cloud Functions
 * (functions/src/custom/) to use ArcCMS's accounts, claims, sign-in and email
 * (docs/app/app-kit.html). Import from here only; everything else in functions/src is
 * core's to change. A test keeps this list and the docs page in step.
 */

// Accounts without email or phone (specs/app-accounts-spec.md)
export { createAppAccount, deleteAppAccount, restoreAppSignIn, APP_ACCOUNT } from './accounts.js';
export type { AppAccount, CreateAppAccountInput } from './accounts.js';

// Claims and sessions
export { isArcAdmin, mergeAppClaims, revokeSessions, sessionClaims } from '../users/claims.js';

// Signing a person in: a custom token for signInWithCustomToken in the browser (with
// claims for that one sign-in, read back with sessionClaims()), and whether a
// callable's caller signed in with it
export { issueSignInToken } from '../auth/accounts.js';
export { signedInByApp } from '../auth/appAccountLock.js';
// A fresh code before a sensitive action: the proof the page got from confirmFreshCode, used up once (F31)
export { useFreshCodeProof } from '../auth/freshCode.js';
// A call that only starts the function, so a page can wake it before it is needed: answered at
// once with WARM, before any check (docs/app/functions.html#cold-starts, F33)
export { isWarmUp, WARM } from '../auth/warmUp.js';

// PINs an app checks itself, a check of the phone sign-in PIN for a gate, and rate limits (specs/app-pin-spec.md)
export { APP_PINS, createPinStore, hashedKey } from './pins.js';
export type { PinStore } from './pins.js';
export { createPhonePinCheck } from './phonePinCheck.js';
export type { PhonePinCheck } from './phonePinCheck.js';
// Signing a member in with their own sign-in PIN, counted as a sign-in (specs/sign-in-pin-spec.md, F32)
export { signInWithMemberPin } from './memberPin.js';
export type { MemberPinOptions } from './memberPin.js';
export { callerKey, consumeRateLimit, isValidPin, isWeakPin, pinTooEasy } from '../auth/accounts.js';
export type { PinCheck } from '../auth/accounts.js';
// The password and PIN strength the app chose in src/custom/sign-in.ts (specs/sign-in-strength-spec.md)
export { signInStrength } from '../sign-in-choice.js';
export type { SignInStrength } from '../shared/sign-in-strength.js';

// Sending the app's own email: its templates in its languages, attachments, the
// outcome back as AppEvents, and a capture for its unit tests (specs/app-email-spec.md)
export { sendAppEmail, captureAppEmails, MAX_APP_EMAIL_RECIPIENTS } from '../email-core/appEmail.js';
export type { SendAppEmailInput, SendAppEmailResult, SendAppEmailLog, CapturedAppEmail } from '../email-core/appEmail.js';
export { mergeValueHtml as escapeEmailHtml } from '../mail-config/mailConfig.js';
export { MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES } from '../email-core/emailAttachments.js';
export type { EmailAttachmentInput } from '../email-core/emailAttachments.js';
export { APP_EMAIL_EVENTS } from '../email-core/appEmailOutcome.js';
export type { AppEmailEvent } from '../email-core/appEmailOutcome.js';
export type { AppEmailTemplate, AccountEmailLanguages, EmailLanguageVersion } from '../email-core/emailLanguages.js';
export type { AppTagValue } from '../email-core/queueEmail.js';
