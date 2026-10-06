/**
 * App accounts are locked (docs/app/app-accounts.html): the browser reads the lock as
 * the server and the rules do, and a locked account kept out of the member pages
 * lands somewhere that never sends it back.
 */
import { describe, expect, it } from 'vitest';
import { isLockedAppAccount, lockedAccountLanding, memberPagesOpen } from './app-account-lock';

describe('isLockedAppAccount', () => {
    it('is true for an app account unless selfService is true', () => {
        expect(isLockedAppAccount({ by: 'app' })).toBe(true);
        expect(isLockedAppAccount({ by: 'app', selfService: false })).toBe(true);
        expect(isLockedAppAccount({ by: 'app', selfService: true })).toBe(false);
    });

    it('is false for every other account, and for no account', () => {
        expect(isLockedAppAccount({ by: 'email' })).toBe(false);
        expect(isLockedAppAccount({ by: 'google' })).toBe(false);
        expect(isLockedAppAccount({})).toBe(false);
        expect(isLockedAppAccount(null)).toBe(false);
    });
});

describe('memberPagesOpen', () => {
    it('is open to everyone when the app chose nothing', () => {
        expect(memberPagesOpen({ by: 'app' }, {})).toBe(true);
        expect(memberPagesOpen({ by: 'email' }, {})).toBe(true);
    });

    it('closes only to locked app accounts when the app says so', () => {
        expect(memberPagesOpen({ by: 'app' }, { memberPages: false })).toBe(false);
        expect(memberPagesOpen({ by: 'app', selfService: true }, { memberPages: false })).toBe(true);
        expect(memberPagesOpen({ by: 'email' }, { memberPages: false })).toBe(true);
    });

    it('reads the shipped starter file as open', () => {
        expect(memberPagesOpen({ by: 'app' })).toBe(true);
    });
});

describe('lockedAccountLanding', () => {
    it("is the role's home page when that is the app's own", () => {
        expect(lockedAccountLanding('user', { user: '/front-desk' })).toBe('/front-desk');
        expect(lockedAccountLanding('user', { '*': '/kiosk' })).toBe('/kiosk');
    });

    it("is the site's home when the home page is a member page, so it never loops", () => {
        expect(lockedAccountLanding('user', {})).toBe('/');
        expect(lockedAccountLanding('user', { user: '/user/profile' })).toBe('/');
        expect(lockedAccountLanding('user', { user: '/account?tab=1' })).toBe('/');
        expect(lockedAccountLanding(null, {})).toBe('/');
    });
});
