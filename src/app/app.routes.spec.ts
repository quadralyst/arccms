/**
 * Tests for App Routes Configuration
 */

import { describe, it, expect } from 'vitest';
import { routes } from './app.routes';

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
        it('should not have any duplicate paths', () => {
            const paths = routes.map(r => r.path);
            const uniquePaths = new Set(paths);
            expect(uniquePaths.size).toBe(paths.length);
        });

        it('should have valid route configurations', () => {
            routes.forEach(route => {
                expect(route).toHaveProperty('path');
                // Each route should have either component, loadComponent, or redirectTo
                const hasComponent = route.component !== undefined;
                const hasLoadComponent = route.loadComponent !== undefined;
                const hasRedirect = route.redirectTo !== undefined;
                expect(hasComponent || hasLoadComponent || hasRedirect).toBe(true);
            });
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
