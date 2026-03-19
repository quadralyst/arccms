/**
 * Auth Service
 *
 * Application-specific authentication service that extends GlobalAuthService.
 * Provides methods for checking existing users via the email_lookup collection
 * (SHA-256 hashed emails — no PII exposed to unauthenticated reads).
 */

import { Injectable } from '@angular/core';
import { updateEmail } from '@angular/fire/auth';
import { collection, doc, getDocs, getDoc, setDoc, deleteDoc } from '@angular/fire/firestore';
import { catchError, firstValueFrom, from, switchMap, map, Observable } from 'rxjs';
import { GlobalAuthService } from '../../../shared/services/global-auth.service';
import { IAuth } from './auth.model';
import { hashEmail } from '../../../shared/utils/email-hash.util';

const EMAIL_LOOKUP_COLLECTION = 'email_lookup';

@Injectable({
    providedIn: 'root',
})
export class AuthService extends GlobalAuthService<IAuth> {
    constructor() {
        super('users');
    }

    /**
     * Check if an email already exists by looking up its SHA-256 hash
     * in the `email_lookup` collection.
     *
     * Returns a non-empty array if the email exists, empty array otherwise.
     * This preserves the original API contract used by auth.store.ts.
     */
    public checkAlreadyExist(value: string): Observable<any> {
        return from(hashEmail(value)).pipe(
            switchMap((hash) => {
                const docRef = doc(this.firestore, EMAIL_LOOKUP_COLLECTION, hash);
                return from(getDoc(docRef));
            }),
            map((snapshot) => {
                if (snapshot.exists()) {
                    return [{ exists: true }];
                }
                return [];
            }),
            catchError((error) => {
                console.error('Error checking email existence:', error);
                throw error;
            }),
        );
    }

    /**
     * Add a hashed email entry to the email_lookup collection.
     * Called during signup after the user document is created.
     */
    public async addEmailLookup(email: string): Promise<void> {
        const hash = await hashEmail(email);
        const docRef = doc(this.firestore, EMAIL_LOOKUP_COLLECTION, hash);
        await setDoc(docRef, { exists: true });
    }

    /**
     * Check if this is a first run (no entries in email_lookup collection).
     * Used to detect whether the onboarding wizard should be shown.
     */
    public isFirstRun(): Observable<boolean> {
        const colRef = collection(this.firestore, EMAIL_LOOKUP_COLLECTION);
        return from(getDocs(colRef)).pipe(
            map((snapshot) => snapshot.empty),
            catchError((error) => {
                console.error('Error checking first run status:', error);
                return from([false]);
            }),
        );
    }

    /**
     * Remove a hashed email entry from the email_lookup collection.
     * Called when a user is deleted.
     */
    public async removeEmailLookup(email: string): Promise<void> {
        const hash = await hashEmail(email);
        const docRef = doc(this.firestore, EMAIL_LOOKUP_COLLECTION, hash);
        await deleteDoc(docRef);
    }

    /**
     * Update user email — handles the full flow:
     * 1. Re-authenticate with current password
     * 2. Update email in Firebase Auth
     * 3. Update email in Firestore users doc
     * 4. Swap hashed email in email_lookup collection
     * 5. Set emailVerified to false
     */
    public async updateUserEmail(
        docId: string,
        oldEmail: string,
        newEmail: string,
        currentPassword: string,
    ): Promise<string> {
        const user = this.firebaseAuth.currentUser;
        if (!user) {
            return 'auth/no-current-user';
        }

        try {
            // Re-authenticate (Firebase requires this for email change)
            await this.reAuthenticate(user, currentPassword);

            // Update email in Firebase Auth
            await updateEmail(user, newEmail);

            // Update Firestore user doc
            await firstValueFrom(super.update(docId, { email: newEmail, emailVerified: false }));

            // Swap email_lookup hashes (add new first to avoid losing the entry if remove succeeds but add fails)
            await this.addEmailLookup(newEmail);
            await this.removeEmailLookup(oldEmail);

            return 'Email updated';
        } catch (error: any) {
            return error.code || 'unknown-error';
        }
    }
}
