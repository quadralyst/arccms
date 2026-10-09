/**
 * The signed-in person's record, shared (AuthState.recordReady). A signed-in page opens
 * on the device's copy of the record without waiting for the server, and one sign-in
 * makes one record read, whatever the number of guards and pages asking.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Injector, PLATFORM_ID, runInInjectionContext } from '@angular/core';
import { Router } from '@angular/router';
import { Auth, onAuthStateChanged } from '@angular/fire/auth';
import { firstValueFrom, Observable, of, Subject } from 'rxjs';

const listener = vi.hoisted(() => ({ fire: (_user: unknown) => undefined as void }));
vi.mock('@angular/fire/auth', () => ({
    Auth: class {},
    onAuthStateChanged: vi.fn((_auth: unknown, next: (user: unknown) => void) => {
        listener.fire = next;
        return () => undefined;
    }),
}));

import { AuthState, CACHED_VERDICT_WAIT_MS } from './auth.store';
import { AuthService } from './auth.service';
import { SignInService } from './sign-in.service';
import { ToastService } from '../../../shared/services/toast.service';
import { EntitlementService } from '../user/entitlement.service';
import { entitledGuard, memberPagesGuard, userGuard } from '../user/user.guards';
import { roleGuard } from '../../guards/role.guard';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

type Answer = { data: Record<string, unknown> | null; fromCache: boolean };

describe('AuthState shared record (recordReady)', () => {
    /** The live read of the record: answers are pushed by each test, the server's never comes unless sent. */
    let read: Subject<Answer>;
    const authService = {
        watchCurrentUserByUid: vi.fn(() => read.asObservable()),
        getCurrentUserByUid: vi.fn(),
        logout: vi.fn(() => of(undefined)),
    };
    const signIn = { ensureRecordClaim: vi.fn(async () => false) };
    const router = { navigate: vi.fn(async () => true), createUrlTree: vi.fn((commands: unknown[]) => ({ urlTree: commands })), parseUrl: vi.fn() };
    const getIdToken = vi.fn(async () => 'token');
    const user = { uid: 'uid-1', getIdToken };
    const record = { id: 'doc-1', uid: 'uid-1', name: 'Anna', role: 'user', isActive: true };

    beforeEach(() => {
        vi.clearAllMocks();
        read = new Subject<Answer>();
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [translocoTestingModule()],
            providers: [
                AuthState,
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: AuthService, useValue: authService },
                { provide: ToastService, useValue: { openCustomSnackbar: vi.fn() } },
                { provide: Auth, useValue: { currentUser: user } },
                { provide: SignInService, useValue: signIn },
                { provide: Router, useValue: router },
                { provide: EntitlementService, useValue: { load: vi.fn(() => of({ isPro: true })) } },
            ],
        });
    });

    afterEach(() => vi.useRealTimers());

    const store = () => TestBed.inject(AuthState);

    /** Whether the promise has settled by now, without waiting for it. */
    async function settled<T>(promise: Promise<T>): Promise<{ done: boolean; value?: T }> {
        const marker = Symbol('pending');
        const value = await Promise.race([promise, new Promise((resolve) => setTimeout(() => resolve(marker), 0))]);
        return value === marker ? { done: false } : { done: true, value: value as T };
    }

    function guard(fn: (...args: any[]) => any, data?: Record<string, unknown>) {
        const result = runInInjectionContext(TestBed.inject(Injector), () => fn({ data }, { url: '/learn' }));
        return firstValueFrom(result as Observable<unknown>);
    }

    it('opens a signed-in page on the device copy while the server never answers', async () => {
        const auth = store();
        listener.fire(user);
        read.next({ data: record, fromCache: true });
        // No server answer at all: Firestore unreachable, or slow.
        expect(await guard(userGuard)).toBe(true);
        expect(await guard(memberPagesGuard)).toBe(true);
        expect(await guard(roleGuard, { allowedRoles: ['user'] })).toBe(true);
        expect(await guard(entitledGuard)).toBe(true);
        expect(auth.currentUser()).toMatchObject({ id: 'doc-1', name: 'Anna' });
    });

    it('makes one record read per sign-in, whatever the number of guards and listeners', async () => {
        const auth = store();
        const emitted: unknown[] = [];
        auth.initAuthStateListener().subscribe((value) => emitted.push(value));
        auth.initAuthStateListener().subscribe();
        listener.fire(user);
        read.next({ data: record, fromCache: true });
        await Promise.all([guard(userGuard), guard(memberPagesGuard), guard(roleGuard, { allowedRoles: ['user'] }), auth.recordReady()]);
        read.next({ data: { ...record, name: 'Anna B' }, fromCache: false });
        await vi.waitFor(() => expect(auth.currentUser()?.name).toBe('Anna B'));

        expect(onAuthStateChanged).toHaveBeenCalledTimes(1);
        expect(authService.watchCurrentUserByUid).toHaveBeenCalledTimes(1);
        expect(authService.getCurrentUserByUid).not.toHaveBeenCalled();
        // The claim check runs once for the sign-in, not once per answer or per guard.
        expect(signIn.ensureRecordClaim).toHaveBeenCalledTimes(1);
        expect(signIn.ensureRecordClaim).toHaveBeenCalledWith('doc-1', 'user');
        // initAuthStateListener answers once per sign-in change, as before.
        expect(emitted).toHaveLength(1);
        expect(await auth.recordReady()).toMatchObject({ name: 'Anna B' });
    });

    it('waits for the server on a first sign-in on this device (nothing cached)', async () => {
        const auth = store();
        listener.fire(user);
        const ready = auth.recordReady();
        expect((await settled(ready)).done).toBe(false);
        read.next({ data: record, fromCache: false });
        expect(await ready).toMatchObject({ id: 'doc-1' });
    });

    it('counts a Firebase sign-in with no record as signed out, on the server\'s word', async () => {
        const auth = store();
        listener.fire(user);
        const ready = auth.recordReady();
        // A cached "no record" waits: the record may have been made since.
        read.next({ data: null, fromCache: true });
        expect((await settled(ready)).done).toBe(false);
        read.next({ data: null, fromCache: false });
        expect(await ready).toBeNull();
        expect(await guard(userGuard)).toEqual({ urlTree: ['/signup'] });
        expect(auth.currentUser()).toBeNull();
    });

    it('takes a cached "no record" after a while with no server (offline)', async () => {
        vi.useFakeTimers();
        const auth = store();
        listener.fire(user);
        read.next({ data: null, fromCache: true });
        const ready = auth.recordReady();
        await vi.advanceTimersByTimeAsync(CACHED_VERDICT_WAIT_MS);
        expect(await ready).toBeNull();
    });

    it('signs out an account the server shows as inactive, and not on an old cached copy', async () => {
        const auth = store();
        listener.fire(user);
        read.next({ data: { ...record, isActive: false }, fromCache: true });
        await Promise.resolve();
        expect(authService.logout).not.toHaveBeenCalled();
        expect((await settled(auth.recordReady())).done).toBe(false);

        read.next({ data: { ...record, isActive: false }, fromCache: false });
        await vi.waitFor(() => expect(authService.logout).toHaveBeenCalledTimes(1));
        expect(router.navigate).toHaveBeenCalledWith(['/signup']);
    });

    it('signs out an account made inactive after the cached copy let the page open', async () => {
        const auth = store();
        listener.fire(user);
        read.next({ data: record, fromCache: true });
        expect(await auth.recordReady()).toMatchObject({ id: 'doc-1' });
        read.next({ data: { ...record, isActive: false }, fromCache: false });
        await vi.waitFor(() => expect(authService.logout).toHaveBeenCalledTimes(1));
    });

    it('settles to null when nobody is signed in', async () => {
        const auth = store();
        listener.fire(null);
        expect(await auth.recordReady()).toBeNull();
        expect(authService.watchCurrentUserByUid).not.toHaveBeenCalled();
    });

    it('starts a new read for the next sign-in and answers for it', async () => {
        const auth = store();
        const emitted: unknown[] = [];
        auth.initAuthStateListener().subscribe((value) => emitted.push(value));
        listener.fire(user);
        read.next({ data: record, fromCache: true });
        await vi.waitFor(() => expect(emitted).toHaveLength(1));
        listener.fire(null);
        expect(await auth.recordReady()).toBeNull();
        read = new Subject<Answer>();
        listener.fire(user);
        read.next({ data: record, fromCache: false });
        await vi.waitFor(() => expect(emitted).toHaveLength(3));
        expect(emitted[1]).toBeNull();
        expect(authService.watchCurrentUserByUid).toHaveBeenCalledTimes(2);
    });

    it("refreshes an admin's token once, in the background, when the claim check did not already", async () => {
        const auth = store();
        listener.fire(user);
        read.next({ data: { ...record, role: 'admin' }, fromCache: true });
        expect(await auth.recordReady()).toMatchObject({ isAdmin: true });
        read.next({ data: { ...record, role: 'admin' }, fromCache: false });
        await vi.waitFor(() => expect(auth.isAdmin()).toBe(true));
        expect(getIdToken).toHaveBeenCalledTimes(1);
        expect(getIdToken).toHaveBeenCalledWith(true);
    });

    it("keeps the store up to date from later copies, leaving a page's own state and an unchanged record alone", async () => {
        const auth = store();
        listener.fire(user);
        read.next({ data: record, fromCache: true });
        await auth.recordReady();
        const first = auth.currentUser();
        await auth.updateUserProfile('doc-1', {}).catch(() => undefined);
        // The server confirms the same record: nothing changes, not even the object.
        read.next({ data: record, fromCache: false });
        await new Promise((resolve) => setTimeout(resolve, 0));
        expect(auth.currentUser()).toBe(first);
        // An admin gives the person a role: the record follows, the page's state stays.
        const before = { isSuccess: auth.isSuccess(), error: auth.error(), isLoading: auth.isLoading() };
        read.next({ data: { ...record, role: 'editor' }, fromCache: false });
        await vi.waitFor(() => expect(auth.currentUser()?.role).toBe('editor'));
        expect({ isSuccess: auth.isSuccess(), error: auth.error(), isLoading: auth.isLoading() }).toEqual(before);
        expect(auth.isAuthenticated()).toBe(true);
        // The new role gets its claim checked.
        expect(signIn.ensureRecordClaim).toHaveBeenLastCalledWith('doc-1', 'editor');
    });

    it('signs out when the record cannot be read, as a failed read always did', async () => {
        const auth = store();
        listener.fire(user);
        read.error(new Error('permission-denied'));
        expect(await auth.recordReady()).toBeNull();
    });
});
