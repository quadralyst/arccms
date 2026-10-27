/**
 * Warm-up calls (functions/src/auth/warmUp.ts): the sign-in page wakes the
 * functions it will call. Every function it names must answer a warm-up call
 * first thing, before any check, rate limit or read.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { isWarmUp, WARM } from '../auth/warmUp.js';

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SIGN_IN_SERVICE = resolve(SRC, '../../src/app/pages/(auth)/sign-in.service.ts');
const SIGN_IN_PAGE = resolve(SRC, '../../src/app/pages/(auth)/(signup)/signup.page.ts');

/** The names in SIGN_IN_FUNCTIONS, read from the page's service. */
function warmedNames(): string[] {
    const source = readFileSync(SIGN_IN_SERVICE, 'utf-8');
    const block = source.match(/export const SIGN_IN_FUNCTIONS = \{([\s\S]*?)\} as const;/);
    expect(block, 'SIGN_IN_FUNCTIONS in sign-in.service.ts').toBeTruthy();
    return [...block![1].matchAll(/'(\w+)'/g)].map((m) => m[1]);
}

/** The names the page wakes as each step opens (stepFunctions in signup.page.ts, F33). */
function stepNames(): string[] {
    const source = readFileSync(SIGN_IN_PAGE, 'utf-8');
    const block = source.match(/private stepFunctions\(step: SignupStep\): string\[\] \{([\s\S]*?)\n  \}/);
    expect(block, 'stepFunctions in signup.page.ts').toBeTruthy();
    // The names in the arrays each case returns, not the steps they are for.
    const returned = [...block![1].matchAll(/return ([^;]*);/g)].map((m) => m[1]).join(' ');
    return [...new Set([...returned.matchAll(/'(\w+)'/g)].map((m) => m[1]))];
}

function authSources(): string {
    return readdirSync(join(SRC, 'auth'))
        .filter((f) => f.endsWith('.ts'))
        .map((f) => readFileSync(join(SRC, 'auth', f), 'utf-8'))
        .join('\n');
}

describe('warm-up calls', () => {
    it('recognises only an explicit warm-up', () => {
        expect(isWarmUp({ data: { warmUp: true } })).toBe(true);
        for (const data of [undefined, null, {}, { warmUp: 'true' }, { warmUp: 1 }, { email: 'a@b.com' }]) {
            expect(isWarmUp({ data })).toBe(false);
        }
        expect(WARM).toEqual({ warm: true });
    });

    it('every function the sign-in page warms answers a warm-up call first', () => {
        const names = [...new Set([...warmedNames(), ...stepNames()])];
        expect(stepNames()).toEqual(expect.arrayContaining(['signInWithPin', 'resetPin', 'resetPassword', 'setPin']));
        expect(names.length).toBeGreaterThanOrEqual(10);
        const sources = authSources();
        const missing = names.filter((name) => !new RegExp(
            `export const ${name} = onCall\\(async \\(request\\) => \\{\\s*if \\(isWarmUp\\(request\\)\\) return WARM;`,
        ).test(sources));
        expect(missing).toEqual([]);
    });
});
