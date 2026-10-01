import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/fire/functions', () => ({ Functions: class {}, httpsCallable: vi.fn() }));

import { readSignInError, SIGN_IN_FUNCTIONS, SignInService } from './sign-in.service';

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
            .toEqual({ code: 'failed-precondition', message: 'Sign in again.', reason: 'recent-sign-in' });
        expect(readSignInError({ code: 'functions/internal', message: 'stack trace' }, 'Oops').message).toBe('Oops');
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
        expect(c['call']).toHaveBeenLastCalledWith('resetPin', { phone: '+919876543210', pin: '246810', ticket: 'phone-ticket' });
        expect(c['tickets'].size).toBe(0);
    });

    it('keeps sign-up and reset tickets apart', async () => {
        const c = service();
        await proto['verifyPhoneCode'].call(c, '+919876543210', '123456', 'reset');
        await proto['completePhoneSignup'].call(c, '+919876543210', 'Asha', '246810');
        expect(c['call']).toHaveBeenLastCalledWith('completePhoneSignup', { phone: '+919876543210', name: 'Asha', pin: '246810', ticket: undefined });
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
