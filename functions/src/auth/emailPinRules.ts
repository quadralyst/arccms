/**
 * Which email accounts sign in with a PIN, and taking a password off one that chose
 * a PIN (specs/sign-in-pin-spec.md, docs/app/sign-in.html#email-pin). Shared by email
 * PIN sign-in (emailPin.ts), Change PIN (phoneAuth.ts setPin) and the password
 * callables that a PIN account no longer uses.
 */
import { logger } from 'firebase-functions/v2';
import { owner } from '../init.js';
import { readSignInSettings, type UserRecord } from './accounts.js';
import { arccmsOwnsAuthAccount } from '../users/authOwner.js';
import { isLockedAppAccount } from '../users/lockedAppAccount.js';

/** What a host app's user is told: their login is that app's to reset. */
export const HOST_ACCOUNT = 'Reset your password in the app you signed up with.';

/**
 * Whether this account may sign in by email with a PIN: its login is Arc CMS's own
 * (never one a host app owns or shares, whose password that app uses), it is not a
 * locked app account, and it has an email.
 */
export function pinEligible(data: Record<string, unknown>): boolean {
    return arccmsOwnsAuthAccount(data) && !isLockedAppAccount(data) && typeof data['email'] === 'string' && data['email'].trim() !== '';
}

/** Whether, in email PIN mode, this account keeps its password: an admin does, as an eligible account does not. */
export function keepsPassword(data: Record<string, unknown>): boolean {
    return data['role'] === 'admin' || !pinEligible(data);
}

/** Whether this sign-in account has a password. */
export async function hasPassword(uid: string): Promise<boolean> {
    const account = await owner.getUser(uid).catch(() => null);
    return !!account?.providerData?.some((p) => p.providerId === 'password');
}

/**
 * After an email account chose a PIN, while the site signs email accounts in with a
 * PIN: take its password off, so it has one way in. An admin, and a login another app
 * owns or shares, keep theirs. Returns whether a password was taken off.
 */
export async function dropPasswordForPin(record: UserRecord): Promise<boolean> {
    const uid = String(record.data['uid'] ?? '');
    if (!uid || keepsPassword(record.data)) return false;
    if (!(await readSignInSettings()).emailPin || !(await hasPassword(uid))) return false;
    await owner.updateUser(uid, { providersToUnlink: ['password'] });
    logger.info(`dropPasswordForPin: ${record.ref.id} chose a PIN; its password was taken off.`);
    return true;
}
