/** Firebase Auth's errors in the person's words (auth-messages.ts). */
import { describe, it, expect } from 'vitest';
import { firebaseErrorMessage } from './auth-messages';
import { english } from '../../../test/english';

describe('firebaseErrorMessage', () => {
    const say = (key: string, params?: Record<string, unknown>) => english(key, params);

    it('says the shortest password for a password Firebase refused as weak (sign-in strength)', () => {
        expect(firebaseErrorMessage(say as never, 'auth/weak-password')).toBe('Use at least 8 characters for your password.');
    });

    it('falls back to the general words for a code it does not know', () => {
        expect(firebaseErrorMessage(say as never, 'auth/something-new')).toBe(english('member.errors.generic'));
    });
});

describe('the sign-in words (RF6, 6.11)', () => {
    const flat = (o: Record<string, unknown>, p = ''): [string, string][] => Object.entries(o).flatMap(([k, v]) =>
        typeof v === 'object' && v ? flat(v as Record<string, unknown>, `${p}${k}.`) : [[`${p}${k}`, String(v)] as [string, string]]);
    const en = flat(require('../../../assets/i18n/en.json').member.auth);
    const hi = flat(require('../../../assets/i18n/hi.json').member.auth);

    it('says Sign in and Sign out, never Login, log in or logging in', () => {
        expect(en.filter(([, text]) => /\blog\s?(in|out)\b|\blogin\b|\blogout\b|\blogging\b|\blogged\b/i.test(text))).toEqual([]);
        expect(hi.filter(([, text]) => /लॉग इन|लॉग आउट|लॉगिन/.test(text))).toEqual([]);
    });

    it('writes titles in sentence case: one capital, then names like PIN and Google', () => {
        const titles = en.filter(([key]) => /^step_title_|^(welcome_back_greeting|complete_profile|create_account|login)$/.test(key));
        expect(titles.length).toBeGreaterThan(10);
        const shouting = titles.filter(([, text]) => text.split(/\s+/).slice(1).some((word) => /^[A-Z][a-z]/.test(word)));
        expect(shouting).toEqual([]);
    });
});
