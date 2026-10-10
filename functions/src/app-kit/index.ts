/**
 * The app kit: the supported, documented way for an app's own Cloud Functions
 * (functions/src/custom/) to use ArcCMS's accounts, claims and sign-in
 * (docs/app/app-kit.html). Import from here only; everything else in functions/src is
 * core's to change. A test keeps this list and the docs page in step.
 */

// Accounts without email or phone (specs/app-accounts-spec.md)
export { createAppAccount, deleteAppAccount, restoreAppSignIn, APP_ACCOUNT } from './accounts.js';
export type { AppAccount, CreateAppAccountInput } from './accounts.js';

// Claims and sessions
export { isArcAdmin, mergeAppClaims, revokeSessions } from '../users/claims.js';

// Signing a person in: a custom token for signInWithCustomToken in the browser,
// and whether a callable's caller signed in with it
export { issueSignInToken } from '../auth/accounts.js';
export { signedInByApp } from '../auth/appAccountLock.js';

// PINs an app checks itself, a check of the phone sign-in PIN for a gate, and rate limits (specs/app-pin-spec.md)
export { APP_PINS, createPinStore, hashedKey } from './pins.js';
export type { PinStore } from './pins.js';
export { createPhonePinCheck } from './phonePinCheck.js';
export type { PhonePinCheck } from './phonePinCheck.js';
export { callerKey, consumeRateLimit, isValidPin, isWeakPin } from '../auth/accounts.js';
export type { PinCheck } from '../auth/accounts.js';
