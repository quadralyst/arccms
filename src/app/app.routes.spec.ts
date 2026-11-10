/**
 * Tests for App Routes Configuration
 */

import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routes } from './app.routes';
import { roleGuard } from './guards/role.guard';
import { claimedFirstSegments } from './guards/language.guard';
import { SUPPORTED_LANGUAGES } from '../shared/constants/languages';

describe('App Routes', () => {
    describe('Routes Array', () => {
        it('should export routes array', () => {
            expect(routes).toBeDefined();
            expect(Array.isArray(routes)).toBe(true);
        });

        // it('should have 4 routes configured', () => {
        //     expect(routes.length).toBe(4);
        // });
    });







    describe('Route Structure', () => {
        it('is a configuration Angular accepts (the router checks it when it starts)', () => {
            TestBed.configureTestingModule({ providers: [provideRouter(routes)] });
            expect(() => TestBed.inject(Router)).not.toThrow();
        });

        it('should not have any duplicate paths', () => {
            // Routes that match by function (a feature that is off, the language redirect) have no path.
            const paths = routes.map(r => r.path).filter((path) => path !== undefined);
            const uniquePaths = new Set(paths);
            expect(uniquePaths.size).toBe(paths.length);
        });

        it('should have valid route configurations', () => {
            routes.forEach(route => {
                // Every route has a path, except the one that matches by function
                // (a feature that is off, specs/feature-flags-spec.md).
                expect(route.path !== undefined || route.matcher !== undefined).toBe(true);
                // Each route should have either component, loadComponent, redirectTo, or children
                // (a parent that only groups routes under one path and its guards, as an app does).
                const hasComponent = route.component !== undefined;
                const hasLoadComponent = route.loadComponent !== undefined;
                const hasRedirect = route.redirectTo !== undefined;
                const hasChildren = route.children !== undefined;
                expect(hasComponent || hasLoadComponent || hasRedirect || hasChildren).toBe(true);
            });
        });

        it('names the roles on every route and page that roleGuard guards (without them the guard lets nobody in)', () => {
            const missing: string[] = [];
            const walk = (list: Routes, prefix: string) => {
                for (const route of list) {
                    const url = [prefix, route.path].filter(Boolean).join('/');
                    const guards = [...(route.canActivate ?? []), ...(route.canActivateChild ?? []), ...(route.canMatch ?? [])];
                    if (guards.includes(roleGuard) && !route.data?.['allowedRoles']?.length) missing.push(`/${url}`);
                    if (route.children) walk(route.children, url);
                }
            };
            walk(routes, '');
            // The file-based pages set the guard in their routeMeta.
            const pagesDir = resolve(__dirname, 'pages');
            for (const file of readdirSync(pagesDir, { recursive: true }) as string[]) {
                if (!file.endsWith('.page.ts')) continue;
                const code = readFileSync(resolve(pagesDir, file), 'utf8');
                if (/canActivate:\s*\[[^\]]*\broleGuard\b/.test(code) && !/allowedRoles:\s*\[\s*['"]/.test(code)) missing.push(file);
            }
            expect(missing).toEqual([]);
        });
    });

    describe('Languages', () => {
        it("uses no language code as a core page's first segment, so every catalogue language can have /{code}/", () => {
            // An address a route claims is never a language prefix (languageRouteGuard, F18).
            const claimed = claimedFirstSegments(routes);
            expect(SUPPORTED_LANGUAGES.filter((language) => claimed.has(language.code))).toEqual([]);
        });
    });

    describe('Features', () => {
        it('answers the URLs of a feature that is off before any other route', () => {
            expect(routes[0].matcher).toBeTypeOf('function');
        });
    });

    // specs/form-gamification-spec.md: links in emails already sent keep working.
    describe('old leaderboard and member links', () => {
        it('open the form they came from, or the home page', async () => {
            const kept = routes.filter((r) => r.path?.startsWith('leaderboard') || r.path === 'user/:waitlistId/:userId');
            expect(kept.length).toBe(4);
            expect(kept.every((r) => r.redirectTo !== undefined && !r.loadComponent)).toBe(true);

            const stub = { children: [] };
            TestBed.configureTestingModule({ providers: [provideRouter([
                ...kept, { path: '', pathMatch: 'full', ...stub }, { path: 'waitlist/:waitlistId', ...stub }, { path: '**', ...stub },
            ])] });
            const router = TestBed.inject(Router);
            for (const [from, to] of [
                ['/leaderboard/launch/m1', '/waitlist/launch'],
                ['/leaderboard/launch', '/waitlist/launch'],
                ['/user/launch/w1', '/waitlist/launch'],
                ['/leaderboard', '/'],
            ]) {
                await router.navigateByUrl(from);
                expect(router.url, from).toBe(to);
            }
        });
    });

    describe('Admin Routes', () => {
        it('draws the 403 page on its own, without the admin\'s side menu', async () => {
            const route = routes.find(r => r.path === 'admin/unauthorized');
            expect(route?.children, 'no admin shell around it').toBeUndefined();
            expect(route?.canActivate, 'anyone may land on it').toBeUndefined();
            const page = await (route!.loadComponent as () => Promise<unknown>)();
            expect((page as { name: string }).name).toContain('UnauthorizedComponent');
        });

        it('should have admin/waitlists route with correct layout', async () => {
            const adminRoute = adminChild('waitlists');
            expect(adminRoute, 'Admin waitlists route should exist').toBeDefined();

            // Verify it has children (nested routing)
            expect(adminRoute?.children, 'Admin route should have children').toBeDefined();
            expect(isArray(adminRoute?.children)).toBe(true);

            // The layout comes from the one admin parent, not from this route (admin-shell.spec.ts).
            expect(adminRoute?.loadComponent).toBeUndefined();
            expect(await routes.find(r => r.path === 'admin')?.loadComponent?.()).toBeDefined();
        });

        it('sends the bare /admin/contents to Content Types, since that folder has no page of its own', async () => {
            const route = adminChild('contents');
            expect(route?.redirectTo).toBe('/admin/contents/content-types');
            expect(route?.pathMatch).toBe('full');

            // Only the bare URL: the pages below it keep their own addresses.
            const contentTypes = { path: 'contents/content-types', children: [] };
            const admin = { path: 'admin', children: [route!, contentTypes] };
            TestBed.configureTestingModule({ providers: [provideRouter([admin, { path: '**', children: [] }])] });
            const router = TestBed.inject(Router);
            await router.navigateByUrl('/admin/contents');
            expect(router.url).toBe('/admin/contents/content-types');
            await router.navigateByUrl('/admin/contents/blog');
            expect(router.url).toBe('/admin/contents/blog');
        });

        it('should have waitlists list as default child route', () => {
            const adminRoute = adminChild('waitlists');
            const defaultChild = adminRoute?.children?.find(r => r.path === '');
            expect(defaultChild).toBeDefined();
        });
    });

    /** A route under the one admin parent. */
    function adminChild(path: string) {
        return routes.find(r => r.path === 'admin')?.children?.find(r => r.path === path);
    }

    // Helper to check for array (since Array.isArray is standard)
    function isArray(val: any): boolean {
        return Array.isArray(val);
    }
});
