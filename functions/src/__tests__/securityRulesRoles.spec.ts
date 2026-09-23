/**
 * Source-level guards for the CO1 security baseline (docs/coexistence-spec.md).
 *
 * The behavioural tests run against the emulators (`npm run test:rules`,
 * tests/rules/). These run in the default `npm run test` so the two holes
 * CO1 closed cannot quietly come back in a rules edit:
 *   1. any signed-in user could write `role: 'admin'` into their own users doc,
 *      which onUserRoleChange turned into the admin claim, and could read every
 *      user's doc;
 *   2. any signed-in user could write content types, content, tags, media, the
 *      publish queue and storage.
 */
import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const REPO_ROOT = path.resolve(__dirname, '../../..');

/** Rules with `//` comments stripped, so prose about a rule never reads as the rule. */
function effective(file: string): string {
    return fs.readFileSync(path.resolve(REPO_ROOT, file), 'utf-8')
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n');
}

/** The body of the first `match <path> { ... }` block, braces balanced. */
function matchBlock(rules: string, matchPath: string): string {
    const start = rules.indexOf(`match ${matchPath} {`);
    expect(start, `match ${matchPath} not found`).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = start + `match ${matchPath} `.length; i < rules.length; i++) {
        if (rules[i] === '{') depth++;
        if (rules[i] === '}' && --depth === 0) return rules.slice(start, i + 1);
    }
    throw new Error(`unbalanced block for ${matchPath}`);
}

describe('firestore.rules: users', () => {
    const rules = effective('firestore.rules');
    const users = matchBlock(rules, '/users/{userId}');

    it('does not allow every signed-in user to read or create', () => {
        expect(users).not.toMatch(/allow read:\s*if isAuthenticated\(\);/);
        expect(users).not.toMatch(/allow create:\s*if isAuthenticated\(\)\s*\|\|/);
    });

    it('scopes create to your own uid and a self-assignable role', () => {
        expect(users).toMatch(/request\.resource\.data\.uid == request\.auth\.uid/);
        expect(users).toMatch(/isSelfAssignableRole\(request\.resource\.data\)/);
        expect(rules).toMatch(/function isSelfAssignableRole\(data\)\s*\{\s*return !\('role' in data\) \|\| data\.role == 'user';/);
    });

    it('blocks role, uid and the admin switches on self-update', () => {
        const blocked = users.match(/hasAny\(\[([^\]]+)\]\)/)?.[1] ?? '';
        for (const key of ['role', 'uid', 'isActive', 'status', 'isPro', 'creditBalance']) {
            expect(blocked).toContain(`'${key}'`);
        }
    });

    it('limits reads to admins and the owner', () => {
        expect(users).toMatch(/allow read:\s*if isAdmin\(\) \|\| isOwnUserDoc\(\);/);
    });

    it('closes the first-admin sentinel to clients', () => {
        expect(matchBlock(rules, '/_system/{docId}')).toMatch(/allow read, write:\s*if false;/);
    });

    it('keeps Settings/users (defaultRole) out of the any-signed-in-user write list', () => {
        const settings = matchBlock(rules, '/Settings/{settingId}');
        const authList = settings.match(/allow read, write: if isAuthenticated\(\) && settingId in \[([^\]]+)\]/)?.[1] ?? '';
        expect(authList).not.toBe('');
        expect(authList).not.toContain("'users'");
    });
});

describe('firestore.rules: content writes are staff only', () => {
    const rules = effective('firestore.rules');

    it.each(['/ContentTypes/{docId}', '/media/{docId}', '/_publish_queue/{docId}'])('%s', (p) => {
        const block = matchBlock(rules, p);
        expect(block).toMatch(/allow write:\s*if isEditor\(\);/);
        expect(block).not.toMatch(/allow write:\s*if isAuthenticated\(\);/);
    });

    it('arc_* and Tags_* writes need isEditor()', () => {
        expect(rules).toMatch(/collection\.matches\('arc_\.\*'\) \|\| collection\.matches\('Tags_\.\*'\)\)\s*&& isEditor\(\);/);
    });

    it('isEditor() is built on the role claim only', () => {
        expect(rules).toMatch(/function isEditor\(\)\s*\{\s*return isAdmin\(\) \|\|\s*\(isAuthenticated\(\) && request\.auth\.token\.role == 'editor'\);/);
    });
});

describe('storage.rules', () => {
    const rules = effective('storage.rules');

    it('no path is writable by every signed-in user', () => {
        expect(rules).not.toMatch(/allow write:\s*if isAuthenticated\(\);/);
    });

    it('members may write only their own avatar folder', () => {
        const avatars = matchBlock(rules, '/avatars/{uid}/{fileName}');
        expect(avatars).toMatch(/request\.auth\.uid == uid/);
    });
});

describe('frontend never self-writes an elevated role', () => {
    const read = (p: string) => fs.readFileSync(path.resolve(REPO_ROOT, p), 'utf-8');

    it('the onboarding wizard creates a user doc and claims admin through the callable', () => {
        const page = read('src/app/pages/(onboarding)/onboarding.page.ts');
        expect(page).not.toMatch(/role:\s*this\.constantVariables\.ADMIN/);
        expect(read('src/app/pages/(onboarding)/onboarding-setup.service.ts')).toContain("'claimFirstAdmin'");
    });

    it('the sign-up page writes role user, not the configured default', () => {
        const page = read('src/app/pages/(auth)/(signup)/signup.page.ts');
        expect(page).not.toMatch(/role:\s*this\.defaultRole/);
        expect(page).toMatch(/role:\s*'user'/);
    });
});
