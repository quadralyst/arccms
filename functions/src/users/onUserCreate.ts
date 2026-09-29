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
import { db, owner } from '../init.js';
import { emitAppEvent } from '../email-core/appEvents.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';
import { arcDocument } from '../arc-config.js';
import { maskPhone } from '../auth/phoneNumber.js';
import { arccmsOwnsAuthAccount } from './authOwner.js';

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
    arcDocument('users/{docId}'),
    async (event) => {
        const createdData = event.data?.data();
        if (!createdData) return;

        const email: string | undefined = createdData.email || undefined;
        if (email) {
            try {
                const hash = await hashEmail(email);
                const docRef = db.collection(EMAIL_LOOKUP_COLLECTION).doc(hash);
                await docRef.set({ exists: true });
                console.log(`email_lookup entry created for email=${email}`);
            } catch (err: any) {
                console.error(`Failed to create email_lookup entry for email=${email}:`, err);
            }
            await markAuthEmailVerified(createdData);
        } else {
            // Phone sign-ups have no email: nothing to look up, but still a sign-up.
            console.log('User document created without an email field — skipping email_lookup.');
        }

        // Notifications & event bus (Phase 5) — additive, non-fatal.
        const who = createdData.name || email || maskPhone(String(createdData.phone || ''));
        await Promise.allSettled([
            emitAppEvent('user.signed_up', { userId: createdData.uid, ...(email ? { contactEmail: email } : {}) }),
            notifyAdmins('admin_new_signup', {
                title: 'New signup',
                body: `${who} just signed up.`,
                link: '/admin/users',
            }),
        ]);
    }
);

/**
 * Tell Firebase Auth the email is verified when our own sign-up code proved it.
 *
 * Firebase keeps one account per email. When someone later signs in with
 * Google using that address, it keeps the password on the account only if the
 * email is verified; otherwise it drops the password. The sign-up code is
 * ArcCMS's, so Auth never learns about it unless we say so. The proof is the
 * record's `emailVerified`, which only the server sets: createAccountRecord,
 * after the sign-up code was verified by the same browser (a ticket), or an
 * admin. People cannot create their own records, and may only clear the flag.
 */
async function markAuthEmailVerified(user: Record<string, any>): Promise<void> {
    if (!user.uid || !user.email || !arccmsOwnsAuthAccount(user)) return;
    try {
        if (user.emailVerified !== true) return;
        const account = await owner.getUser(user.uid);
        if (account.emailVerified || account.email !== String(user.email).toLowerCase()) return;
        await owner.updateUser(user.uid, { emailVerified: true });
    } catch (err) {
        console.error(`Could not mark the Auth email verified for uid=${user.uid}:`, err);
    }
}
