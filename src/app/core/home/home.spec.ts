import { describe, expect, it } from 'vitest';
import { homeFor, safeRedirect } from './home';

describe('homeFor', () => {
    it('keeps Arc CMS\'s defaults without an app setting', () => {
        expect(homeFor('admin', {})).toBe('/admin/dashboard');
        expect(homeFor('user', {})).toBe('/user/dashboard');
        expect(homeFor('propertyOwner', {})).toBe('/user/dashboard');
        expect(homeFor(undefined, {})).toBe('/user/dashboard');
    });

    it('uses the app\'s page for a role, and its default for roles it does not list', () => {
        const app = { user: '/learn', '*': '/start' };
        expect(homeFor('user', app)).toBe('/learn');
        expect(homeFor(null, app)).toBe('/learn'); // no role means user
        expect(homeFor('teacher', app)).toBe('/start');
        expect(homeFor('admin', app)).toBe('/admin/dashboard'); // admins keep theirs unless listed
        expect(homeFor('admin', { admin: '/admin/contents' })).toBe('/admin/contents');
    });
});

describe('safeRedirect', () => {
    it('accepts a page on this site, with its query and fragment', () => {
        expect(safeRedirect('/learn')).toBe('/learn');
        expect(safeRedirect('/learn?child=2#lesson-3')).toBe('/learn?child=2#lesson-3');
        expect(safeRedirect('/admin/contacts')).toBe('/admin/contacts');
    });

    it('refuses anything that could leave the site', () => {
        for (const bad of ['https://evil.example', '//evil.example', '/\\evil.example', 'javascript:alert(1)', 'learn', '/x\n/y']) {
            expect(safeRedirect(bad)).toBeNull();
        }
        expect(safeRedirect(undefined)).toBeNull();
        expect(safeRedirect(['/learn'])).toBeNull();
    });

    it('refuses the sign-in pages themselves', () => {
        for (const loop of ['/signup', '/signup?redirect=/learn', '/login', '/auth-checker', '/onboarding/step-2']) {
            expect(safeRedirect(loop)).toBeNull();
        }
        expect(safeRedirect('/signups-report')).toBe('/signups-report');
    });
});
