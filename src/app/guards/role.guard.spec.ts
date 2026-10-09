/**
 * Role Guard Unit Tests
 * 
 * Tests for the roleGuard that protects admin pages by checking user roles.
 */

import { TestBed } from '@angular/core/testing';
import { PLATFORM_ID } from '@angular/core';
import { Router } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { roleGuard } from './role.guard';
import { ToastService } from '../../shared/services/toast.service';
import { ConstantVariables } from '../../shared/constants';
import { AuthState } from '../pages/(auth)/auth.store';

describe('roleGuard', () => {
    let mockRouter: { navigate: ReturnType<typeof vi.fn> };
    let mockToastService: { openCustomSnackbar: ReturnType<typeof vi.fn> };
    let mockAuthState: { recordReady: ReturnType<typeof vi.fn> };
    let mockConstantVariables: Partial<ConstantVariables>;

    beforeEach(() => {
        mockRouter = { navigate: vi.fn() };
        mockToastService = { openCustomSnackbar: vi.fn() };
        mockAuthState = { recordReady: vi.fn() };
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
            mockAuthState.recordReady.mockResolvedValue(mockUser);

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
            mockAuthState.recordReady.mockResolvedValue(mockUser);

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
            mockAuthState.recordReady.mockResolvedValue(null);

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
            mockAuthState.recordReady.mockResolvedValue(mockUser);

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

    describe('the shared record (AuthState.recordReady)', () => {
        it('waits for the record, decides once and completes', async () => {
            // Every guard waits on the one record AuthState loads per sign-in, not a
            // listener of its own, so a guard ends with its first answer.
            let settle!: (record: unknown) => void;
            mockAuthState.recordReady.mockReturnValue(new Promise((resolve) => { settle = resolve; }));

            const route = {
                data: { allowedRoles: ['admin'] },
                path: 'admin/dashboard',
            };

            await TestBed.runInInjectionContext(async () => {
                const result$ = roleGuard(route as any, {} as any);
                if (result$ && typeof result$ === 'object' && 'subscribe' in result$) {
                    const results: unknown[] = [];
                    let completed = false;
                    result$.subscribe({ next: (r) => results.push(r), complete: () => { completed = true; } });
                    expect(results).toEqual([]);

                    settle({ role: 'admin', email: 'admin@example.com' });
                    await vi.waitFor(() => expect(completed).toBe(true));
                    expect(results).toEqual([true]);
                    expect(mockRouter.navigate).not.toHaveBeenCalled();
                }
            });
        });
    });

    describe('SSR platform check', () => {
        it('renders nothing on the server: no reads start there, the browser renders the page', () => {
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
                // On the server the guard refuses synchronously, without calling auth
                expect(result).toBe(false);
            });

            // Should NOT ask for the record during SSR
            expect(mockAuthState.recordReady).not.toHaveBeenCalled();
            // Should NOT redirect during SSR
            expect(mockRouter.navigate).not.toHaveBeenCalled();
        });

        it('should enforce guard on browser platform', async () => {
            const mockUser = { role: 'admin', email: 'test@example.com' };
            mockAuthState.recordReady.mockResolvedValue(mockUser);

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

            // SHOULD ask for the record on browser
            expect(mockAuthState.recordReady).toHaveBeenCalled();
        });
    });

    describe('role validation', () => {
        it('should allow access when user has one of multiple allowed roles', async () => {
            const mockUser = { role: 'editor', email: 'test@example.com' };
            mockAuthState.recordReady.mockResolvedValue(mockUser);

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
