/**
 * The password rule (F22): this file's source is src/shared/utils/password-rule.ts,
 * and functions/src/shared/password-rule.ts its mirror for the server.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { minPasswordLength, passwordProblem, passwordProblemText, PASSWORD_PROBLEM_TEXT } from './password-rule';
import * as server from '../../../functions/src/shared/password-rule';

const ASHA = { email: 'asha.rao@example.com', name: 'Asha Rao' };

const CASES: Array<[string, ReturnType<typeof passwordProblem>, { email?: string; name?: string }?]> = [
    ['short', 'short'],
    ['abc1234', 'short'],
    ['aaaaaaaa', 'repeated'],
    ['11111111', 'repeated'],
    ['12345678', 'sequence'],
    ['87654321', 'sequence'],
    ['abcdefgh', 'sequence'],
    ['ABCDEFGHIJ', 'sequence'],
    ['qwertyui', 'sequence'],
    ['1234567890', 'sequence'],
    ['password', 'common'],
    ['Password1', 'common'],
    ['Password123!', 'common'],
    ['P@ssw0rd!', 'common'],
    ['iloveyou2024', 'common'],
    ['qwerty123', 'common'],
    ['welcome@1', 'common'],
    ['abcd1234', 'common'],
    ['india@123', 'common'],
    ['Asha@2024', 'personal', ASHA],
    ['rao12345', 'personal', ASHA],
    ['asha.rao@example.com', 'personal', ASHA],
    ['आशा@2024', 'personal', { name: 'आशा राव' }],
    ['राव12345', 'personal', { name: 'आशा राव' }],
    // Fine: long enough, not simple, and nothing of the person in it.
    ['correct horse battery', null, ASHA],
    ['Tr4vel-Mango-91', null, ASHA],
    ['fleece-river-9', null, { email: 'lee@example.com', name: 'Ann Lee' }],
    ['Kx9#mPq2vL', null],
    ['Asha@2024', null],
    ['passport-holder-77', null],
];

describe('passwordProblem', () => {
    it.each(CASES)('%j is %s', (password, problem, owner) => {
        expect(passwordProblem(password, owner)).toBe(problem);
    });

    it('a password that passes today and is not simple still passes', () => {
        for (const password of ['Monsoon-Train-42', 'blue.teapot.sings', 'Zebra#Coffee88']) {
            expect(passwordProblem(password, ASHA)).toBeNull();
        }
    });

    it('the server answers the same as the page', () => {
        for (const [password, , owner] of CASES) {
            expect(server.passwordProblem(password, owner)).toBe(passwordProblem(password, owner));
        }
        expect(server.MIN_PASSWORD_LENGTH).toBe(8);
    });

    it('leaving the strength out means strict (sign-in strength, SS3)', () => {
        for (const [password, problem, owner] of CASES) expect(passwordProblem(password, owner, 'strict')).toBe(problem);
    });

    it('the simple rule asks only for 6 characters, the server the same', () => {
        for (const [password, problem] of [['abc12', 'short'], ['', 'short'], ['abc123', null], ['111111', null], ['123456', null], ['password', null]] as const) {
            expect(passwordProblem(password, ASHA, 'simple')).toBe(problem);
            expect(server.passwordProblem(password, ASHA, 'simple')).toBe(problem);
        }
        expect(passwordProblem('Asha@2024', ASHA, 'simple')).toBeNull();
        expect([minPasswordLength(), minPasswordLength('strict'), minPasswordLength('simple')]).toEqual([8, 8, 6]);
    });

    it('says the length for the strength, and the strict words for everything else', () => {
        expect(passwordProblemText('short')).toBe('Use at least 8 characters.');
        expect(passwordProblemText('short', 'simple')).toBe('Use at least 6 characters.');
        expect(passwordProblemText('short', 'strict')).toBe(PASSWORD_PROBLEM_TEXT.short);
        expect(passwordProblemText('common', 'simple')).toBe(PASSWORD_PROBLEM_TEXT.common);
    });

    it('the server copy is this file, line for line after its opening comment', () => {
        const body = (path: string) => readFileSync(resolve(__dirname, path), 'utf8').replace(/^\/\*\*[\s\S]*?\*\/\s*/, '');
        expect(body('../../../functions/src/shared/password-rule.ts')).toBe(body('./password-rule.ts'));
    });
});
