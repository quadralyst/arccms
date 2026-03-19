/**
 * Auth Store
 * 
 * NgRx Signals store for managing authentication state.
 * Provides methods for login, signup, logout, and user profile management.
 */

import { inject } from '@angular/core';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { Router } from '@angular/router';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { catchError, finalize, map, Observable, of, tap, throwError } from 'rxjs';
import { ConstantVariables } from '../../../shared/constants';
import { OmitCommonFields } from '../../../shared/models/base-model';
import { QueryParams, WhereCondition } from '../../../shared/models';
import { ToastService } from '../../../shared/services/toast.service';
import { IAuth } from './auth.model';
import { AuthService } from './auth.service';

type AuthState = {
    currentUser: IAuth | null;
    allUsers: any[];
    isLoading: boolean;
    isSuccess: boolean;
    error: string;
    errorCode: string;
    query: string;
    firstVisible: null;
    lastVisible: null;
    limit: number;
    sortField: string;
    order: 'asc' | 'desc';
    previousPageNumber: number;
    currentPageNumber: number;
    whereConditions: WhereCondition[];
    isAuthenticated: boolean;
    isAdmin: boolean;
    isOnBoardingComplete: boolean;
    accessToken?: string;
};

const initialState: AuthState = {
    currentUser: null,
    allUsers: [],
    isLoading: false,
    isSuccess: false,
    error: '',
    errorCode: '',
    query: '',
    firstVisible: null,
    lastVisible: null,
    limit: 10,
    sortField: '',
    order: 'desc',
    previousPageNumber: -1,
    currentPageNumber: 0,
    whereConditions: [],
    isAuthenticated: false,
    isAdmin: false,
    isOnBoardingComplete: false,
    accessToken: '',
};

export const AuthState = signalStore(
    { providedIn: 'root' },
    withState(initialState),

    withMethods(
        (
            store,
            authService = inject(AuthService),
            auth: Auth = inject(Auth),
            router: Router = inject(Router),
            constant = inject(ConstantVariables),
            toastService = inject(ToastService),
        ) => ({
            clearCurrent() {
                patchState(store, { currentUser: null, isLoading: false, isSuccess: true, error: '' });
            },

            getAll(queryParams?: QueryParams): void {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });

                const defaultQueryParams: QueryParams = {
                    limitCount: store.limit(),
                    orderByField: store.sortField(),
                    orderByDirection: store.order(),
                    startAfterDoc: store.lastVisible(),
                    endBeforeDoc: store.firstVisible(),
                    whereConditions: store.whereConditions(),
                    currentPageNumber: 0,
                    previousPageNumber: 0,
                };

                queryParams = { ...defaultQueryParams, ...queryParams };
                authService.getAll(queryParams).subscribe({
                    next: (result) => {
                        patchState(store, {
                            allUsers: result.collectionData,
                            isLoading: false,
                            isSuccess: true,
                            error: '',
                            whereConditions: queryParams!.whereConditions,
                            limit: queryParams!.limitCount,
                            sortField: queryParams!.orderByField,
                            order: queryParams!.orderByDirection,
                            previousPageNumber: queryParams!.previousPageNumber,
                            currentPageNumber: queryParams!.currentPageNumber,
                        });
                    },
                    error: (error) => {
                        patchState(store, {
                            error: error.message,
                            isLoading: false,
                        });
                    },
                });
            },

            login(form: any) {
                patchState(store, { isLoading: true, error: '', isSuccess: false });

                authService
                    .login(form.email, form.password)
                    .pipe(
                        tap((res) => {
                            if (res && res.uid) {
                                const message = 'Logged in successfully.';
                                toastService.success(message);
                            }
                        }),
                        catchError((err) => {
                            console.error('Login error:', err.code);
                            const findMessage = constant.firebaseAuthErrors.filter((item) => item.code === err.code);
                            patchState(store, { isLoading: false, isSuccess: false, error: findMessage[0]?.message });
                            return of(null);
                        }),
                        finalize(() => {
                            patchState(store, { isLoading: false });
                        }),
                    )
                    .subscribe();
            },

            signup(form: any): void {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });

                authService
                    .register(form)
                    .pipe(
                        tap((res) => {
                            form.uid = res.uid;
                            delete form.password;

                            // Write the user document first, then query it — avoids race condition
                            // where getCurrentUserByUid fires before the doc exists.
                            authService.add(form).subscribe({
                                next: (docId) => {
                                    if (res && res.uid) {
                                        authService.getCurrentUserByUid(res.uid).subscribe((user) => {
                                            patchState(store, { currentUser: user, isLoading: false, error: '', isSuccess: true });
                                        });
                                    }
                                },
                                error: (err) => {
                                    console.error('Failed to create user document:', err);
                                    patchState(store, { isLoading: false, error: 'Failed to create user profile', isSuccess: false });
                                },
                            });
                        }),
                        catchError((err) => {
                            console.error('Signup error:', err.code);
                            let errorMessage = 'Something went wrong!';
                            if (err.code === 'auth/email-already-in-use') {
                                errorMessage = 'User already exists!';
                            } else if (err.code === 'auth/invalid-email') {
                                errorMessage = 'Invalid email address!';
                            } else if (err.code === 'auth/operation-not-allowed') {
                                errorMessage = 'This sign-in method is not enabled. Please check your Firebase Authentication settings.';
                            }
                            patchState(store, { isLoading: false, error: errorMessage, errorCode: err.code || '', isSuccess: false });
                            return of(null);
                        }),
                        finalize(() => {
                            patchState(store, { isLoading: false });
                        }),
                    )
                    .subscribe();
            },

            logout(): Observable<void> {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });
                return authService.logout().pipe(
                    tap((res) => {
                        patchState(store, {
                            currentUser: null,
                            isLoading: false,
                            isSuccess: true,
                            error: '',
                            isAuthenticated: false,
                        });
                    }),
                    catchError((error) => {
                        console.error('Logout failed', error);
                        patchState(store, {
                            isLoading: false,
                            isSuccess: false,
                            error: error.message || 'Logout failed',
                        });
                        return throwError(() => error);
                    }),
                );
            },

            async updateUserProfile(id: string, updatedFields: Partial<OmitCommonFields<IAuth>>) {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });

                const oldCurrentUser = store.currentUser();
                try {
                    const result = await authService.updateUser(id, updatedFields);
                    if (result === 'auth/wrong-password' || result === 'auth/too-many-requests') {
                        patchState(store, { isLoading: false, isSuccess: false, error: result });
                    } else if (result === 'Profile updated') {
                        patchState(store, {
                            isLoading: false,
                            isSuccess: true,
                            error: '',
                            currentUser: oldCurrentUser
                                ? { ...oldCurrentUser, ...updatedFields } as IAuth
                                : null,
                        });
                    } else {
                        patchState(store, {
                            isLoading: false,
                            isSuccess: false,
                            error: result || 'An error occurred while updating the profile',
                        });
                    }
                } catch (error: any) {
                    patchState(store, { isLoading: false, isSuccess: false, error: error.message });
                } finally {
                    patchState(store, { isLoading: false });
                }
            },

            async changePassword(passwordData: { currentPassword: string; newPassword: string }) {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });
                try {
                    const result = await authService.updatePassword(passwordData);
                    if (result === 'Password updated') {
                        patchState(store, { isLoading: false, isSuccess: true, error: '' });
                    } else {
                        const findMessage = constant.firebaseAuthErrors.filter(
                            (item) => item.code === result,
                        );
                        const errorMsg =
                            findMessage.length > 0
                                ? findMessage[0].message
                                : result || 'Failed to update password';
                        patchState(store, { isLoading: false, isSuccess: false, error: errorMsg });
                    }
                } catch (error: any) {
                    patchState(store, { isLoading: false, isSuccess: false, error: error.message });
                }
            },

            async changeEmail(docId: string, oldEmail: string, newEmail: string, currentPassword: string) {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });
                const oldCurrentUser = store.currentUser();
                try {
                    const result = await authService.updateUserEmail(docId, oldEmail, newEmail, currentPassword);
                    if (result === 'Email updated') {
                        patchState(store, {
                            isLoading: false,
                            isSuccess: true,
                            error: '',
                            currentUser: oldCurrentUser
                                ? { ...oldCurrentUser, email: newEmail, emailVerified: false } as IAuth
                                : null,
                        });
                    } else {
                        const findMessage = constant.firebaseAuthErrors.filter(
                            (item) => item.code === result,
                        );
                        const errorMsg =
                            findMessage.length > 0
                                ? findMessage[0].message
                                : result || 'Failed to update email';
                        patchState(store, { isLoading: false, isSuccess: false, error: errorMsg });
                    }
                } catch (error: any) {
                    patchState(store, { isLoading: false, isSuccess: false, error: error.message });
                }
            },

            async forgotPassword(email: string) {
                patchState(store, { isLoading: true, isSuccess: false, error: '' });

                try {
                    const result = await authService.forgotPassword(email);

                    if (result && result.status === 200) {
                        patchState(store, { isLoading: false, isSuccess: true, error: '' });
                        return result;
                    } else {
                        patchState(store, { isLoading: false, isSuccess: false, error: '' });
                        return result;
                    }
                } catch (error: any) {
                    patchState(store, { isLoading: false, isSuccess: false, error: error.message });
                } finally {
                    patchState(store, { isLoading: false });
                }
            },

            async checkItemNumberExist(value: string) {
                return authService.checkAlreadyExist(value).pipe(
                    map((res: any) => {
                        if (res && res.length) {
                            return res;
                        }
                        return null;
                    }),
                );
            },

            clearList() {
                patchState(store, initialState);
            },

            initAuthStateListener(): Observable<User | null> {
                return new Observable<User | null>((observer) => {
                    const unsubscribe = onAuthStateChanged(
                        auth,
                        (user) => {
                            if (user) {
                                if (user && user.uid) {
                                    authService.getCurrentUserByUid(user.uid).subscribe(async (userData: any) => {
                                        if (userData) {
                                            const currentUser = {
                                                ...userData,
                                                isAdmin: userData.role === constant.fixedRoles[0].userType || false,
                                            };
                                            if (!userData.isActive) {
                                                this.logout().subscribe(() => {
                                                    router.navigate(['/signup']);
                                                });
                                                return;
                                            }

                                            // Force-refresh the ID token so Firestore security rules
                                            // see the latest custom claims (e.g. role: 'admin').
                                            // Without this, the token issued at login may not yet
                                            // contain claims set by the onUserRoleChange Cloud Function.
                                            if (currentUser.isAdmin) {
                                                try {
                                                    await user.getIdToken(true);
                                                } catch (err) {
                                                    console.warn('Token refresh failed (non-fatal):', err);
                                                }
                                            }

                                            patchState(store, {
                                                currentUser,
                                                isLoading: false,
                                                error: '',
                                                isSuccess: userData.role !== constant.USER ? true : false,
                                                isAuthenticated: userData.role !== constant.USER ? true : false,
                                                isAdmin: currentUser.isAdmin,
                                                isOnBoardingComplete: userData?.isOnBoardingComplete || false,
                                            });
                                            observer.next(currentUser);
                                        } else {
                                            // Firebase has an authenticated user but no matching Firestore doc —
                                            // treat as unauthenticated so guards don't hang waiting for a value.
                                            patchState(store, { currentUser: null, isAuthenticated: false });
                                            observer.next(null);
                                        }
                                    });
                                }
                            } else {
                                patchState(store, { currentUser: null, isAuthenticated: false });
                                observer.next(null);
                            }
                        },
                        (error) => {
                            console.error('Auth state change error:', error);
                            patchState(store, { error: error.message });
                            observer.error(error);
                        },
                    );

                    return unsubscribe;
                });
            },
        }),
    ),

    withHooks({
        onInit(store) {
            const subscription = store.initAuthStateListener().subscribe();
            return () => subscription.unsubscribe();
        },
    }),
);
