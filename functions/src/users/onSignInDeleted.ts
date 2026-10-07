/**
 * Cloud Function trigger: fires when a Firebase Auth account is deleted
 * (docs/app/account-contract.html, "When a sign-in is deleted some other way").
 *
 * Every way Arc CMS deletes an account (Users, Delete; deleteMyAccount;
 * deleteAppAccount) deletes the `users` record first, and onUserDeleted then
 * deletes the sign-in. So when a sign-in goes and a record still points at it,
 * something other than Arc CMS deleted it: most often a browser calling
 * `auth.currentUser.delete()`, which Firebase allows any signed-in account, a
 * locked app account too, or another app sharing the Firebase project.
 *
 * Arc CMS leaves the record as it is and emits `user.signInDeleted`, with
 * `userId` (the Auth uid) and `data.userDocId` and `data.locked`, so the app
 * decides: give the person their sign-in back (restoreAppSignIn) or delete the
 * account (deleteAppAccount).
 *
 * Firebase has no Auth deletion trigger in its second generation API, so this one
 * is first generation. It needs no Identity Platform.
 */
import * as functionsV1 from 'firebase-functions/v1';
import { logger } from 'firebase-functions/v2';
import { arcFunctionsRegionParam } from '../arc-config.js';
import { findUserByUid } from '../auth/accounts.js';
import { emitAppEvent } from '../email-core/appEvents.js';
import { isLockedAppAccount } from './lockedAppAccount.js';

/** The event emitted when a sign-in is deleted and its `users` record is not. */
export const SIGN_IN_DELETED = 'user.signInDeleted';

/** What to do about a deleted sign-in: nothing, when no record points at it (Arc CMS deleted it). */
export async function handleSignInDeleted(uid: string, eventId: string): Promise<string | null> {
    if (!uid) return null;
    const record = await findUserByUid(uid);
    if (!record) return null;
    const locked = isLockedAppAccount(record.data);
    logger.warn(`The sign-in of users/${record.ref.id} (uid ${uid}) was deleted outside Arc CMS; the record is kept. Emitting ${SIGN_IN_DELETED}.`);
    // One event per deletion, even when Firebase delivers this one more than once.
    return emitAppEvent(SIGN_IN_DELETED, { userId: uid, data: { userDocId: record.ref.id, locked } }, { id: `signInDeleted-${eventId}` });
}

// Its own region: setGlobalOptions (region.ts) reaches second generation functions only.
export const onSignInDeleted = functionsV1
    .region(arcFunctionsRegionParam)
    .auth.user()
    .onDelete((user, context) => handleSignInDeleted(user.uid, context.eventId));
