import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/fire/functions', () => ({ Functions: class {}, httpsCallable: vi.fn() }));

import { readSignInError, translateRefusal, SIGN_IN_FUNCTIONS, SignInService } from './sign-in.service';
import { deviceKey } from '../../core/sign-in/device-key';
import { english } from '../../../test/english';

const ensureRecordClaim = SignInService.prototype.ensureRecordClaim;

function ctx(claim: string | undefined, role?: string) {
    const user = {
        getIdTokenResult: vi.fn(async () => ({
            claims: { ...(claim ? { arccms_uid: claim } : {}), ...(role ? { arccms_role: role } : {}) },
        })),
        getIdToken: vi.fn(async () => 'token'),
    };
    return { auth: { currentUser: user }, call: vi.fn(async () => ({})), user };
}

describe('SignInService.ensureRecordClaim', () => {
    it('does nothing when the token already carries the record id', async () => {
        const c = ctx('rec-1');
        await expect(ensureRecordClaim.call(c as never, 'rec-1')).resolves.toBe(false);
        expect(c.call).not.toHaveBeenCalled();
    });

    it('does nothing when the token also carries the record role', async () => {
        const c = ctx('rec-1', 'admin');
        await expect(ensureRecordClaim.call(c as never, 'rec-1', 'admin')).resolves.toBe(false);
        expect(c.call).not.toHaveBeenCalled();
    });

    it('refreshes when the role claim is missing or differs from the record (CO-D7)', async () => {
        for (const [claimRole, recordRole] of [[undefined, 'admin'], ['user', 'admin'], ['admin', 'user'], ['admin', '']]) {
            const c = ctx('rec-1', claimRole);
            await expect(ensureRecordClaim.call(c as never, 'rec-1', recordRole)).resolves.toBe(true);
            expect(c.call).toHaveBeenCalledWith('refreshMyClaims', {});
        }
    });

    it('asks the server for the claim, then refreshes the token, when it is missing or stale', async () => {
        for (const claim of [undefined, 'old-rec']) {
            const c = ctx(claim);
            await expect(ensureRecordClaim.call(c as never, 'rec-1')).resolves.toBe(true);
            expect(c.call).toHaveBeenCalledWith('refreshMyClaims', {});
            expect(c.user.getIdToken).toHaveBeenCalledWith(true);
        }
    });
});

describe('readSignInError', () => {
    it('keeps the server message and reason, hides internal errors', () => {
        expect(readSignInError({ code: 'functions/failed-precondition', message: 'Sign in again.', details: { reason: 'recent-sign-in' } }))
            .toEqual({ code: 'failed-precondition', message: 'Sign in again.', reason: 'recent-sign-in', details: { reason: 'recent-sign-in' } });
        expect(readSignInError({ code: 'functions/internal', message: 'stack trace' }, 'Oops').message).toBe('Oops');
    });
});

describe('translateRefusal (specs/sign-in-codes-spec.md, SC-D7)', () => {
    const en = (key: string, params: Record<string, unknown>) => english(key, params);

    it('says a refusal with a reason in the member\'s strings, with its numbers', () => {
        expect(translateRefusal({ reason: 'wait', wait: 39 }, en, 'en')).toBe('Please wait 39 seconds before asking for another code.');
        expect(translateRefusal({ reason: 'wrong', remaining: 2 }, en, 'en')).toBe('Wrong PIN. 2 left.');
    });

    it('says when a limit reopens as a clock time in the member\'s language', () => {
        const now = new Date(2026, 9, 8, 17, 0, 0).getTime();
        expect(translateRefusal({ reason: 'too-many-codes', retryAfter: 42 * 60 }, en, 'en', now)).toBe('Too many codes. Try again after 5:42 PM.');
    });

    it('says why a new password was refused, in the page\'s own words (F22)', () => {
        expect(translateRefusal({ reason: 'weak-password', problem: 'common' }, en, 'en')).toBe(english('member.auth.password_error.common'));
        expect(translateRefusal({ reason: 'weak-password', problem: 'personal' }, en, 'en')).toBe(english('member.auth.password_error.personal'));
        // No usable problem: the general words.
        expect(translateRefusal({ reason: 'weak-password', problem: '../x' }, en, 'en')).toBe(english('member.auth.server_error.weak_password'));
    });

    it('says the shortest password the server names, else this app\'s own (sign-in strength)', () => {
        expect(translateRefusal({ reason: 'weak-password', problem: 'short', min: 6 }, en, 'en')).toBe('Use at least 6 characters.');
        expect(translateRefusal({ reason: 'password-required', min: 6 }, en, 'en')).toBe('Choose a password of at least 6 characters.');
        // A server deployed before it sent `min`: the app is strict in core specs.
        expect(translateRefusal({ reason: 'weak-password', problem: 'short' }, en, 'en')).toBe('Use at least 8 characters.');
        expect(translateRefusal({ reason: 'password-required' }, en, 'en')).toBe('Choose a password of at least 8 characters.');
    });

    it('keeps the server\'s text for no reason, or a reason with no string', () => {
        expect(translateRefusal(undefined, en, 'en')).toBeNull();
        expect(translateRefusal({ reason: 'something-new' }, en, 'en')).toBeNull();
        expect(translateRefusal({ reason: '../x' }, en, 'en')).toBeNull();
    });
});

describe('every reason the sign-in functions give has a member string (SC-D8)', () => {
    it('in English and Hindi', async () => {
        const { readdirSync, readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const auth = resolve(__dirname, '../../../../functions/src/auth');
        const reasons = new Set<string>(['too-many-attempts']);
        for (const file of readdirSync(auth).filter((f) => f.endsWith('.ts'))) {
            const text = readFileSync(resolve(auth, file), 'utf8');
            for (const m of text.matchAll(/refuse\(\s*'[a-z-]+',\s*'([a-z-]+)'/g)) reasons.add(m[1]);
            for (const m of text.matchAll(/new HttpsError\(([\s\S]*?)\);/g)) {
                const reason = /reason: '([a-z-]+)'/.exec(m[1])?.[1];
                if (reason) reasons.add(reason);
            }
            for (const m of text.matchAll(/consumeRateLimit\([^;]*?'([a-z]+(?:-[a-z]+)+)'\);/g)) reasons.add(m[1]);
        }
        const hi = (await import('../../../assets/i18n/hi.json')).default as any;
        const missing = [...reasons].map((r) => r.replace(/-/g, '_'))
            .filter((k) => english(`member.auth.server_error.${k}`).startsWith('member.') || !hi.member.auth.server_error?.[k]);
        expect(reasons.size).toBeGreaterThan(30);
        expect(missing).toEqual([]);
    });
});

describe('SignInService code tickets (review F)', () => {
    const proto = SignInService.prototype as unknown as Record<string, (...args: unknown[]) => Promise<unknown>>;

    function service(email = 'asha@example.com') {
        const replies: Record<string, unknown> = {
            verifyPhoneOtp: { verified: true, ticket: 'phone-ticket' },
            verifySignupOtp: { verified: true, ticket: 'email-ticket' },
            completePhoneSignup: { token: 't' },
            resetPin: { token: 't' },
            createAccountRecord: { id: 'rec', created: true },
        };
        const c: Record<string, any> = {
            tickets: new Map<string, string>(),
            auth: { currentUser: { email, getIdToken: vi.fn() } },
            call: vi.fn(async (name: string) => replies[name]),
            signInWithToken: vi.fn(),
        };
        c['rememberTicket'] = (proto as any)['rememberTicket'].bind(c);
        return c;
    }

    it('sends the ticket from verifying a phone code with the step that uses it, once', async () => {
        const c = service();
        await proto['verifyPhoneCode'].call(c, '+919876543210', '123456', 'reset');
        await proto['resetPin'].call(c, '+919876543210', '246810');
        expect(c['call']).toHaveBeenLastCalledWith('resetPin', { phone: '+919876543210', pin: '246810', ticket: 'phone-ticket', deviceKey: deviceKey() });
        expect(c['tickets'].size).toBe(0);
    });

    it('keeps sign-up and reset tickets apart', async () => {
        const c = service();
        await proto['verifyPhoneCode'].call(c, '+919876543210', '123456', 'reset');
        await proto['completePhoneSignup'].call(c, '+919876543210', 'Asha', '246810');
        expect(c['call']).toHaveBeenLastCalledWith('completePhoneSignup', { phone: '+919876543210', name: 'Asha', pin: '246810', ticket: undefined, deviceKey: deviceKey() });
    });

    it('sends the email ticket when creating the account for that address', async () => {
        const c = service('Asha@Example.com');
        await proto['verifySignupCode'].call(c, 'asha@example.com ', '123456');
        await proto['createAccountRecord'].call(c, 'Asha');
        expect(c['call']).toHaveBeenLastCalledWith('createAccountRecord', { name: 'Asha', ticket: 'email-ticket' });
    });
});

describe('SignInService.warmUp', () => {
    const warmUp = SignInService.prototype.warmUp;

    function ctx() {
        return { lastWarmUp: 0, call: vi.fn(async () => ({ warm: true })) };
    }

    it('wakes the email functions with a warm-up call, and phone and Google only when they are on', () => {
        const c = ctx();
        warmUp.call(c as never, { phone: false, google: false });
        expect(c.call.mock.calls.map(([name]) => name)).toEqual([...SIGN_IN_FUNCTIONS.email]);
        for (const [, data] of c.call.mock.calls as unknown as [string, unknown][]) expect(data).toEqual({ warmUp: true });

        const all = ctx();
        warmUp.call(all as never, { phone: true, google: true });
        expect(all.call.mock.calls.map(([name]) => name)).toEqual([
            ...SIGN_IN_FUNCTIONS.email, ...SIGN_IN_FUNCTIONS.phone, ...SIGN_IN_FUNCTIONS.google,
        ]);
    });

    it('does not wake them again within a few minutes', () => {
        const c = ctx();
        warmUp.call(c as never, { phone: false, google: false });
        warmUp.call(c as never, { phone: true, google: true });
        expect(c.call).toHaveBeenCalledTimes(SIGN_IN_FUNCTIONS.email.length);
    });

    it('ignores a failed warm-up call', async () => {
        const c = { lastWarmUp: 0, call: vi.fn(async () => { throw new Error('offline'); }) };
        expect(() => warmUp.call(c as never, { phone: false, google: false })).not.toThrow();
        await Promise.resolve();
    });
});

describe('code emails in the member\'s language (specs/app-email-spec.md, AE-D5)', () => {
    const proto = SignInService.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    const page = (lang: string) => ({
        call: vi.fn(async () => ({})),
        transloco: { getActiveLang: () => lang },
        emailLanguage: proto['emailLanguage'],
    });

    it('asks for the sign-up, password reset and add-an-email codes in the page\'s language', async () => {
        const c = page('de');
        await proto['requestSignupCode'].call(c, 'a@example.com', 'Ada');
        await proto['requestPasswordReset'].call(c, 'a@example.com');
        await proto['requestEmailLinkCode'].call(c, 'a@example.com');
        expect(c.call).toHaveBeenNthCalledWith(1, 'requestSignupOtp', { email: 'a@example.com', name: 'Ada', language: 'de' });
        expect(c.call).toHaveBeenNthCalledWith(2, 'requestPasswordReset', { email: 'a@example.com', language: 'de' });
        expect(c.call).toHaveBeenNthCalledWith(3, 'requestEmailLinkOtp', { email: 'a@example.com', language: 'de' });
    });
});

describe('a code the check sends (specs/sign-in-speed-spec.md, SP-D5 to SP-D9)', () => {
    const proto = SignInService.prototype as unknown as Record<string, (...args: unknown[]) => unknown>;
    const page = (reply: Record<string, unknown>, lang = 'en') => ({
        call: vi.fn(async () => reply),
        transloco: { getActiveLang: () => lang, translate: (key: string, params: Record<string, unknown>) => english(key, params) },
        emailLanguage: proto['emailLanguage'],
        inMemberLanguage: proto['inMemberLanguage'],
        withCodeError: proto['withCodeError'],
    });

    it('asks the phone check to send only when told to', async () => {
        const c = page({ phone: '+919876543210', exists: false, hasPin: false, signupOpen: true });
        await proto['checkPhone'].call(c, '+919876543210', { sendCode: true });
        await proto['checkPhone'].call(c, '+919876543210');
        expect(c.call).toHaveBeenNthCalledWith(1, 'checkPhoneAccount', { phone: '+919876543210', deviceKey: deviceKey(), sendCode: true });
        expect(c.call).toHaveBeenNthCalledWith(2, 'checkPhoneAccount', { phone: '+919876543210', deviceKey: deviceKey() });
    });

    it('asks the email check to send with the name and the page\'s language', async () => {
        const c = page({ status: 'new', signupOpen: true }, 'hi');
        await proto['checkEmail'].call(c, 'a@example.com', { sendCode: true, name: 'Ada' });
        await proto['checkEmail'].call(c, 'a@example.com');
        expect(c.call).toHaveBeenNthCalledWith(1, 'checkEmailAccount', { email: 'a@example.com', deviceKey: deviceKey(), sendCode: true, language: 'hi', name: 'Ada' });
        expect(c.call).toHaveBeenNthCalledWith(2, 'checkEmailAccount', { email: 'a@example.com', deviceKey: deviceKey() });
    });

    it('turns a refused send into the error the request would have thrown, in the member\'s words', async () => {
        const c = page({
            phone: '+919876543210', exists: false, hasPin: false, signupOpen: true,
            codeRefused: { code: 'resource-exhausted', message: 'Please wait 39s', details: { reason: 'wait', wait: 39 } },
        });
        const account = await proto['checkPhone'].call(c, '+919876543210', { sendCode: true }) as Record<string, any>;
        expect(account['codeRefused']).toBeUndefined();
        expect(account['codeError']).toEqual({
            code: 'resource-exhausted', message: 'Please wait 39 seconds before asking for another code.', details: { reason: 'wait', wait: 39 },
        });
        expect(readSignInError(account['codeError'])).toMatchObject({ reason: 'wait', details: { wait: 39 } });
    });

    it('passes a code it sent through as it came', async () => {
        const code = { sent: true, testMode: true, testCode: '482913' };
        const c = page({ status: 'new', signupOpen: true, code });
        await expect(proto['checkEmail'].call(c, 'a@example.com', { sendCode: true })).resolves.toEqual({ status: 'new', signupOpen: true, code });
    });
});
