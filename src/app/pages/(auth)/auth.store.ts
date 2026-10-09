/**
 * Auth Store
 * 
 * NgRx Signals store for managing authentication state.
 * Provides methods for login, signup, logout, and user profile management.
 */

import { inject, Injector, runInInjectionContext } from '@angular/core';
import { Auth, onAuthStateChanged, User } from '@angular/fire/auth';
import { rememberSignedIn } from '../../core/site/signed-in-hint';
import { Router } from '@angular/router';
import { patchState, signalStore, withHooks, withMethods, withState } from '@ngrx/signals';
import { BehaviorSubject, catchError, distinctUntilChanged, filter, finalize, firstValueFrom, from, map, Observable, of, Subscription, switchMap, tap, throwError } from 'rxjs';
import { ConstantVariables } from '../../../shared/constants';
import { OmitCommonFields } from '../../../shared/models/base-model';
import { QueryParams, WhereCondition } from '../../../shared/models';
import { ToastService } from '../../../shared/services/toast.service';
import { IAuth } from './auth.model';
import { isLockedAppAccount } from '../../core/app-accounts/app-account-lock';
import { AuthService } from './auth.service';
import { readSignInError, SignInService } from './sign-in.service';
import { TranslocoService } from '@jsverse/transloco';
import { BLOCKED_KEY, FALLBACK_KEY, NO_ACCESS_KEY, UNFINISHED_SIGNUP_KEY, firebaseErrorMessage, type Translate } from './auth-messages';

/** Signed in with a valid password but no ArcCMS record: no access (CO6.6). */
export const NO_ACCESS_CODE = 'arccms/no-access';
/** Signed in with a valid password, but an admin blocked the account. */
export const BLOCKED_CODE = 'arccms/blocked';
// The messages, as translation keys (auth-messages.ts, specs/app-member-language-spec.md).
export { BLOCKED_KEY, NO_ACCESS_KEY, UNFINISHED_SIGNUP_KEY } from './auth-messages';

/** Answers from createAccountRecord that mean it wrote nothing: safe to remove the new sign-in. */
const RECORD_REFUSALS = ['already-exists', 'failed-precondition', 'invalid-argument', 'permission-denied', 'unauthenticated'];

/**
 * Create the account record after a sign-up, retrying what may be a slow start
 * or a lost reply (review F). createAccountRecord returns the record when it
 * already exists, so a retry never makes a second one.
 *
 *   ok       the record exists
 *   refused  the server wrote nothing (sign-ups closed, email taken): the new
 *            sign-in can go
 *   unknown  still failing: the record may exist, so the sign-in stays. Deleting
 *            it could leave a record whose email nobody can sign up with again.
 */
export async function createRecordWithRetry(
    create: () => Promise<unknown>,
    wait: (ms: number) => Promise<void> = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
): Promise<{ outcome: 'ok' } | { outcome: 'refused' | 'unknown'; error: unknown }> {
    let last: unknown;
    for (const delay of [0, 1500, 4000]) {
        if (delay) await wait(delay);
        try {
            await create();
            return { outcome: 'ok' };
        } catch (err) {
            last = err;
            if (RECORD_REFUSALS.includes(readSignInError(err).code)) return { outcome: 'refused', error: err };
        }
    }
    return { outcome: 'unknown', error: last };
}

/** How long a cached "no record" or "inactive" waits for the server before it counts (offline). */
export const CACHED_VERDICT_WAIT_MS = 10_000;

/** The shared record: `seq` counts sign-in changes, `settled` once the current one's record is known. */
type SharedRecord = { seq: number; settled: boolean; record: IAuth | null };
/** One answer of the live read: the record, and whether it is the device's copy. */
type RecordAnswer = { data: (IAuth & { isOnBoardingComplete?: boolean }) | null; fromCache: boolean };

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
            injector = inject(Injector),
            transloco = inject(TranslocoService),
        ) => {
            // Messages in the person's language (specs/app-member-language-spec.md, A1b).
            const say: Translate = (key, params) => transloco.translate(key, params);
            // Looked up when first needed, so everything that only reads the auth
            // state does not also need Firebase Functions.
            const signIn = () => injector.get(SignInService);
            const methods = {
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
                            // A valid password is not access: the sign-in pool can be shared
                            // with another app (CO6.6), whose users have no ArcCMS record.
                            // Sign them straight out with a reason instead of leaving them
                            // signed in to Firebase and treated as nobody.
                            switchMap((res) => {
                                if (!res?.uid) return of(res);
                                return authService.getCurrentUserByUid(res.uid).pipe(
                                    switchMap((user: any) => {
                                        // Load the record into the store here rather than waiting for
                                        // the auth listener: signing in again as the person already
                                        // signed in (right after a sign-up, say) fires no auth change,
                                        // so the page would wait for ever.
                                        if (user && user.isActive !== false) return from(this.refreshCurrentUser()).pipe(map(() => res));
                                        if (!user) {
                                            // A sign-up whose record creation never answered (see signup):
                                            // finish it now. The server refuses when sign-ups are closed or
                                            // the login is older than a day (another app's user, most
                                            // likely), and then this is no access.
                                            const name = String((res as { displayName?: string }).displayName || form.email.split('@')[0]).trim();
                                            return from(createRecordWithRetry(() => signIn().createAccountRecord(name.length >= 2 ? name : say('user.member'), { finish: true }))).pipe(
                                                switchMap((result) => (result.outcome === 'ok'
                                                    ? from(this.refreshCurrentUser()).pipe(map(() => res))
                                                    : authService.logout().pipe(
                                                        tap(() => patchState(store, { error: say(NO_ACCESS_KEY), errorCode: NO_ACCESS_CODE, isSuccess: false })),
                                                        map(() => null),
                                                    ))),
                                            );
                                        }
                                        const [error, errorCode] = [say(BLOCKED_KEY), BLOCKED_CODE];
                                        return authService.logout().pipe(
                                            tap(() => patchState(store, { error, errorCode, isSuccess: false })),
                                            map(() => null),
                                        );
                                    }),
                                );
                            }),
                            tap((res) => {
                                if (res && res.uid) {
                                    toastService.success(say('member.auth.logged_in'));
                                }
                            }),
                            catchError((err) => {
                                console.error('Login error:', err.code);
                                patchState(store, { isLoading: false, isSuccess: false, error: firebaseErrorMessage(say, err.code), errorCode: err.code || '' });
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

                    // Busy until the record exists, not just the sign-in: creating the record
                    // can take seconds (a cold function), and an idle-looking button invited a
                    // second press, which failed with "email already in use".
                    authService
                        .register(form)
                        .pipe(
                            tap((res) => {
                                // The server writes the record, with the site's default role and
                                // the `arccms_uid` claim (docs/app/account-contract.html), so the token
                                // carries the claim when sign-up completes. Then read the record.
                                createRecordWithRetry(() => signIn().createAccountRecord(form.name))
                                    .then(async (result) => {
                                        if (result.outcome === 'ok') {
                                            await this.refreshCurrentUser();
                                            patchState(store, { isLoading: false, error: '', isSuccess: true });
                                            return;
                                        }
                                        console.error('Failed to create the account record:', result.error);
                                        const error = readSignInError(result.error, say(FALLBACK_KEY));
                                        if (result.outcome === 'refused') {
                                            // Nothing was written: leave no sign-in behind, so the person can simply try again.
                                            await res.delete().catch(() => undefined);
                                            patchState(store, { isLoading: false, error: error.message, errorCode: error.code, isSuccess: false });
                                        } else {
                                            patchState(store, { isLoading: false, error: say(UNFINISHED_SIGNUP_KEY), errorCode: error.code, isSuccess: false });
                                        }
                                    })
                                    .catch((err) => {
                                        console.error('Failed to load the new account:', err);
                                        patchState(store, { isLoading: false, error: say(UNFINISHED_SIGNUP_KEY), isSuccess: false });
                                    });
                            }),
                            catchError((err) => {
                                console.error('Signup error:', err.code);
                                patchState(store, { isLoading: false, error: firebaseErrorMessage(say, err.code), errorCode: err.code || '', isSuccess: false });
                                return of(null);
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
                                error: error.message || say('member.auth.logout_failed'),
                            });
                            return throwError(() => error);
                        }),
                    );
                },

                async updateUserProfile(id: string, updatedFields: Partial<OmitCommonFields<IAuth>>) {
                    patchState(store, { isLoading: true, isSuccess: false, error: '' });

                    const oldCurrentUser = store.currentUser();
                    // A locked app account keeps the name and photo its app gave it: refused
                    // here before Firebase's own profile changes, as the rules refuse the record.
                    if (isLockedAppAccount(oldCurrentUser) && ('name' in updatedFields || 'photo' in updatedFields)) {
                        patchState(store, { isLoading: false, isSuccess: false, error: say('member.profile.app_managed') });
                        return;
                    }
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
                                error: result || say('member.auth.profile_update_failed'),
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
                    if (isLockedAppAccount(store.currentUser())) {
                        patchState(store, { isLoading: false, isSuccess: false, error: say('member.profile.app_managed') });
                        return;
                    }
                    try {
                        const result = await authService.updatePassword(passwordData);
                        if (result === 'Password updated') {
                            patchState(store, { isLoading: false, isSuccess: true, error: '' });
                        } else {
                            // A Firebase code reads as its message; anything else is shown as it came.
                            const errorMsg = result && result.startsWith('auth/')
                                ? firebaseErrorMessage(say, result, 'member.auth.password_update_failed')
                                : result || say('member.auth.password_update_failed');
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

                /**
                 * Read the signed-in person's record again. Google sign-in needs it:
                 * Firebase reports the sign-in before `ensureGoogleAccount` has
                 * created a first-timer's record, so the listener found none.
                 */
                async refreshCurrentUser(): Promise<IAuth | null> {
                    const user = auth.currentUser;
                    if (!user) return null;
                    const userData: any = await firstValueFrom(authService.getCurrentUserByUid(user.uid));
                    if (!userData) {
                        patchState(store, { currentUser: null, isAuthenticated: false });
                        return null;
                    }
                    const isAdmin = userData.role === constant.fixedRoles[0].userType;
                    const currentUser = { ...userData, isAdmin } as IAuth;
                    // As the auth listener does: the token must carry the claims first.
                    try {
                        await signIn().ensureRecordClaim(userData.id, userData.role);
                        if (isAdmin) await user.getIdToken(true);
                    } catch (err) {
                        console.warn('Could not refresh account claims (non-fatal):', err);
                    }
                    patchState(store, {
                        currentUser,
                        isLoading: false,
                        error: '',
                        isSuccess: userData.role !== constant.USER,
                        isAuthenticated: userData.role !== constant.USER,
                        isAdmin,
                        isOnBoardingComplete: userData?.isOnBoardingComplete || false,
                    });
                    // Whoever waits on recordReady (a sign-up whose record the live read has
                    // not seen yet) has it now.
                    if (auth.currentUser?.uid === user.uid) settle(shared.value.seq, currentUser);
                    return currentUser;
                },

                /**
                 * The signed-in person's record, once known: null for nobody signed in, and for
                 * a Firebase sign-in with no matching record (it counts as signed out). One
                 * live read per sign-in, shared by every guard and page that asks, and the
                 * device's copy is used when it has one, so a later visit opens without
                 * waiting for the server (docs/app/pages-and-routes.html).
                 */
                recordReady(): Promise<IAuth | null> {
                    startRecord();
                    return firstValueFrom(shared.pipe(filter((state) => state.settled), map((state) => state.record)));
                },

                /**
                 * The record as each sign-in or sign-out settles (recordReady), for callers that
                 * follow the person over time. Backed by the one shared read: subscribing
                 * starts no listener or query of its own.
                 */
                initAuthStateListener(): Observable<IAuth | null> {
                    startRecord();
                    return shared.pipe(
                        filter((state) => state.settled),
                        distinctUntilChanged((a, b) => a.seq === b.seq),
                        map((state) => state.record),
                    );
                },

                _startRecord: () => startRecord(),
                _stopRecord: () => stopRecord(),
            };

            // --- The shared record (recordReady) ---------------------------------------
            //
            // One auth listener; on each sign-in, one live read of the person's record. The
            // device's copy settles the record at once when it shows an active account; a
            // cached "no record" or "inactive" waits for the server's word (or, with no
            // server, CACHED_VERDICT_WAIT_MS), since signing someone out on an old copy
            // would be wrong. The server's copy follows and keeps the store up to date.

            const shared = new BehaviorSubject<SharedRecord>({ seq: 0, settled: false, record: null });
            let stopAuth: (() => void) | undefined;
            let recordRead: Subscription | undefined;
            let verdictTimer: ReturnType<typeof setTimeout> | undefined;
            let claims: { key: string; done: Promise<void> } | undefined;
            let signingOut = false;

            const settle = (seq: number, record: IAuth | null) => {
                if (shared.value.seq === seq) shared.next({ seq, settled: true, record });
            };
            const noRecord = (seq: number) => {
                if (shared.value.seq !== seq) return;
                patchState(store, { currentUser: null, isAuthenticated: false });
                settle(seq, null);
            };

            /**
             * Once per sign-in (and again only if the record or its role changes). The
             * `arccms_uid` claim (the record id) must be in the token before sign-in
             * completes: apps and rules rely on it (docs/app/account-contract.html).
             * Accounts made before it existed get it here. Non-fatal: rules simply deny
             * without it. An admin's token is also refreshed, in the background: the
             * claim check above already refreshed it when its claims were out of date.
             */
            const claimsOnce = (user: User, recordId: string, role: string | undefined, isAdmin: boolean) => {
                const key = `${user.uid}|${recordId}|${role ?? ''}`;
                if (claims?.key !== key) {
                    claims = {
                        key,
                        done: (async () => {
                            let refreshed = false;
                            try {
                                refreshed = await signIn().ensureRecordClaim(recordId, role);
                            } catch (err) {
                                console.warn('Could not refresh account claims (non-fatal):', err);
                            }
                            if (isAdmin && !refreshed) {
                                user.getIdToken(true).catch((err) => console.warn('Token refresh failed (non-fatal):', err));
                            }
                        })(),
                    };
                }
                return claims.done;
            };

            const readRecord = (seq: number, user: User) => {
                let timedOut = false;
                let last: RecordAnswer | undefined;
                let answers = 0;
                let applied = 0;
                const onAnswer = async (answer: RecordAnswer) => {
                    if (shared.value.seq !== seq) return;
                    last = answer;
                    const n = ++answers;
                    const { data, fromCache } = answer;
                    const trusted = !fromCache || timedOut;
                    if (!data) {
                        // Firebase has a sign-in but no matching record: signed out, as before.
                        if (trusted) {
                            applied = n;
                            noRecord(seq);
                        }
                        return;
                    }
                    if (!data.isActive) {
                        if (trusted && !signingOut) {
                            signingOut = true;
                            methods.logout().subscribe({ next: () => void router.navigate(['/signup']), error: () => undefined });
                        }
                        return;
                    }
                    const isAdmin = data.role === constant.fixedRoles[0].userType || false;
                    const currentUser = { ...data, isAdmin } as IAuth;
                    await claimsOnce(user, data.id, data.role, isAdmin);
                    // A later answer may have landed while the claims were checked.
                    if (shared.value.seq !== seq || n < applied) return;
                    applied = n;
                    const fields = {
                        currentUser,
                        isAuthenticated: data.role !== constant.USER,
                        isAdmin,
                        isOnBoardingComplete: data.isOnBoardingComplete || false,
                    };
                    if (!shared.value.settled) {
                        patchState(store, { ...fields, isLoading: false, error: '', isSuccess: data.role !== constant.USER });
                    } else if (JSON.stringify(currentUser) !== JSON.stringify(store.currentUser())) {
                        // A later copy (the server's, or a change since): the record only, so a
                        // page's own isLoading, error or isSuccess is left alone, and an
                        // unchanged copy changes nothing.
                        patchState(store, fields);
                    }
                    settle(seq, currentUser);
                };
                verdictTimer = setTimeout(() => {
                    timedOut = true;
                    if (last && !shared.value.settled) void onAnswer(last);
                }, CACHED_VERDICT_WAIT_MS);
                recordRead = authService.watchCurrentUserByUid(user.uid).subscribe({
                    next: (answer) => void onAnswer(answer as RecordAnswer),
                    error: (err) => {
                        // As a failed read always did: no record, so signed out.
                        console.error('Could not read the account record:', err);
                        noRecord(seq);
                    },
                });
            };

            const onAuthChange = (user: User | null) => {
                // For the published pages' signed-in hint (arc-site.js).
                rememberSignedIn(!!user);
                recordRead?.unsubscribe();
                recordRead = undefined;
                clearTimeout(verdictTimer);
                claims = undefined;
                signingOut = false;
                const seq = shared.value.seq + 1;
                shared.next({ seq, settled: false, record: null });
                if (user?.uid) readRecord(seq, user);
                else noRecord(seq);
            };

            function startRecord() {
                if (stopAuth) return;
                stopAuth = runInInjectionContext(injector, () => onAuthStateChanged(auth, onAuthChange, (error) => {
                    console.error('Auth state change error:', error);
                    patchState(store, { error: error.message });
                    noRecord(shared.value.seq);
                }));
            }

            function stopRecord() {
                stopAuth?.();
                stopAuth = undefined;
                recordRead?.unsubscribe();
                recordRead = undefined;
                clearTimeout(verdictTimer);
            }

            return methods;
        },
    ),

    withHooks((store) => ({
        onInit: () => store._startRecord(),
        // On the server each render has its own store but shares one Auth, so a listener
        // left behind kept every rendered page (and, in dev, every old dev server) in memory.
        onDestroy: () => store._stopRecord(),
    })),
);
