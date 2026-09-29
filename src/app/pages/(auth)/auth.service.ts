/**
 * Auth Service
 *
 * Application-specific authentication service that extends GlobalAuthService.
 * Provides methods for checking existing users via the email_lookup collection
 * (SHA-256 hashed emails — no PII exposed to unauthenticated reads).
 */

import { Injectable, runInInjectionContext } from '@angular/core';
import { collection, doc, getDocs, getDoc, deleteDoc } from '@angular/fire/firestore';
import { catchError, from, switchMap, map, Observable } from 'rxjs';
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
                return from(runInInjectionContext(this.injector, () => {
                    const docRef = doc(this.firestore, EMAIL_LOOKUP_COLLECTION, hash);
                    return getDoc(docRef);
                }));
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
     * Check if this is a first run (no entries in email_lookup collection).
     * Used to detect whether the onboarding wizard should be shown.
     */
    public isFirstRun(): Observable<boolean> {
        const docsPromise = runInInjectionContext(this.injector, () => {
            const colRef = collection(this.firestore, EMAIL_LOOKUP_COLLECTION);
            return getDocs(colRef);
        });
        return from(docsPromise).pipe(
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
        await runInInjectionContext(this.injector, () => {
            const docRef = doc(this.firestore, EMAIL_LOOKUP_COLLECTION, hash);
            return deleteDoc(docRef);
        });
    }
}
