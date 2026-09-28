/**
 * Cloud Function trigger: fires when a user document is deleted from the `users` collection,
 * by an admin (Users, Delete) or by the person (Profile, Delete account: deleteMyAccount).
 *
 * Responsibilities (docs/account-contract.md, "Deleting an account"):
 * 1. Delete the corresponding Firebase Auth account (so the user can't sign in again).
 *    An account another app owns or shares is kept, with its ArcCMS claims removed.
 * 2. Remove the hashed email from the `email_lookup` collection (first-run / signup check)
 * 3. Phone sign-in: the number's index entry and the PIN
 * 4. Everything stored under the record: every subcollection of users/{docId}, at any
 *    depth (Firestore keeps subcollections when a document is deleted), and the
 *    per-user Storage folder `{prefix}users/{docId}/` plus the profile photos in
 *    `avatars/{uid}/`, and the person's feedback (`Feedback` where userDocId matches)
 * 5. A `user.deleted` event on the event bus, for app code that keeps data elsewhere
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

export const onUserDeleted = onDocumentDeleted(
    arcDocument('users/{docId}'),
    async (event) => {
        const deletedData = event.data?.data();
        if (!deletedData) return;

        const uid: string | undefined = deletedData.uid;
        const email: string | undefined = deletedData.email;

        const tasks: Promise<void>[] = [];

        // 1. Delete Firebase Auth account, unless a host app owns or shares it
        //    (CO-D16): removing someone from ArcCMS must not delete their login
        //    to the app they actually use.
        //    The kept account loses its ArcCMS claims, or a removed admin would
        //    stay an admin to the rules and callables.
        if (uid && !arccmsOwnsAuthAccount(deletedData)) {
            console.log(`Kept Auth account uid=${uid}: authOwner is ${deletedData['authOwner']}.`);
            tasks.push(
                clearArcClaims(uid).catch((err: any) => {
                    if (err?.code !== 'auth/user-not-found') {
                        console.error(`Failed to clear ArcCMS claims for uid=${uid}:`, err);
                    }
                })
            );
        }
        if (uid && arccmsOwnsAuthAccount(deletedData)) {
            tasks.push(
                owner.deleteUser(uid)
                    .then(() => {
                        console.log(`Firebase Auth account deleted for uid=${uid}`);
                    })
                    .catch((err: any) => {
                        // user-not-found means Auth account was already removed — safe to ignore
                        if (err?.code === 'auth/user-not-found') {
                            console.warn(`Auth account not found for uid=${uid} — already deleted.`);
                        } else {
                            console.error(`Failed to delete Auth account for uid=${uid}:`, err);
                        }
                    })
            );
        }

        // 2. Remove hashed email from email_lookup collection
        if (email) {
            tasks.push(
                hashEmail(email)
                    .then((hash) => {
                        const docRef = db.collection(EMAIL_LOOKUP_COLLECTION).doc(hash);
                        return docRef.delete();
                    })
                    .then(() => {
                        console.log(`email_lookup entry removed for email=${email}`);
                    })
                    .catch((err: any) => {
                        console.error(`Failed to remove email_lookup entry for email=${email}:`, err);
                    })
            );
        }

        // 3. Phone sign-in: the number's index entry (when it still points here) and the PIN.
        const phone: string | undefined = deletedData.phone;
        if (phone) {
            const indexRef = db.collection(PHONE_INDEX).doc(phoneHash(phone));
            tasks.push(
                indexRef.get()
                    .then((snap) => (snap.data()?.['userDocId'] === event.params.docId ? indexRef.delete() : undefined))
                    .then(() => undefined)
                    .catch((err: any) => console.error('Failed to remove phone_index entry:', err))
            );
        }
        if (uid) {
            tasks.push(
                db.collection(AUTH_PINS).doc(uid).delete()
                    .then(() => undefined)
                    .catch((err: any) => console.error(`Failed to remove the PIN for uid=${uid}:`, err))
            );
        }

        // 4. Everything stored under the record: subcollections, and the Storage folders.
        const docId = event.params.docId;
        tasks.push(
            db.recursiveDelete(db.collection('users').doc(docId))
                .then(() => console.log(`Deleted everything under users/${docId}.`))
                .catch((err: any) => console.error(`Failed to delete data under users/${docId}:`, err))
        );
        // Their feedback (docs/feedback.md); its files are in the Storage folder below.
        tasks.push(
            (async () => {
                const snap = await db.collection('Feedback').where('userDocId', '==', docId).get();
                await Promise.all(snap.docs.map((d) => d.ref.delete()));
                if (snap.size) console.log(`Deleted ${snap.size} feedback item(s) of users/${docId}.`);
            })().catch((err: any) => console.error(`Failed to delete the feedback of users/${docId}:`, err))
        );
        const bucket = arcStorageBucket() ? storage.bucket(arcStorageBucket()) : storage.bucket();
        const folders = [userStorageFolder(docId), ...(uid ? [`avatars/${uid}/`] : [])];
        for (const prefix of folders) {
            tasks.push(
                bucket.deleteFiles({ prefix, force: true })
                    .then(() => console.log(`Deleted Storage files under ${prefix}.`))
                    .catch((err: any) => console.error(`Failed to delete Storage files under ${prefix}:`, err))
            );
        }

        // 5. Tell anything that keeps this person's data elsewhere.
        tasks.push(
            emitAppEvent('user.deleted', { ...(uid ? { userId: uid } : {}), data: { userDocId: docId } })
                .then(() => undefined)
                .catch((err: any) => console.error('Failed to emit user.deleted:', err))
        );

        await Promise.all(tasks);
    }
);
