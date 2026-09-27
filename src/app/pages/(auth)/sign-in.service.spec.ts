import { describe, expect, it, vi } from 'vitest';

vi.mock('@angular/fire/functions', () => ({ Functions: class {}, httpsCallable: vi.fn() }));

import { readSignInError, SignInService } from './sign-in.service';

const ensureRecordClaim = SignInService.prototype.ensureRecordClaim;

function ctx(claim: string | undefined) {
    const user = {
        getIdTokenResult: vi.fn(async () => ({ claims: claim ? { arccms_uid: claim } : {} })),
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
