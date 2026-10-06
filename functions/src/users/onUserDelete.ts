/**
 * Cloud Function trigger: fires when a user document is deleted from the `users` collection,
 * by an admin (Users, Delete) or by the person (Profile, Delete account: deleteMyAccount).
 *
 * Responsibilities (docs/app/account-contract.html, "Deleting an account"):
 * 0. End ArcCMS access first: remove the ArcCMS claims and sign out every session,
 *    whoever owns the sign-in, so a later failure cannot leave a removed admin an admin.
 * 1. Delete the corresponding Firebase Auth account (so the user can't sign in again).
 *    An account another app owns or shares is kept, without ArcCMS claims.
 * 2. Remove the hashed email from the `email_lookup` collection (first-run / signup check)
 * 3. Phone sign-in: the number's index entry and the PIN
 * 4. Everything stored under the record: every subcollection of users/{docId}, at any
 *    depth (Firestore keeps subcollections when a document is deleted), and the
 *    per-user Storage folder `{prefix}users/{docId}/` plus the profile photos in
 *    `avatars/{uid}/`, the person's feedback (`Feedback` where userDocId matches)
 *    and their in-app notifications (`Notifications` where userId matches)
 * 5. A `user.deleted` event on the event bus, for app code that keeps data elsewhere
 *
 * `retry: true` (review F): every step is idempotent, so when one fails the whole
 * run throws and the platform runs it again, for up to an hour after the delete.
 * Failures used to be logged and forgotten, leaving data behind, or a login with
 * admin claims. `user.deleted` is emitted only once every step has worked.
 *
 * Note: The client-side delete in users/index.page.ts already attempts to remove
 * the email_lookup entry. This Cloud Function is the authoritative cleanup that
 * runs server-side, ensuring both operations complete even if the client fails.
 */

import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { owner, db, storage } from '../init.js';
import { arcDocument, arcStorageBucket, userStorageFolder } from '../arc-config.js';
import { emitAppEvent } from '../email-core/appEvents.js';
import { arccmsOwnsAuthAccount } from './authOwner.js';
import { clearArcClaims } from './claims.js';
import { phoneHash } from '../auth/phoneNumber.js';

const PHONE_INDEX = 'phone_index';
const AUTH_PINS = 'auth_pins';
/** An app's PINs (functions/src/app-kit/pins.ts), named here so deletion needs no app-kit import. */
const APP_PINS = 'app_pins';

const EMAIL_LOOKUP_COLLECTION = 'email_lookup';

/**
 * SHA-256 hash of an email address, matching the client-side hashEmail() utility.
 * Uses Node.js built-in crypto module — no external dependency needed.
 */
async function hashEmail(email: string): Promise<string> {
    const { createHash } = await import('crypto');
    const normalized = email.trim().toLowerCase();
    return createHash('sha256').update(normalized).digest('hex');
}

/** How long a failed cleanup is retried, counted from the delete. */
export const USER_DELETE_RETRY_WINDOW_MS = 60 * 60 * 1000;

/** Whether a failed run for this event should be retried (it is still recent). */
export function shouldRetryUserDelete(eventTime: string | undefined, now = Date.now()): boolean {
    const age = now - Date.parse(eventTime ?? '');
    return Number.isFinite(age) && age <= USER_DELETE_RETRY_WINDOW_MS;
}

const notFound = (err: any) => err?.code === 'auth/user-not-found';

/** Run one cleanup step; returns what failed, or null. */
async function step(name: string, run: () => Promise<unknown>): Promise<string | null> {
    try {
        await run();
        return null;
    } catch (err: any) {
        console.error(`onUserDeleted: ${name} failed:`, err);
        return name;
    }
}

export const onUserDeleted = onDocumentDeleted(
    { ...arcDocument('users/{docId}'), retry: true },
    async (event) => {
        const deletedData = event.data?.data();
        if (!deletedData) return;

        const uid: string | undefined = deletedData.uid;
        const email: string | undefined = deletedData.email;
        const docId = event.params.docId;

        // 0. End ArcCMS access before anything else can fail: no claims, no sessions.
        //    (A sign-in another app owns keeps its own claims; see clearArcClaims.)
        const failures: (string | null)[] = [];
        if (uid) {
            failures.push(await step('ending access', async () => {
                try {
                    await clearArcClaims(uid);
                    await owner.revokeRefreshTokens(uid);
                } catch (err) {
                    if (!notFound(err)) throw err;
                }
            }));
        }

        const tasks: Promise<string | null>[] = [];

        // 1. Delete the Firebase Auth account, unless a host app owns or shares it
        //    (CO-D16): removing someone from ArcCMS must not delete their login
        //    to the app they actually use.
        if (uid && arccmsOwnsAuthAccount(deletedData)) {
            tasks.push(step('deleting the sign-in', async () => {
                try {
                    await owner.deleteUser(uid);
                    console.log(`Firebase Auth account deleted for uid=${uid}`);
                } catch (err) {
                    if (!notFound(err)) throw err;
                }
            }));
        } else if (uid) {
            console.log(`Kept Auth account uid=${uid}: authOwner is ${deletedData['authOwner']}.`);
        }

        // 2. Remove hashed email from email_lookup collection
        if (email) {
            tasks.push(step('email_lookup', async () => {
                await db.collection(EMAIL_LOOKUP_COLLECTION).doc(await hashEmail(email)).delete();
            }));
        }

        // 3. Phone sign-in: the number's index entry (when it still points here) and the PIN.
        const phone: string | undefined = deletedData.phone;
        if (phone) {
            tasks.push(step('phone_index', async () => {
                const indexRef = db.collection(PHONE_INDEX).doc(phoneHash(phone));
                const snap = await indexRef.get();
                if (snap.data()?.['userDocId'] === docId) await indexRef.delete();
            }));
        }
        if (uid) {
            tasks.push(step('the PIN', () => db.collection(AUTH_PINS).doc(uid).delete()));
            // An app's own PINs for this person, in every namespace (docs/app/pin.html).
            tasks.push(step('app PINs', async () => {
                const snap = await db.collection(APP_PINS).where('uid', '==', uid).get();
                await Promise.all(snap.docs.map((d) => d.ref.delete()));
            }));
        }

        // 4. Everything stored under the record: subcollections, and the Storage folders.
        tasks.push(step(`data under users/${docId}`, () => db.recursiveDelete(db.collection('users').doc(docId))));
        // Their feedback (docs/features/feedback.html); its files are in the Storage folder below.
        tasks.push(step('feedback', async () => {
            const snap = await db.collection('Feedback').where('userDocId', '==', docId).get();
            await Promise.all(snap.docs.map((d) => d.ref.delete()));
        }));
        // Their in-app notifications, keyed by the sign-in uid.
        if (uid) {
            tasks.push(step('notifications', async () => {
                const snap = await db.collection('Notifications').where('userId', '==', uid).get();
                await Promise.all(snap.docs.map((d) => d.ref.delete()));
            }));
        }
        const bucket = arcStorageBucket() ? storage.bucket(arcStorageBucket()) : storage.bucket();
        const folders = [userStorageFolder(docId), ...(uid ? [`avatars/${uid}/`] : [])];
        for (const prefix of folders) {
            tasks.push(step(`Storage files under ${prefix}`, () => bucket.deleteFiles({ prefix, force: true })));
        }

        failures.push(...(await Promise.all(tasks)));
        const failed = failures.filter((f): f is string => !!f);
        if (failed.length) {
            if (shouldRetryUserDelete(event.time)) {
                throw new Error(`onUserDeleted: users/${docId}: ${failed.join(', ')} failed; will retry.`);
            }
            console.error(`onUserDeleted: users/${docId}: giving up after ${USER_DELETE_RETRY_WINDOW_MS / 60000} minutes; not done: ${failed.join(', ')}.`);
            return;
        }

        // 5. Tell anything that keeps this person's data elsewhere, once everything above worked.
        try {
            await emitAppEvent('user.deleted', { ...(uid ? { userId: uid } : {}), data: { userDocId: docId } });
        } catch (err) {
            if (shouldRetryUserDelete(event.time)) throw err;
            console.error('Failed to emit user.deleted:', err);
        }
        console.log(`onUserDeleted: users/${docId} and everything under it deleted.`);
    }
);
