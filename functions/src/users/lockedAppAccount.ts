/**
 * App accounts are locked (specs/app-account-lock-spec.md, docs/app/app-accounts.html):
 * an account made by createAppAccount cannot change itself, unless its app made it with
 * `selfService: true`. The app's own functions still change it, with the Admin SDK.
 *
 * The rules (firestore.rules, isLockedAppRecord) and the browser
 * (src/app/core/app-accounts/app-account-lock.ts) read the lock the same way.
 */
import { HttpsError } from 'firebase-functions/v2/https';

/** `by` on a record that createAppAccount made (app-kit/accounts.ts). */
export const APP_ACCOUNT_BY = 'app';

/** The record field that opts one app account out of the lock. */
export const SELF_SERVICE = 'selfService';

/** What a locked app account is told when it tries to change itself. */
export const APP_MANAGED = "This account is managed by the app that made it, so it can't be changed here.";

/** Whether this record is an app account that cannot change itself. */
export function isLockedAppAccount(data: Record<string, unknown> | undefined): boolean {
    return data?.['by'] === APP_ACCOUNT_BY && data?.[SELF_SERVICE] !== true;
}

/** Refuse a locked app account, with a reason the browser can read. */
export function refuseLockedAppAccount(data: Record<string, unknown> | undefined): void {
    if (isLockedAppAccount(data)) throw new HttpsError('permission-denied', APP_MANAGED, { reason: 'app-managed' });
}
