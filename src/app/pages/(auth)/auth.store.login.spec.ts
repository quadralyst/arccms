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
import { ToastService } from '../../../shared/services/toast.service';

describe('AuthState.login', () => {
    const authService = {
        login: vi.fn(),
        getCurrentUserByUid: vi.fn(),
        logout: vi.fn(() => of(undefined)),
    };
    const toast = { success: vi.fn(), error: vi.fn() };

    beforeEach(() => {
        vi.clearAllMocks();
        TestBed.configureTestingModule({
            providers: [
                AuthState,
                { provide: AuthService, useValue: authService },
                { provide: ToastService, useValue: toast },
                { provide: Auth, useValue: {} },
                { provide: Router, useValue: { navigate: vi.fn() } },
            ],
        });
    });

    it('signs in someone with an ArcCMS record', () => {
        authService.login.mockReturnValue(of({ uid: 'u1' }));
        authService.getCurrentUserByUid.mockReturnValue(of({ uid: 'u1', role: 'user' }));
        const store = TestBed.inject(AuthState);
        store.login({ email: 'a@x.com', password: 'pw' });
        expect(authService.logout).not.toHaveBeenCalled();
        expect(toast.success).toHaveBeenCalledWith('Logged in successfully.');
        expect(store.error()).toBe('');
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
});
