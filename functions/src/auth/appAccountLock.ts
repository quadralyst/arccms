/**
 * A locked app account that signed in some other way (specs/app-account-lock-spec.md).
 *
 * A locked app account signs in only with the app's own token (issueSignInToken,
 * `signInWithCustomToken`). Firebase lets a signed-in browser link Google, a password
 * or a phone to its own sign-in account without asking Arc CMS's server, and Arc CMS
 * cannot refuse that without Identity Platform blocking functions. So whenever the
 * server sees a locked app account signed in by anything else, it treats the lock as
 * broken: it takes those sign-ins off the account, ends every session, and refuses.
 * The `users` record never follows such a link (the rules deny the record write).
 */
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { owner } from '../init.js';
import type { UserRecord } from './accounts.js';
import { APP_MANAGED, isLockedAppAccount } from '../users/lockedAppAccount.js';
import { releasedEmail } from './linkIdentifiers.js';

/** Firebase's name for a sign-in with a custom token, which is how an app signs its accounts in. */
export const APP_SIGN_IN = 'custom';

/** How the caller's session signed in, from its ID token. */
export function signInProvider(request: CallableRequest): string {
    const token = request.auth?.token as { firebase?: { sign_in_provider?: string } } | undefined;
    return String(token?.firebase?.sign_in_provider ?? '');
}

/**
 * Take every sign-in method off a locked app account's sign-in account, other than the
 * app's token, and end all its sessions. Returns the methods taken off (none when
 * there was nothing to do; sessions are then left alone).
 */
export async function releaseOtherSignIns(uid: string): Promise<string[]> {
    const account = await owner.getUser(uid);
    const providers = (account.providerData ?? []).map((p) => p.providerId);
    const unlink = providers.filter((id) => id !== 'phone');
    const removed = [...providers];
    if (account.email) removed.push('email');
    if (!removed.length) return [];
    await owner.updateUser(uid, {
        ...(unlink.length ? { providersToUnlink: unlink } : {}),
        // Firebase cannot clear an email, only replace it: one nobody receives mail at.
        ...(account.email ? { email: releasedEmail(uid), emailVerified: false } : {}),
        ...(account.phoneNumber ? { phoneNumber: null } : {}),
    });
    await owner.revokeRefreshTokens(uid);
    return [...new Set(removed)];
}

/**
 * Refuse a locked app account that signed in by anything other than the app's token,
 * after taking that way in off it. Does nothing for every other account.
 */
export async function refuseOtherSignIn(request: CallableRequest, record: UserRecord): Promise<void> {
    if (!isLockedAppAccount(record.data)) return;
    const provider = signInProvider(request);
    if (provider === APP_SIGN_IN) return;
    const uid = String(record.data['uid'] ?? request.auth?.uid ?? '');
    const removed = uid ? await releaseOtherSignIns(uid) : [];
    if (uid && !removed.length) await owner.revokeRefreshTokens(uid);
    logger.warn(`App account ${record.ref.id} signed in with ${provider || 'an unknown method'}; removed ${removed.join(', ') || 'nothing'} and ended its sessions.`);
    throw new HttpsError('permission-denied', APP_MANAGED, { reason: 'app-managed' });
}
