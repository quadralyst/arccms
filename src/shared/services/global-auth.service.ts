/**
 * Global Auth Service
 * 
 * Provides Firebase authentication methods including:
 * - Email/password registration and login
 * - Google Sign-In
 * - Password management
 * - User profile updates
 */

import { Inject, inject, Injectable, InjectionToken } from '@angular/core';
import {
    Auth,
    createUserWithEmailAndPassword,
    EmailAuthProvider,
    reauthenticateWithCredential,
    sendPasswordResetEmail,
    signInWithEmailAndPassword,
    signOut,
    updatePassword,
    updateProfile,
    User,
} from '@angular/fire/auth';
import { firstValueFrom, from, Observable } from 'rxjs';
import { IAuth } from '../../app/pages/(auth)/auth.model';
import { OmitCommonFields } from '../models/base-model';
import { DbService, COLLECTION_NAME } from './db.service';

@Injectable({
    providedIn: 'root',
})
export class GlobalAuthService<T extends IAuth> extends DbService<IAuth> {
    constructor(@Inject(COLLECTION_NAME) collectionName: string) {
        super(collectionName);
    }

    firebaseAuth = inject(Auth);

    register(formData: OmitCommonFields<IAuth>): Observable<User> {
        return new Observable<User>((observer) => {
            createUserWithEmailAndPassword(this.firebaseAuth, formData.email, formData.password as string)
                .then(async (credentials) => {
                    const user = credentials.user;
                    delete formData.password;

                    try {
                        await Promise.all([updateProfile(user, { displayName: formData.name })]);
                        observer.next(user);
                        observer.complete();
                    } catch (error) {
                        observer.error(error);
                    }
                })
                .catch((error) => observer.error(error));
        });
    }

    login(email: string, password: string): Observable<User> {
        return new Observable<User>((observer) => {
            signInWithEmailAndPassword(this.firebaseAuth, email, password)
                .then((credentials) => {
                    const user = credentials.user;
                    observer.next(user);
                    observer.complete();
                })
                .catch((error) => observer.error(error));
        });
    }

    logout(): Observable<void> {
        return from(
            (async () => {
                await signOut(this.firebaseAuth);
            })(),
        );
    }

    async updateUser(docId: string, updatedFields: Partial<OmitCommonFields<IAuth>>): Promise<string> {
        const user = this.firebaseAuth.currentUser;
        if (!user) {
            return 'auth/no-current-user';
        }

        try {
            // Update Firebase Auth profile (displayName and/or photoURL)
            const profileUpdate: { displayName?: string | null; photoURL?: string | null } = {};
            if (updatedFields.name !== undefined) {
                profileUpdate.displayName = updatedFields.name;
            }
            if (updatedFields.photo !== undefined) {
                profileUpdate.photoURL = updatedFields.photo || null;
            }
            if (Object.keys(profileUpdate).length > 0) {
                await updateProfile(user, profileUpdate);
            }

            // Strip password before Firestore write
            const firestoreFields = { ...updatedFields };
            delete firestoreFields.password;

            await firstValueFrom(super.update(docId, firestoreFields));
            return 'Profile updated';
        } catch (error: any) {
            return error.code || 'unknown-error';
        }
    }

    async reAuthenticate(user: any, password: string): Promise<any> {
        const credential = EmailAuthProvider.credential(user.email, password);
        return reauthenticateWithCredential(user, credential);
    }

    async updatePassword(userData: { currentPassword: string; newPassword: string }): Promise<string> {
        const user = this.firebaseAuth.currentUser;
        if (!user) return 'auth/no-current-user';

        try {
            const resp = await this.reAuthenticate(user, userData.currentPassword);
            if (resp.code === 'auth/wrong-password' || resp.code === 'auth/too-many-requests') {
                return resp.code;
            } else {
                await updatePassword(user, userData.newPassword);
                return 'Password updated';
            }
        } catch (error: any) {
            return error.code;
        }
    }

    getCurrentUserByUid(id: string) {
        return super.getByCustomField('uid', '==', id);
    }

    async forgotPassword(email: string): Promise<any> {
        try {
            await sendPasswordResetEmail(this.firebaseAuth, email);
            return {
                message: 'mail sent',
                status: 200,
            };
        } catch (error: any) {
            return error.code;
        }
    }

}
