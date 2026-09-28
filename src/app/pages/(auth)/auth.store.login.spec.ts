/**
 * Signing in (CO6.6): a valid password without an ArcCMS record is no access.
 * The sign-in pool can be shared with another app, whose users must not end up
 * signed in to Firebase and treated as nobody.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { Auth } from '@angular/fire/auth';

vi.mock('@angular/fire/auth', () => ({ Auth: class {}, onAuthStateChanged: vi.fn(() => () => undefined) }));

import { AuthState, NO_ACCESS_CODE, NO_ACCESS_MESSAGE } from './auth.store';
import { AuthService } from './auth.service';
import { SignInService } from './sign-in.service';
import { ToastService } from '../../../shared/services/toast.service';

describe('AuthState.login', () => {
    const authService = {
        register: vi.fn(),
        login: vi.fn(),
        getCurrentUserByUid: vi.fn(),
        logout: vi.fn(() => of(undefined)),
    };
    const toast = { success: vi.fn(), error: vi.fn() };
    const signIn = { ensureRecordClaim: vi.fn(async () => false), createAccountRecord: vi.fn() };
    const auth = { currentUser: { uid: 'u1', getIdToken: vi.fn(async () => 't') } };

    beforeEach(() => {
        vi.clearAllMocks();
        TestBed.configureTestingModule({
            providers: [
                AuthState,
                { provide: AuthService, useValue: authService },
                { provide: ToastService, useValue: toast },
                { provide: Auth, useValue: auth },
                { provide: SignInService, useValue: signIn },
                { provide: Router, useValue: { navigate: vi.fn() } },
            ],
        });
    });

    it('signs in someone with an ArcCMS record', async () => {
        authService.login.mockReturnValue(of({ uid: 'u1' }));
        authService.getCurrentUserByUid.mockReturnValue(of({ id: 'rec-1', uid: 'u1', role: 'user' }));
        const store = TestBed.inject(AuthState);
        store.login({ email: 'a@x.com', password: 'pw' });
        await vi.waitFor(() => expect(toast.success).toHaveBeenCalledWith('Logged in successfully.'));
        expect(authService.logout).not.toHaveBeenCalled();
        expect(store.error()).toBe('');
    });

    it('loads the record itself, so the page moves on even when no auth change fires', async () => {
        // Signing in again as whoever is already signed in (right after a sign-up)
        // fires no onAuthStateChanged; the store used to wait for one for ever.
        authService.login.mockReturnValue(of({ uid: 'u1' }));
        authService.getCurrentUserByUid.mockReturnValue(of({ id: 'rec-1', uid: 'u1', role: 'user' }));
        const store = TestBed.inject(AuthState);
        store.login({ email: 'a@x.com', password: 'pw' });
        await vi.waitFor(() => expect(store.currentUser()).toMatchObject({ id: 'rec-1', uid: 'u1' }));
        expect(signIn.ensureRecordClaim).toHaveBeenCalledWith('rec-1', 'user');
        expect(store.isLoading()).toBe(false);
    });

    it('signs out a valid account with no ArcCMS record, with a reason', () => {
        authService.login.mockReturnValue(of({ uid: 'host-user' }));
        authService.getCurrentUserByUid.mockReturnValue(of(null));
        const store = TestBed.inject(AuthState);
        store.login({ email: 'h@x.com', password: 'pw' });
        expect(authService.logout).toHaveBeenCalled();
        expect(toast.success).not.toHaveBeenCalled();
        expect(store.error()).toBe(NO_ACCESS_MESSAGE);
        expect(store.errorCode()).toBe(NO_ACCESS_CODE);
        expect(store.isSuccess()).toBe(false);
    });

    it('sign-up stays busy until the record exists, so nobody presses Create Account twice', async () => {
        let finish!: () => void;
        signIn.createAccountRecord.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
        authService.register.mockReturnValue(of({ uid: 'u1', delete: vi.fn() }));
        authService.getCurrentUserByUid.mockReturnValue(of({ id: 'rec-1', uid: 'u1', role: 'user' }));
        const store = TestBed.inject(AuthState);
        store.signup({ name: 'Asha', email: 'a@x.com', password: 'longenough' });
        await Promise.resolve();
        expect(store.isLoading()).toBe(true);
        finish();
        await vi.waitFor(() => expect(store.currentUser()).toMatchObject({ id: 'rec-1' }));
        expect(store.isLoading()).toBe(false);
    });
});
