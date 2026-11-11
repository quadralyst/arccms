/**
 * RF6 6.1: the /waitlist page says why a step failed by the callable's code and
 * reason, in the member's language, never with the server's English, as
 * arc-site.js does on published pages.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import en from '../../../assets/i18n/en.json';
import hi from '../../../assets/i18n/hi.json';
import { signupErrorKey } from './signup-error';

const failure = (code: string, reason?: string) => ({ code: `functions/${code}`, message: 'SERVER ENGLISH', ...(reason ? { details: { reason } } : {}) });

describe('signupErrorKey', () => {
    afterEach(() => vi.unstubAllGlobals());

    it('words each refusal by its code and reason', () => {
        expect(signupErrorKey(failure('failed-precondition', 'form-closed'), 'join')).toBe('member.signup_form.errors.form_closed');
        expect(signupErrorKey(failure('not-found', 'form-missing'), 'join')).toBe('member.signup_form.errors.form_closed');
        expect(signupErrorKey(failure('permission-denied'), 'confirm')).toBe('member.signup_form.errors.expired');
        expect(signupErrorKey(failure('resource-exhausted', 'wait'), 'resend')).toBe('member.signup_form.errors.wait');
        expect(signupErrorKey(failure('resource-exhausted', 'too-many-codes'), 'resend')).toBe('member.signup_form.errors.too_many_codes');
        expect(signupErrorKey(failure('resource-exhausted', 'code-locked'), 'verify')).toBe('member.signup_form.errors.code_locked');
        expect(signupErrorKey(failure('resource-exhausted'), 'join')).toBe('member.signup_form.errors.too_many');
        expect(signupErrorKey(failure('invalid-argument'), 'verify')).toBe('member.signup_form.errors.code_invalid');
        expect(signupErrorKey(failure('invalid-argument'), 'join')).toBe('member.signup_form.errors.check_answers');
    });

    it('falls back to the step\'s own line for anything else, and an error with no code', () => {
        expect(signupErrorKey(failure('internal'), 'join')).toBe('member.signup_form.errors.failed');
        expect(signupErrorKey(new Error('boom'), 'resend')).toBe('member.signup_form.errors.resend_failed');
        expect(signupErrorKey(undefined, 'verify')).toBe('member.signup_form.errors.code_invalid');
        expect(signupErrorKey(null, 'confirm')).toBe('member.signup_form.errors.verify_failed');
    });

    it('says there is no connection when the browser is offline', () => {
        vi.stubGlobal('navigator', { onLine: false });
        expect(signupErrorKey(failure('internal'), 'join')).toBe('member.signup_form.errors.offline');
    });

    it('has every line in English and Hindi', () => {
        const keys = Object.keys(en.member.signup_form.errors);
        expect(keys.length).toBeGreaterThan(10);
        expect(Object.keys(hi.member.signup_form.errors).sort()).toEqual(keys.sort());
    });
});
