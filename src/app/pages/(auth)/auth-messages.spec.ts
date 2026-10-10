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
