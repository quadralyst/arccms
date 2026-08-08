/**
 * Regression guard for the `Settings/emailTestingConnection` credential exposure.
 *
 * The connection test used to write the provider configuration — SMTP password,
 * Gmail password, Resend API key — into `Settings/emailTestingConnection` and let
 * a Firestore trigger act on it. The trigger wrote only `status`/`message`/
 * `updatedAt` back, so the credentials were persisted indefinitely.
 *
 * Guarding it in the rules was a nested `match /emailTestingConnection` inside
 * `match /Settings/{settingId}`, which resolves to the COLLECTION path
 * `Settings/{settingId}/emailTestingConnection` — no document wildcard, so it
 * granted nothing and the `isAdmin()` catch-all did the real work. A downstream
 * fork rewrote that dead rule as a live `settingId == 'emailTestingConnection'`,
 * making the credentials readable and writable by anyone, authenticated or not.
 *
 * The document is gone; the test is the auth-gated `testSmtpConfigConnection`
 * callable. These assertions exist so it cannot come back quietly.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

const FUNCTIONS_SRC = path.resolve(__dirname, '..');
const REPO_ROOT = path.resolve(FUNCTIONS_SRC, '../..');

function readRules(): string {
    return fs.readFileSync(path.resolve(REPO_ROOT, 'firestore.rules'), 'utf-8');
}

/**
 * Rules with `//` comments stripped. The file deliberately *describes* the removed
 * `emailTestingConnection` rule so the mistake is not repeated, and prose about a
 * rule must not read as the rule itself.
 */
function readEffectiveRules(): string {
    return readRules()
        .split('\n')
        .map((line) => line.replace(/\/\/.*$/, ''))
        .join('\n');
}

describe('onEmailConnectionTestCreate is gone', () => {
    it('the trigger source file no longer exists', () => {
        const triggerPath = path.resolve(FUNCTIONS_SRC, 'mail-config/onEmailConnectionTestCreate.ts');
        expect(fs.existsSync(triggerPath)).toBe(false);
    });

    it('is not exported from the functions index', () => {
        const index = fs.readFileSync(path.resolve(FUNCTIONS_SRC, 'index.ts'), 'utf-8');
        expect(index).not.toMatch(/onEmailConnectionTestCreate/);
    });

    it('no function still triggers on the Settings/emailTestingConnection document', () => {
        const hits: string[] = [];
        const walk = (dir: string) => {
            for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
                    walk(full);
                } else if (entry.name.endsWith('.ts')) {
                    if (fs.readFileSync(full, 'utf-8').includes('emailTestingConnection')) {
                        hits.push(path.relative(FUNCTIONS_SRC, full));
                    }
                }
            }
        };
        walk(FUNCTIONS_SRC);
        expect(hits).toEqual([]);
    });

    it('keeps the auth-gated callable that replaced it', () => {
        const callable = fs.readFileSync(
            path.resolve(FUNCTIONS_SRC, 'mail-config/testSmtpConfigConnection.ts'),
            'utf-8',
        );
        expect(callable).toMatch(/if \(!request\.auth\)/);
        expect(callable).toMatch(/'unauthenticated'/);
        // Destructures the nested payload shape both clients send.
        expect(callable).toMatch(/const \{ config, activeProvider, testEmail, subject, message \} = request\.data/);
    });
});

describe('firestore.rules — Settings secrets', () => {
    it('has no rule granting access to emailTestingConnection', () => {
        const rules = readEffectiveRules();
        // No match block for it — the dead nested one was the template for the
        // fork's bug, so it does not come back even in its harmless form.
        expect(rules).not.toMatch(/match\s+\/emailTestingConnection/);
        // And no condition names it, which is how the fork made it world-writable.
        expect(rules).not.toMatch(/emailTestingConnection/);
    });

    it('never grants an unconditional read or write anywhere in Settings', () => {
        const rules = readEffectiveRules();
        const settingsBlock = rules.slice(
            rules.indexOf('match /Settings/{settingId}'),
            rules.indexOf('// 3. USERS'),
        );
        expect(settingsBlock.length).toBeGreaterThan(0);
        expect(settingsBlock).not.toMatch(/allow\s+read,\s*write:\s*if\s+true/);
        expect(settingsBlock).not.toMatch(/allow\s+write:\s*if\s+true/);
    });

    it('does not let a merely-authenticated user reach the documents holding secrets', () => {
        const rules = readEffectiveRules();
        const authenticatedList = rules.slice(
            rules.indexOf('allow read, write: if isAuthenticated() && settingId in ['),
            rules.indexOf('];', rules.indexOf('allow read, write: if isAuthenticated() && settingId in [')),
        );
        expect(authenticatedList.length).toBeGreaterThan(0);
        // `email` holds smtp/gmail passwords and the Resend API key.
        expect(authenticatedList).not.toMatch(/'email'/);
        // `integrations` holds the Unsplash secretKey and the geo API key.
        expect(authenticatedList).not.toMatch(/'integrations'/);
        // `analytics` holds the Google OAuth clientSecret.
        expect(authenticatedList).not.toMatch(/'analytics'/);
        // Public-safe status flags, not secrets — these may stay.
        expect(authenticatedList).toMatch(/'email_status'/);
    });
});
