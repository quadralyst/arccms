import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID, runInInjectionContext, Injector } from '@angular/core';
import { Router } from '@angular/router';
import { of } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { userGuard, entitledGuard } from './user.guards';
import { AuthState } from '../(auth)/auth.store';
import { EntitlementService } from './entitlement.service';

describe('user route guards', () => {
    const mockAuth = { initAuthStateListener: vi.fn() };
    const mockEntitlements = { load: vi.fn() };
    const mockRouter = {
        createUrlTree: vi.fn((commands: unknown[], extras?: unknown) => ({ urlTree: commands, extras })),
    };

    function run(guard: any, url = '/user/dashboard') {
        const injector = TestBed.inject(Injector);
        return runInInjectionContext(injector, () => guard({}, { url }));
    }

    beforeEach(() => {
        vi.clearAllMocks();
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
