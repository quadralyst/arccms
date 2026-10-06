import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, runInInjectionContext, Injector } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { userGuard, entitledGuard, memberPagesGuard } from './user.guards';
import { AuthState } from '../(auth)/auth.store';
import { EntitlementService } from './entitlement.service';

// The app's choice in src/custom/app-accounts.ts, changed per test.
const appAccounts = vi.hoisted(() => ({ choice: {} as { memberPages?: boolean } }));
vi.mock('../../../custom/app-accounts', () => ({ CUSTOM_APP_ACCOUNTS: appAccounts.choice }));

describe('user route guards', () => {
    const mockAuth = { initAuthStateListener: vi.fn(), currentUser: vi.fn() };
    const mockEntitlements = { load: vi.fn() };
    const mockRouter = {
        createUrlTree: vi.fn((commands: unknown[], extras?: unknown) => ({ urlTree: commands, extras })),
        parseUrl: vi.fn((url: string) => ({ parsed: url })),
    };

    function run(guard: any, url = '/user/dashboard') {
        const injector = TestBed.inject(Injector);
        return runInInjectionContext(injector, () => guard({}, { url }));
    }

    beforeEach(() => {
        vi.clearAllMocks();
        delete appAccounts.choice.memberPages;
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: PLATFORM_ID, useValue: 'browser' },
                { provide: AuthState, useValue: mockAuth },
                { provide: EntitlementService, useValue: mockEntitlements },
                { provide: Router, useValue: mockRouter },
            ],
        });
    });

    describe('userGuard', () => {
        it('allows a signed-in user', async () => {
            mockAuth.initAuthStateListener.mockReturnValue(of({ uid: 'u1' }));
            const result = await firstValue(run(userGuard));
            expect(result).toBe(true);
        });

        it('redirects an anonymous visitor to /signup', async () => {
            mockAuth.initAuthStateListener.mockReturnValue(of(null));
            const result = await firstValue(run(userGuard));
            expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/signup'], { queryParams: { redirect: '/user/dashboard' } });
            expect(result).toMatchObject({ urlTree: ['/signup'] });
        });
    });

    describe('memberPagesGuard (docs/app/app-accounts.html)', () => {
        const signedIn = (record: Record<string, unknown>) => {
            mockAuth.initAuthStateListener.mockReturnValue(of({ uid: 'u1' }));
            mockAuth.currentUser.mockReturnValue({ uid: 'u1', role: 'user', ...record });
        };

        it('lets every account in when the app chose nothing, a locked app account too', async () => {
            signedIn({ by: 'email' });
            expect(await firstValue(run(memberPagesGuard))).toBe(true);
            signedIn({ by: 'app' });
            expect(await firstValue(run(memberPagesGuard))).toBe(true);
        });

        it('sends a locked app account to the site home when the app keeps it out (its home is a member page)', async () => {
            appAccounts.choice.memberPages = false;
            signedIn({ by: 'app' });
            expect(await firstValue(run(memberPagesGuard, '/user/profile'))).toEqual({ parsed: '/' });
        });

        it('still lets ordinary and selfService accounts in when the app keeps locked ones out', async () => {
            appAccounts.choice.memberPages = false;
            signedIn({ by: 'email' });
            expect(await firstValue(run(memberPagesGuard))).toBe(true);
            signedIn({ by: 'app', selfService: true });
            expect(await firstValue(run(memberPagesGuard))).toBe(true);
        });

        it('redirects an anonymous visitor to /signup, as userGuard does', async () => {
            mockAuth.initAuthStateListener.mockReturnValue(of(null));
            const result = await firstValue(run(memberPagesGuard, '/user/profile'));
            expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/signup'], { queryParams: { redirect: '/user/profile' } });
            expect(result).toMatchObject({ urlTree: ['/signup'] });
        });

        it('guards every core member page, and only those', async () => {
            const { routes } = await import('../../app.routes');
            const guarded = routes.filter((r) => r.canActivate?.includes(memberPagesGuard)).map((r) => r.path).sort();
            expect(guarded).toEqual(['account', 'user/dashboard', 'user/payments', 'user/premium', 'user/profile']);
            expect(routes.some((r) => r.canActivate?.includes(userGuard))).toBe(false);
        });
    });

    describe('entitledGuard', () => {
        it('allows a Pro member', async () => {
            mockAuth.initAuthStateListener.mockReturnValue(of({ uid: 'u1' }));
            mockEntitlements.load.mockReturnValue(of({ isPro: true }));
            const result = await firstValue(run(entitledGuard, '/user/premium'));
            expect(result).toBe(true);
        });

        it('redirects a signed-in non-member to /pricing', async () => {
            mockAuth.initAuthStateListener.mockReturnValue(of({ uid: 'u1' }));
            mockEntitlements.load.mockReturnValue(of({ isPro: false }));
            const result = await firstValue(run(entitledGuard, '/user/premium'));
            expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/pricing']);
            expect(result).toMatchObject({ urlTree: ['/pricing'] });
        });

        it('redirects an anonymous visitor to /signup', async () => {
            mockAuth.initAuthStateListener.mockReturnValue(of(null));
            const result = await firstValue(run(entitledGuard, '/user/premium'));
            expect(mockRouter.createUrlTree).toHaveBeenCalledWith(['/signup'], { queryParams: { redirect: '/user/premium' } });
            expect(result).toMatchObject({ urlTree: ['/signup'] });
        });
    });
});

/** Resolve the first emission of a guard result (Observable | Promise | value). */
function firstValue(result: any): Promise<unknown> {
    if (result && typeof result.subscribe === 'function') {
        return new Promise((resolve) => result.subscribe((v: unknown) => resolve(v)));
    }
    return Promise.resolve(result);
}
