/**
 * Admin Routes Guard Verification Tests
 * 
 * These tests verify that ALL admin pages have proper roleGuard protection.
 * If a new admin page is added without guards, these tests will fail,
 * ensuring that protection is not accidentally omitted.
 */

import { describe, it, expect } from 'vitest';
import { roleGuard } from '../../guards/role.guard';

// Import all admin page modules to verify their routeMeta
import { routeMeta as dashboardMeta } from './(dashboard)/dashboard.page';
import { routeMeta as mediaMeta } from './(media)/media.page';
import { routeMeta as settingsMeta } from './(settings)/settings.page';
import { routeMeta as emailSettingMeta } from './(settings)/email-setting/email-setting.page';
import { routeMeta as userSettingMeta } from './(settings)/user-setting/user-setting.page';
import { routeMeta as messageMeta } from './(settings)/message/message.page';
import { routeMeta as siteUsageMeta } from './(settings)/site-usage/site-usage.page';
import { routeMeta as waitlistsMeta } from './(waitlists)/waitlists.page';
import { routeMeta as templatesMeta } from './(waitlists)/templates/templates.page';
import { routeMeta as joinedUsersMeta } from './(waitlists)/joined-users/joined-users.page';
import { routeMeta as waitlistTagsMeta } from './(waitlists)/tags/tags.page';
import { routeMeta as contentTypesMeta } from './contents/content-types/index.page';
import { routeMeta as contentTypeTagsMeta } from './contents/content-types/tags/index.page';
import { routeMeta as contentsIndexMeta } from './contents/[slug]/index.page';
import { routeMeta as contentsAddMeta } from './contents/[slug]/add.page';
import { routeMeta as contentsEditMeta } from './contents/[slug]/edit.[contentId].page';
import { routeMeta as usersIndexMeta } from './users/index.page';
import { routeMeta as usersAddMeta } from './users/(add-user)/add.page';
import { routeMeta as usersEditMeta } from './users/(edit-user)/edit.[userId].page';
import { routeMeta as usersViewMeta } from './users/(view-user)/view.[userId].page';
import { routeMeta as usersRoleMeta } from './users/[role]/index.page';
import { routeMeta as contentTypeAddMeta } from './contents/content-types/(add-content-type)/add.page';
import { routeMeta as contentTypeEditMeta } from './contents/content-types/(edit-content-type)/edit.[contentTypeId].page';
import { routeMeta as contentTypeViewMeta } from './contents/content-types/(view-content-type)/view.[contentTypeId].page';

/**
 * Verifies that a route metadata has proper admin guard configuration
 */
function hasAdminGuard(meta: any): boolean {
    if (!meta) return false;

    // Check for canActivate array containing roleGuard
    const hasCanActivate = Array.isArray(meta.canActivate) &&
        meta.canActivate.includes(roleGuard);

    // Check for data.allowedRoles containing 'admin'
    const hasAdminRole = meta.data?.allowedRoles?.includes('admin');

    return hasCanActivate && hasAdminRole;
}

describe('Admin Routes Guard Verification', () => {
    describe('Dashboard & Analytics', () => {
        it('should have roleGuard on dashboard page', () => {
            expect(hasAdminGuard(dashboardMeta)).toBe(true);
        });

    });

    describe('Media', () => {
        it('should have roleGuard on media page', () => {
            expect(hasAdminGuard(mediaMeta)).toBe(true);
        });
    });

    describe('Settings Pages', () => {
        it('should have roleGuard on settings page', () => {
            expect(hasAdminGuard(settingsMeta)).toBe(true);
        });

        it('should have roleGuard on email settings page', () => {
            expect(hasAdminGuard(emailSettingMeta)).toBe(true);
        });

        it('should have roleGuard on user settings page', () => {
            expect(hasAdminGuard(userSettingMeta)).toBe(true);
        });

        it('should have roleGuard on message settings page', () => {
            expect(hasAdminGuard(messageMeta)).toBe(true);
        });

        it('should have roleGuard on site usage settings page', () => {
            expect(hasAdminGuard(siteUsageMeta)).toBe(true);
        });
    });

    describe('Waitlists Pages', () => {
        it('should have roleGuard on waitlists page', () => {
            expect(hasAdminGuard(waitlistsMeta)).toBe(true);
        });

        it('should have roleGuard on templates page', () => {
            expect(hasAdminGuard(templatesMeta)).toBe(true);
        });

        it('should have roleGuard on joined users page', () => {
            expect(hasAdminGuard(joinedUsersMeta)).toBe(true);
        });

        it('should have roleGuard on waitlist tags page', () => {
            expect(hasAdminGuard(waitlistTagsMeta)).toBe(true);
        });
    });

    describe('Content Types Pages', () => {
        it('should have roleGuard on content types index page', () => {
            expect(hasAdminGuard(contentTypesMeta)).toBe(true);
        });

        it('should have roleGuard on content type tags page', () => {
            expect(hasAdminGuard(contentTypeTagsMeta)).toBe(true);
        });

        it('should have roleGuard on add content type page', () => {
            expect(hasAdminGuard(contentTypeAddMeta)).toBe(true);
        });

        it('should have roleGuard on edit content type page', () => {
            expect(hasAdminGuard(contentTypeEditMeta)).toBe(true);
        });

        it('should have roleGuard on view content type page', () => {
            expect(hasAdminGuard(contentTypeViewMeta)).toBe(true);
        });
    });

    describe('Contents Pages', () => {
        it('should have roleGuard on contents index page', () => {
            expect(hasAdminGuard(contentsIndexMeta)).toBe(true);
        });

        it('should have roleGuard on add content page', () => {
            expect(hasAdminGuard(contentsAddMeta)).toBe(true);
        });

        it('should have roleGuard on edit content page', () => {
            expect(hasAdminGuard(contentsEditMeta)).toBe(true);
        });
    });

    describe('Users Pages', () => {
        it('should have roleGuard on users index page', () => {
            expect(hasAdminGuard(usersIndexMeta)).toBe(true);
        });

        it('should have roleGuard on add user page', () => {
            expect(hasAdminGuard(usersAddMeta)).toBe(true);
        });

        it('should have roleGuard on edit user page', () => {
            expect(hasAdminGuard(usersEditMeta)).toBe(true);
        });

        it('should have roleGuard on view user page', () => {
            expect(hasAdminGuard(usersViewMeta)).toBe(true);
        });

        it('should have roleGuard on users by role page', () => {
            expect(hasAdminGuard(usersRoleMeta)).toBe(true);
        });
    });

    describe('Guard Configuration', () => {
        it('all admin routes should use the same roleGuard instance', () => {
            const allMetas = [
                dashboardMeta,
                mediaMeta,
                settingsMeta,
                emailSettingMeta,
                userSettingMeta,
                messageMeta,
                siteUsageMeta,
                waitlistsMeta,
                templatesMeta,
                joinedUsersMeta,
                waitlistTagsMeta,
                contentTypesMeta,
                contentTypeTagsMeta,
                contentsIndexMeta,
                contentsAddMeta,
                contentsEditMeta,
                usersIndexMeta,
                usersAddMeta,
                usersEditMeta,
                usersViewMeta,
                usersRoleMeta,
                contentTypeAddMeta,
                contentTypeEditMeta,
                contentTypeViewMeta,
            ];

            allMetas.forEach((meta) => {
                expect(meta?.canActivate).toContain(roleGuard);
            });
        });

        it('all admin routes should require admin role', () => {
            const allMetas = [
                dashboardMeta,
                mediaMeta,
                settingsMeta,
                emailSettingMeta,
                userSettingMeta,
                messageMeta,
                siteUsageMeta,
                waitlistsMeta,
                templatesMeta,
                joinedUsersMeta,
                waitlistTagsMeta,
                contentTypesMeta,
                contentTypeTagsMeta,
                contentsIndexMeta,
                contentsAddMeta,
                contentsEditMeta,
                usersIndexMeta,
                usersAddMeta,
                usersEditMeta,
                usersViewMeta,
                usersRoleMeta,
                contentTypeAddMeta,
                contentTypeEditMeta,
                contentTypeViewMeta,
            ];

            allMetas.forEach((meta) => {
                expect(meta?.data?.allowedRoles).toContain('admin');
            });
        });
    });
});
