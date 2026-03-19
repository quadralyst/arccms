/**
 * Cloud Function trigger: fires when a user document is deleted from the `users` collection.
 *
 * Responsibilities:
 * 1. Delete the corresponding Firebase Auth account (so the user can't sign in again)
 * 2. Remove the hashed email from the `email_lookup` collection (first-run / signup check)
 *
 * Note: The client-side delete in users/index.page.ts already attempts to remove
 * the email_lookup entry. This Cloud Function is the authoritative cleanup that
 * runs server-side, ensuring both operations complete even if the client fails.
 */

import { onDocumentDeleted } from 'firebase-functions/v2/firestore';
import { owner, db } from '../init.js';

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
    'users/{docId}',
    async (event) => {
        const deletedData = event.data?.data();
        if (!deletedData) return;

        const uid: string | undefined = deletedData.uid;
        const email: string | undefined = deletedData.email;

        const tasks: Promise<void>[] = [];

        // 1. Delete Firebase Auth account
        if (uid) {
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

        await Promise.all(tasks);
    }
);
