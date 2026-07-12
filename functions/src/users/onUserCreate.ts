/**
 * Cloud Function trigger: fires when a user document is created in the `users` collection.
 *
 * Responsibility:
 * - Add a hashed email entry to the `email_lookup` collection for public existence checks
 *   and first-run detection.
 *
 * This replaces the client-side addEmailLookup() call that previously ran during signup.
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { db } from '../init.js';
import { emitAppEvent } from '../email-core/appEvents.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';

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

export const onUserCreated = onDocumentCreated(
    'users/{docId}',
    async (event) => {
        const createdData = event.data?.data();
        if (!createdData) return;

        const email: string | undefined = createdData.email;
        if (!email) {
            console.warn('User document created without an email field — skipping email_lookup.');
            return;
        }

        try {
            const hash = await hashEmail(email);
            const docRef = db.collection(EMAIL_LOOKUP_COLLECTION).doc(hash);
            await docRef.set({ exists: true });
            console.log(`email_lookup entry created for email=${email}`);
        } catch (err: any) {
            console.error(`Failed to create email_lookup entry for email=${email}:`, err);
        }

        // Notifications & event bus (Phase 5) — additive, non-fatal.
        await Promise.allSettled([
            emitAppEvent('user.signed_up', { userId: createdData.uid, contactEmail: email }),
            notifyAdmins('admin_new_signup', {
                title: 'New signup',
                body: `${createdData.name || email} just signed up.`,
                link: '/admin/users',
            }),
        ]);
    }
);
