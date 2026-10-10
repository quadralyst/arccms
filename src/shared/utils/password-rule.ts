/**
 * What makes a new password too easy to guess (F22). PINs have their own check on
 * the server (isWeakPin); a password is refused when it is:
 *
 * - `short`: under 8 characters;
 * - `repeated`: one character over and over (`aaaaaaaa`, `11111111`);
 * - `sequence`: a straight run, forwards or back, of digits, letters or a keyboard
 *   row (`12345678`, `abcdefgh`, `qwertyui`, `87654321`);
 * - `common`: one of the most used passwords, or one of their words with digits
 *   or symbols after it (`password1`, `P@ssw0rd!`, `iloveyou2024`);
 * - `personal`: the person's email name or a part of their name in it.
 *
 * Only new passwords are checked: signing in with one set before still works.
 *
 * That is the strict rule. An app that chose `simple` (src/custom/sign-in.ts,
 * sign-in-strength.ts) asks only for 6 characters or more; the caller passes the
 * strength, and leaving it out means strict.
 *
 * Source of truth; functions/src/shared/password-rule.ts is a mirror for the
 * Cloud Functions build, which cannot import from src/. password-rule.spec.ts
 * checks the two agree.
 */

import type { SignInStrength } from './sign-in-strength.js';

/** The shortest new password under the strict rule. */
export const MIN_PASSWORD_LENGTH = 8;
/** The shortest new password under the simple rule: Firebase Auth's own minimum. */
export const SIMPLE_MIN_PASSWORD_LENGTH = 6;

/** The shortest new password for a strength. */
export function minPasswordLength(strength: SignInStrength = 'strict'): number {
    return strength === 'simple' ? SIMPLE_MIN_PASSWORD_LENGTH : MIN_PASSWORD_LENGTH;
}

export type PasswordProblem = 'short' | 'repeated' | 'sequence' | 'common' | 'personal';

/**
 * Each problem in English under the strict rule: the server's fallback and the
 * admin's words (passwordProblemText says the simple rule's length). Members read it
 * in their language, from `member.auth.password_error.<problem>`.
 */
export const PASSWORD_PROBLEM_TEXT: Record<PasswordProblem, string> = {
    short: 'Use at least 8 characters.',
    repeated: 'That password is one character repeated. Choose one that is harder to guess.',
    sequence: 'That password is a straight run, like 12345678 or abcdefgh. Choose one that is harder to guess.',
    common: 'That password is one of the most used, so it is easy to guess. Choose another.',
    personal: 'Your password should not contain your name or email. Choose another.',
};

/** A problem in English, with the shortest length for the strength. */
export function passwordProblemText(problem: PasswordProblem, strength: SignInStrength = 'strict'): string {
    return problem === 'short' ? `Use at least ${minPasswordLength(strength)} characters.` : PASSWORD_PROBLEM_TEXT[problem];
}

/** Who the password is for: their own details make a weak password. */
export interface PasswordOwner {
    email?: string | null;
    name?: string | null;
}

const RUNS = ['01234567890', 'abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1qaz2wsx3edc4rfv'];

/** Whole passwords people choose most, of 8 characters or more. */
const COMMON_PASSWORDS = new Set([
    'password', 'passw0rd', 'p@ssw0rd', 'p@ssword', 'iloveyou', 'sunshine', 'princess', 'football', 'baseball',
    'welcome1', 'letmein1', 'trustno1', 'superman', 'whatever', 'starwars', 'computer', 'michelle', 'jennifer',
    'corvette', 'mercedes', 'mustang1', 'internet', 'samsung1', 'changeme', 'qwerty123', '1q2w3e4r', '1q2w3e4r5t',
    'qwer1234', 'asdf1234', 'zaq12wsx', 'q1w2e3r4', 'a1b2c3d4', 'abcd1234', 'abc12345', 'aa123456', 'qazwsxedc',
    'qwertyuiop', '11223344', '12341234', '12121212', '11112222', '123123123', '123321123', '147258369',
    '159753123', '789456123', '987654321', 'iloveyou1', 'password1', 'password12', 'password123', 'admin123',
    'administrator', 'welcome123', 'letmein123', 'secret123', 'master123', 'india123', 'india@123',
]);

/** Words that, with digits or symbols after them, are among the most used passwords. */
const COMMON_WORDS = new Set([
    'password', 'passwd', 'pass', 'qwerty', 'letmein', 'welcome', 'iloveyou', 'admin', 'administrator', 'login',
    'monkey', 'dragon', 'football', 'baseball', 'sunshine', 'princess', 'superman', 'batman', 'master', 'shadow',
    'secret', 'trustno', 'abc', 'abcd', 'test', 'guest', 'user', 'india', 'changeme', 'default', 'hello', 'love',
]);

/** The password read as a word: lower case, common swaps undone (`p@ssw0rd` → `password`). */
function asWord(text: string): string {
    return text.toLowerCase().replace(/@/g, 'a').replace(/0/g, 'o').replace(/3/g, 'e').replace(/\$/g, 's').replace(/!/g, 'i');
}

function isRun(text: string): boolean {
    const lower = text.toLowerCase();
    return RUNS.some((run) => run.includes(lower) || [...run].reverse().join('').includes(lower));
}

/** The word before whatever digits and symbols end it: `Password123!` → `password`. */
function stemOf(lower: string): string {
    return lower.replace(/[^\p{L}\p{M}]+$/u, '');
}

function isCommon(lower: string): boolean {
    if (COMMON_PASSWORDS.has(lower) || COMMON_WORDS.has(asWord(lower))) return true;
    const stem = stemOf(lower);
    return stem.length >= 3 && (COMMON_WORDS.has(stem) || COMMON_WORDS.has(asWord(stem)));
}

/** The person's own details, in parts: the email's name and its words, the name's words. */
function personalParts(owner: PasswordOwner): string[] {
    const local = String(owner.email ?? '').toLowerCase().split('@')[0] ?? '';
    // Letters with their marks: a Devanagari vowel sign is part of the word (आशा).
    const words = (text: string) => text.split(/[^\p{L}\p{M}\p{N}]+/u);
    return [local, ...words(local), ...words(String(owner.name ?? '').toLowerCase())].filter((part) => part.length >= 2);
}

/**
 * Their details in it: a part of 4 letters or more anywhere in it (`asha` in
 * `Asha@2024`), or a shorter one as its whole word (`rao` in `rao12345`), so a short
 * name inside a longer word (`lee` in `fleece-river-9`) is not held against it.
 */
function isPersonal(lower: string, owner: PasswordOwner): boolean {
    const stem = stemOf(lower);
    return personalParts(owner).some((part) => (part.length >= 4 && lower.includes(part)) || stem === part || lower === part);
}

/** Why this new password is too easy to guess, or null when it is fine. */
export function passwordProblem(password: string, owner: PasswordOwner = {}, strength: SignInStrength = 'strict'): PasswordProblem | null {
    const value = String(password ?? '');
    if (value.length < minPasswordLength(strength)) return 'short';
    if (strength === 'simple') return null;
    if (/^(.)\1+$/su.test(value.toLowerCase())) return 'repeated';
    if (isRun(value)) return 'sequence';
    const lower = value.toLowerCase();
    if (isCommon(lower)) return 'common';
    if (isPersonal(lower, owner)) return 'personal';
    return null;
}
