/**
 * A locked app account (docs/app/app-accounts.html) cannot change its name, photo or
 * password from the browser: the store refuses before Firebase's own profile is
 * touched, as the rules refuse the record. Other changes, and other accounts, go
 * through as before.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { Auth } from '@angular/fire/auth';
import { of } from 'rxjs';

const listener = vi.hoisted(() => ({ fire: (_user: unknown) => undefined as void }));
vi.mock('@angular/fire/auth', () => ({
    Auth: class {},
    onAuthStateChanged: vi.fn((_auth: unknown, next: (user: unknown) => void) => {
        listener.fire = next;
        return () => undefined;
    }),
}));

import { AuthState } from './auth.store';
import { AuthService } from './auth.service';
import { SignInService } from './sign-in.service';
import { ToastService } from '../../../shared/services/toast.service';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

describe('AuthState with a locked app account', () => {
    const authService = {
        watchCurrentUserByUid: vi.fn(),
        updateUser: vi.fn(async () => 'Profile updated'),
        updatePassword: vi.fn(async () => 'Password updated'),
    };

    async function signedInAs(record: Record<string, unknown>) {
        authService.watchCurrentUserByUid.mockReturnValue(of({ data: { id: 'doc-1', uid: 'uid-1', name: 'Anna', role: 'user', isActive: true, ...record }, fromCache: false }));
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            imports: [translocoTestingModule()],
            providers: [
                AuthState,
                { provide: AuthService, useValue: authService },
                { provide: ToastService, useValue: {} },
                { provide: Auth, useValue: {} },
                { provide: SignInService, useValue: { ensureRecordClaim: vi.fn(async () => false) } },
                { provide: Router, useValue: { navigate: vi.fn() } },
            ],
        });
        const store = TestBed.inject(AuthState);
        listener.fire({ uid: 'uid-1' });
        await vi.waitFor(() => expect(store.currentUser()).not.toBeNull());
        return store;
    }

    beforeEach(() => vi.clearAllMocks());

    it('refuses a new name or photo without touching Firebase', async () => {
        const store = await signedInAs({ by: 'app' });
        await store.updateUserProfile('doc-1', { name: 'Someone else' });
        expect(store.isSuccess()).toBe(false);
        expect(store.error()).toContain('managed for you');
        await store.updateUserProfile('doc-1', { photo: 'https://example.com/a.png' });
        expect(authService.updateUser).not.toHaveBeenCalled();
        expect(store.currentUser()?.name).toBe('Anna');
    });

    it('refuses a password change', async () => {
        const store = await signedInAs({ by: 'app' });
        await store.changePassword({ currentPassword: 'old password', newPassword: 'new password' });
        expect(authService.updatePassword).not.toHaveBeenCalled();
        expect(store.isSuccess()).toBe(false);
    });

    it('still saves what is not its identity, such as a language', async () => {
        const store = await signedInAs({ by: 'app' });
        await store.updateUserProfile('doc-1', { preferredLanguage: 'hi' });
        expect(authService.updateUser).toHaveBeenCalledWith('doc-1', { preferredLanguage: 'hi' });
    });

    it.each([[{ by: 'email' }], [{ by: 'app', selfService: true }]])('saves a new name for %o as before', async (record) => {
        const store = await signedInAs(record);
        await store.updateUserProfile('doc-1', { name: 'Anna B' });
        expect(authService.updateUser).toHaveBeenCalledWith('doc-1', { name: 'Anna B' });
        expect(store.currentUser()?.name).toBe('Anna B');
    });
});
