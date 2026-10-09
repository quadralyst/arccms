/**
 * Tests for App Routes Configuration
 */

import { describe, it, expect } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { routes } from './app.routes';
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

    describe('Admin Routes', () => {
        it('should have admin/waitlists route with correct layout', async () => {
            const adminRoute = routes.find(r => r.path === 'admin/waitlists');
            expect(adminRoute, 'Admin waitlists route should exist').toBeDefined();

            // Verify it has children (nested routing)
            expect(adminRoute?.children, 'Admin route should have children').toBeDefined();
            expect(isArray(adminRoute?.children)).toBe(true);

            // Verify it loads the admin layout
            if (adminRoute?.loadComponent) {
                const component = await adminRoute.loadComponent();
                // We can't easily check the class name if it is anonymous default export 
                // but we can check it's not null
                expect(component).toBeDefined();
            }
        });

        it('should have waitlists list as default child route', () => {
            const adminRoute = routes.find(r => r.path === 'admin/waitlists');
            const defaultChild = adminRoute?.children?.find(r => r.path === '');
            expect(defaultChild).toBeDefined();
        });
    });

    // Helper to check for array (since Array.isArray is standard)
    function isArray(val: any): boolean {
        return Array.isArray(val);
    }
});
