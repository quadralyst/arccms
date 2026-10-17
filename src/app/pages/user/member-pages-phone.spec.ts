/**
 * The member profile and dashboard on a phone (F26): one heading, no empty bands, the first
 * card right under the header. jsdom cannot lay a page out, so this checks the rules that
 * do it, read from the pages' source. Measured in a browser at 375 by 667 and 402 wide.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const read = (path: string) => readFileSync(resolve(__dirname, path), 'utf8');
const profilePage = read('profile/user-profile.page.ts');
const dashboardPage = read('(dashboard)/dashboard.page.ts');
const profileHtml = read('../(auth)/(profile)/profile.page.html');

describe('the member profile page', () => {
    it('has the page header as its one heading, and hides <arc-profile>\'s own heading and Back button', () => {
        expect(profilePage.match(/<arc-page-header/g)).toHaveLength(1);
        expect(profilePage).toContain('.profile-wrap ::ng-deep .profile-header { display: none; }');
        // The class it hides is still the one <arc-profile> draws.
        expect(profileHtml).toContain('class="profile-header"');
    });

    it('puts no second padding around <arc-profile>, and a narrow margin on a phone', () => {
        expect(profilePage).toContain('.profile-wrap ::ng-deep .profile-container { padding: 0; }');
        expect(profilePage).toMatch(/@media \(max-width: 768px\) \{\s*\.profile-wrap \{ padding: 12px; \}/);
    });

    it('has balanced div tags', () => {
        const open = profilePage.match(/<div\b/g)?.length ?? 0;
        expect(profilePage.match(/<\/div>/g)?.length ?? 0).toBe(open);
        expect(profileHtml.match(/<\/div>/g)?.length ?? 0).toBe(profileHtml.match(/<div\b/g)?.length ?? 0);
    });
});

describe('the member dashboard', () => {
    it('uses the compact page header, and a narrow margin on a phone', () => {
        expect(dashboardPage.match(/<arc-page-header/g)).toHaveLength(1);
        expect(dashboardPage).toMatch(/@media \(max-width: 768px\) \{\s*\.dash \{ padding: 12px; \}/);
    });
});
