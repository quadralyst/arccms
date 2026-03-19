/**
 * Role Guard Unit Tests
 * 
 * Tests for the roleGuard that protects admin pages by checking user roles.
 */

import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { of, Subject } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { roleGuard } from './role.guard';
import { ToastService } from '../../shared/services/toast.service';
import { ConstantVariables } from '../../shared/constants';
import { AuthState } from '../pages/(auth)/auth.store';

describe('roleGuard', () => {
    let mockRouter: { navigate: ReturnType<typeof vi.fn> };
    let mockToastService: { openCustomSnackbar: ReturnType<typeof vi.fn> };
    let mockAuthState: { initAuthStateListener: ReturnType<typeof vi.fn> };
    let mockConstantVariables: Partial<ConstantVariables>;

    beforeEach(() => {
        mockRouter = { navigate: vi.fn() };
        mockToastService = { openCustomSnackbar: vi.fn() };
        mockAuthState = { initAuthStateListener: vi.fn() };
        mockConstantVariables = {};

        TestBed.configureTestingModule({
            providers: [
                { provide: Router, useValue: mockRouter },
                { provide: ToastService, useValue: mockToastService },
                { provide: AuthState, useValue: mockAuthState },
                { provide: ConstantVariables, useValue: mockConstantVariables },
            ],
        });
    });

    describe('when user has admin role', () => {
        it('should allow access when user role is in allowedRoles', async () => {
            const mockUser = { role: 'admin', email: 'test@example.com' };
            mockAuthState.initAuthStateListener.mockReturnValue(of(mockUser));

            const route = {
                data: { allowedRoles: ['admin'] },
                path: 'admin/dashboard',
            };

            await TestBed.runInInjectionContext(async () => {
                const result$ = roleGuard(route as any, {} as any);
                if (result$ && typeof result$ === 'object' && 'subscribe' in result$) {
                    const result = await new Promise((resolve) => {
                        result$.subscribe((r) => resolve(r));
                    });
                    expect(result).toBe(true);
                }
            });

            expect(mockRouter.navigate).not.toHaveBeenCalled();
        });
    });

    describe('when user does not have required role', () => {
        it('should deny access and redirect to unauthorized page', async () => {
            const mockUser = { role: 'editor', email: 'test@example.com' };
            mockAuthState.initAuthStateListener.mockReturnValue(of(mockUser));

            const route = {
                data: { allowedRoles: ['admin'] },
                path: 'admin/dashboard',
            };

            await TestBed.runInInjectionContext(async () => {
                const result$ = roleGuard(route as any, {} as any);
                if (result$ && typeof result$ === 'object' && 'subscribe' in result$) {
                    const result = await new Promise((resolve) => {
                        result$.subscribe((r) => resolve(r));
                    });
                    expect(result).toBe(false);
                }
            });

            expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/unauthorized']);
        });
    });

    describe('when user is not authenticated', () => {
        it('should deny access and redirect to unauthorized page', async () => {
            mockAuthState.initAuthStateListener.mockReturnValue(of(null));

            const route = {
                data: { allowedRoles: ['admin'] },
                path: 'admin/dashboard',
            };

            await TestBed.runInInjectionContext(async () => {
                const result$ = roleGuard(route as any, {} as any);
                if (result$ && typeof result$ === 'object' && 'subscribe' in result$) {
                    const result = await new Promise((resolve) => {
                        result$.subscribe((r) => resolve(r));
                    });
                    expect(result).toBe(false);
                }
            });

            expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/unauthorized']);
        });
    });

    describe('when no allowedRoles defined', () => {
        it('should allow access and show warning', () => {
            const mockUser = { role: 'admin', email: 'test@example.com' };
            mockAuthState.initAuthStateListener.mockReturnValue(of(mockUser));

            const route = {
                data: {},
                path: 'admin/test-route',
            };

            TestBed.runInInjectionContext(() => {
                const result = roleGuard(route as any, {} as any);
                // When no allowedRoles, guard returns true synchronously
                expect(result).toBe(true);
            });

            expect(mockToastService.openCustomSnackbar).toHaveBeenCalledWith(
                expect.stringContaining('No allowed roles defined'),
                'warning',
                'warning'
            );
        });
    });

    describe('when auth state observable emits multiple times (long-lived listener)', () => {
        it('should only use the first emission (null) and not be overridden by a later admin emission', async () => {
            // Regression for missing take(1): the real onAuthStateChanged Observable never
            // completes. Without take(1), a null→admin sequence would redirect to /unauthorized
            // then immediately allow access when the second value arrives.
            const authSubject = new Subject<any>();
            mockAuthState.initAuthStateListener.mockReturnValue(authSubject.asObservable());

            const route = {
                data: { allowedRoles: ['admin'] },
                path: 'admin/dashboard',
            };

            let emittedResult: boolean | undefined;

            await TestBed.runInInjectionContext(async () => {
                const result$ = roleGuard(route as any, {} as any);
                if (result$ && typeof result$ === 'object' && 'subscribe' in result$) {
                    result$.subscribe((r) => {
                        emittedResult = r as boolean;
                    });

                    // First emission: null (logged-out) — should deny and redirect
                    authSubject.next(null);
                    expect(emittedResult).toBe(false);
                    expect(mockRouter.navigate).toHaveBeenCalledWith(['/admin/unauthorized']);

                    const navigateCalls = mockRouter.navigate.mock.calls.length;

                    // Second emission: admin user — guard is closed (take(1)), so no change
                    authSubject.next({ role: 'admin', email: 'admin@example.com' });
                    expect(mockRouter.navigate.mock.calls.length).toBe(navigateCalls);
                    expect(emittedResult).toBe(false); // still false, not overwritten
                }
            });
        });

        it('should only use the first emission (admin) and not be revoked by a later null emission', async () => {
            // Symmetric regression: if an admin logs in and their token briefly lapses,
            // a null re-emission must not trigger a second redirect after the guard already
            // resolved to true.
            const authSubject = new Subject<any>();
            mockAuthState.initAuthStateListener.mockReturnValue(authSubject.asObservable());

            const route = {
                data: { allowedRoles: ['admin'] },
                path: 'admin/dashboard',
            };

            let emittedResult: boolean | undefined;

            await TestBed.runInInjectionContext(async () => {
                const result$ = roleGuard(route as any, {} as any);
                if (result$ && typeof result$ === 'object' && 'subscribe' in result$) {
                    result$.subscribe((r) => {
                        emittedResult = r as boolean;
                    });

                    // First emission: admin — should allow access
                    authSubject.next({ role: 'admin', email: 'admin@example.com' });
                    expect(emittedResult).toBe(true);
                    expect(mockRouter.navigate).not.toHaveBeenCalled();

                    // Second emission: null — guard is already closed (take(1)), no redirect
                    authSubject.next(null);
                    expect(mockRouter.navigate).not.toHaveBeenCalled();
                    expect(emittedResult).toBe(true); // still true, not overwritten
                }
            });
        });

        it('should complete the Observable after the first emission so no subscription leak occurs', async () => {
            // Without take(1) the guard Observable stays open forever, preventing the
            // router from completing navigation and leaking a Firebase listener.
            const authSubject = new Subject<any>();
            mockAuthState.initAuthStateListener.mockReturnValue(authSubject.asObservable());

            const route = {
                data: { allowedRoles: ['admin'] },
                path: 'admin/dashboard',
            };

            await TestBed.runInInjectionContext(async () => {
                const result$ = roleGuard(route as any, {} as any);
                if (result$ && typeof result$ === 'object' && 'subscribe' in result$) {
                    let completed = false;
                    result$.subscribe({ complete: () => { completed = true; } });

                    authSubject.next(null);
                    expect(completed).toBe(true);
                }
            });
        });
    });

    describe('SSR platform check', () => {
        it('should skip guard and allow access during SSR (server platform)', () => {
            const route = {
                data: { allowedRoles: ['admin'] },
                path: 'admin/dashboard',
            };

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    { provide: PLATFORM_ID, useValue: 'server' },
                    { provide: Router, useValue: mockRouter },
                    { provide: ToastService, useValue: mockToastService },
                    { provide: AuthState, useValue: mockAuthState },
                    { provide: ConstantVariables, useValue: mockConstantVariables },
                ],
            });

            TestBed.runInInjectionContext(() => {
                const result = roleGuard(route as any, {} as any);
                // During SSR, guard returns true synchronously without calling auth
                expect(result).toBe(true);
            });

            // Should NOT call initAuthStateListener during SSR
            expect(mockAuthState.initAuthStateListener).not.toHaveBeenCalled();
            // Should NOT redirect during SSR
            expect(mockRouter.navigate).not.toHaveBeenCalled();
        });

        it('should enforce guard on browser platform', async () => {
            const mockUser = { role: 'admin', email: 'test@example.com' };
            mockAuthState.initAuthStateListener.mockReturnValue(of(mockUser));

            const route = {
                data: { allowedRoles: ['admin'] },
                path: 'admin/dashboard',
            };

            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    { provide: PLATFORM_ID, useValue: 'browser' },
                    { provide: Router, useValue: mockRouter },
                    { provide: ToastService, useValue: mockToastService },
                    { provide: AuthState, useValue: mockAuthState },
                    { provide: ConstantVariables, useValue: mockConstantVariables },
                ],
            });

            await TestBed.runInInjectionContext(async () => {
                const result$ = roleGuard(route as any, {} as any);
                if (result$ && typeof result$ === 'object' && 'subscribe' in result$) {
                    const result = await new Promise((resolve) => {
                        result$.subscribe((r) => resolve(r));
                    });
                    expect(result).toBe(true);
                }
            });

            // SHOULD call initAuthStateListener on browser
            expect(mockAuthState.initAuthStateListener).toHaveBeenCalled();
        });
    });

    describe('role validation', () => {
        it('should allow access when user has one of multiple allowed roles', async () => {
            const mockUser = { role: 'editor', email: 'test@example.com' };
            mockAuthState.initAuthStateListener.mockReturnValue(of(mockUser));

            const route = {
                data: { allowedRoles: ['admin', 'editor', 'moderator'] },
                path: 'admin/content',
            };

            await TestBed.runInInjectionContext(async () => {
                const result$ = roleGuard(route as any, {} as any);
                if (result$ && typeof result$ === 'object' && 'subscribe' in result$) {
                    const result = await new Promise((resolve) => {
                        result$.subscribe((r) => resolve(r));
                    });
                    expect(result).toBe(true);
                }
            });

            expect(mockRouter.navigate).not.toHaveBeenCalled();
        });
    });
});
