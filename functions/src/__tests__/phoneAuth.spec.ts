/**
 * Phone sign-in end to end through the callables, on an in-memory Firestore
 * with the log SMS provider (the code is read back from SmsLogs, as an admin
 * would while testing).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    createCustomToken: vi.fn(async (uid: string) => `token-${uid}`),
    getUser: vi.fn(async (uid: string) => ({ uid, customClaims: {} })),
    setCustomUserClaims: vi.fn(),
    revokeRefreshTokens: vi.fn(),
}));

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((handler: unknown) => handler),
    HttpsError: class extends Error {
        constructor(public code: string, message: string, public details?: unknown) {
            super(message);
        }
    },
}));

import { db } from '../init.js';
import * as phone from '../auth/phoneAuth.js';
import { phoneHash } from '../auth/phoneNumber.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
type Handler = (request: unknown) => Promise<any>;
const call = (fn: unknown, data: Record<string, unknown>, uid?: string) =>
    (fn as Handler)({ data, auth: uid ? { uid, token: {} } : undefined, rawRequest: { ip: '10.0.0.1', headers: {} } });

const NUMBER = '98765 43210';
const E164 = '+919876543210';

/** The code in the most recent SMS (log provider keeps the text). */
function lastCode(): string {
    const logs = mem.all('SmsLogs');
    return String(logs[logs.length - 1].data['text']).slice(0, 6);
}

/** Pretend the last code went out over a minute ago, so another may be sent. */
function ageLastCode(): void {
    const ref = mem.read('phone_otps', phoneHash(E164));
    if (ref) mem.seed('phone_otps', phoneHash(E164), { ...ref, lastSentAt: { toMillis: () => Date.now() - 120_000 } });
}

async function signUp(pin = '246810'): Promise<string> {
    await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
    const { ticket } = await call(phone.verifyPhoneOtp, { phone: NUMBER, code: lastCode(), purpose: 'signup' });
    const { token } = await call(phone.completePhoneSignup, { phone: NUMBER, name: 'Asha Rao', pin, ticket });
    return token;
}

beforeEach(() => {
    mem.store.clear();
    vi.clearAllMocks();
    owner.createUser.mockResolvedValue({ uid: 'uid-asha' });
    mem.seed('Settings', 'users', { isSignupEnabled: true, phoneSignIn: true });
});

describe('checkPhoneAccount', () => {
    it('cleans up the number and reports a new one', async () => {
        await expect(call(phone.checkPhoneAccount, { phone: '+91 (98765) 43210' })).resolves.toEqual({
            phone: E164, exists: false, hasPin: false, signupOpen: true,
        });
    });

    it('refuses when phone sign-in is off', async () => {
        mem.seed('Settings', 'users', { isSignupEnabled: true });
        await expect(call(phone.checkPhoneAccount, { phone: NUMBER })).rejects.toMatchObject({ code: 'failed-precondition' });
    });

    it('refuses numbers outside the allowed countries', async () => {
        await expect(call(phone.checkPhoneAccount, { phone: '+44 7700 900123' })).rejects.toMatchObject({
            code: 'invalid-argument', message: expect.stringContaining('+91'),
        });
    });
});

describe('test mode', () => {
    it('returns the code with the Test provider, since no SMS is sent', async () => {
        const reply = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        expect(reply.testCode).toMatch(/^\d{6}$/);
        expect(reply.testCode).toBe(lastCode());
    });

    it('keeps reset codes off the page: they are in SMS Logs only (review F)', async () => {
        await signUp();
        ageLastCode();
        const reply = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'reset' });
        expect(reply).toEqual({ sent: true, phone: E164, testMode: true });
        expect(lastCode()).toMatch(/^\d{6}$/);
    });

    it('never returns the code with a real provider', async () => {
        mem.seed('Settings', 'sms', { provider: 'msg91', msg91AuthKey: 'k', msg91OtpTemplateId: 't' });
        const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ type: 'success', request_id: 'r1' }) });
        vi.stubGlobal('fetch', fetchMock);
        try {
            const reply = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
            expect(reply).toEqual({ sent: true, phone: E164 });
            expect(fetchMock).toHaveBeenCalled();
        } finally {
            vi.unstubAllGlobals();
        }
    });
});

describe('sign-up with a new number', () => {
    it('creates the login, the record, the index and a hashed PIN, and signs in', async () => {
        const token = await signUp('246810');
        expect(token).toBe('token-uid-asha');

        const [user] = mem.all('users');
        expect(user.data).toMatchObject({ uid: 'uid-asha', name: 'Asha Rao', phone: E164, phoneVerified: true, email: '', role: 'user', isActive: true });
        expect(mem.read('phone_index', phoneHash(E164))).toMatchObject({ userDocId: user.id, uid: 'uid-asha' });
        const pin = mem.read('auth_pins', 'uid-asha')!;
        expect(pin['hash']).toMatch(/^[a-f0-9]{64}$/);
        expect(JSON.stringify(pin)).not.toContain('246810');
        // Claims set before the token is issued, so the first ID token has them.
        expect(owner.setCustomUserClaims).toHaveBeenCalledWith('uid-asha', { arccms_role: 'user', arccms_uid: user.id });
    });

    it("applies the site's default role", async () => {
        mem.seed('Settings', 'users', { isSignupEnabled: true, phoneSignIn: true, defaultRole: 'propertyOwner' });
        await signUp();
        expect(mem.all('users')[0].data['role']).toBe('propertyOwner');
    });

    it('needs a verified code first', async () => {
        await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        await expect(call(phone.completePhoneSignup, { phone: NUMBER, name: 'Asha', pin: '246810' }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        expect(owner.createUser).not.toHaveBeenCalled();
    });

    it('needs the ticket from verifying: someone else who knows the number cannot use the code (review F)', async () => {
        await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        const { ticket } = await call(phone.verifyPhoneOtp, { phone: NUMBER, code: lastCode(), purpose: 'signup' });
        expect(ticket).toMatch(/^[\w-]{32}$/);
        await expect(call(phone.completePhoneSignup, { phone: NUMBER, name: 'Mallory', pin: '246810' }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        await expect(call(phone.completePhoneSignup, { phone: NUMBER, name: 'Mallory', pin: '246810', ticket: 'guess' }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
        await expect(call(phone.completePhoneSignup, { phone: NUMBER, name: 'Asha Rao', pin: '246810', ticket }))
            .resolves.toEqual({ token: 'token-uid-asha' });
    });

    it('refuses a PIN that is easy to guess (review F)', async () => {
        await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        const { ticket } = await call(phone.verifyPhoneOtp, { phone: NUMBER, code: lastCode(), purpose: 'signup' });
        for (const pin of ['123456', '000000', '987654', '121212']) {
            await expect(call(phone.completePhoneSignup, { phone: NUMBER, name: 'Asha Rao', pin, ticket }))
                .rejects.toMatchObject({ code: 'invalid-argument', details: { reason: 'weak-pin' } });
        }
        expect(owner.createUser).not.toHaveBeenCalled();
    });

    it('rejects a wrong code, and a code sent for another purpose', async () => {
        await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        const code = lastCode();
        const wrong = code === '111111' ? '222222' : '111111';
        await expect(call(phone.verifyPhoneOtp, { phone: NUMBER, code: wrong, purpose: 'signup' }))
            .rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call(phone.verifyPhoneOtp, { phone: NUMBER, code, purpose: 'reset' }))
            .rejects.toMatchObject({ code: 'not-found' });
    });

    it('holds a resend for 60 seconds', async () => {
        await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        await expect(call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' }))
            .rejects.toMatchObject({ code: 'resource-exhausted' });
    });

    it('refuses a signup code for a number that has an account', async () => {
        await signUp();
        ageLastCode();
        await expect(call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' }))
            .rejects.toMatchObject({ code: 'already-exists' });
    });

    it('refuses when sign-ups are closed', async () => {
        mem.seed('Settings', 'users', { isSignupEnabled: false, phoneSignIn: true });
        await expect(call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' }))
            .rejects.toMatchObject({ code: 'failed-precondition' });
    });
});

describe('signing in with the PIN', () => {
    beforeEach(async () => {
        await signUp('246810');
    });

    it('reports the account and its PIN', async () => {
        await expect(call(phone.checkPhoneAccount, { phone: NUMBER })).resolves.toMatchObject({ exists: true, hasPin: true });
    });

    it('signs in with the right PIN', async () => {
        await expect(call(phone.signInWithPin, { phone: NUMBER, pin: '246810' })).resolves.toEqual({ token: 'token-uid-asha' });
    });

    it('counts wrong PINs down and locks on the fifth', async () => {
        await expect(call(phone.signInWithPin, { phone: NUMBER, pin: '000000' }))
            .rejects.toMatchObject({ code: 'permission-denied', message: 'Wrong PIN. 4 tries left.' });
        for (let i = 0; i < 3; i++) await call(phone.signInWithPin, { phone: NUMBER, pin: '000000' }).catch(() => undefined);
        await expect(call(phone.signInWithPin, { phone: NUMBER, pin: '000000' }))
            .rejects.toMatchObject({ code: 'resource-exhausted', details: { reason: 'locked' } });
        // Locked: even the right PIN no longer works.
        await expect(call(phone.signInWithPin, { phone: NUMBER, pin: '246810' }))
            .rejects.toMatchObject({ details: { reason: 'locked' } });
    });

    it('a reset by SMS code sets a new PIN, unlocks, and signs in', async () => {
        for (let i = 0; i < 5; i++) await call(phone.signInWithPin, { phone: NUMBER, pin: '000000' }).catch(() => undefined);
        ageLastCode();
        await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'reset' });
        const { ticket } = await call(phone.verifyPhoneOtp, { phone: NUMBER, code: lastCode(), purpose: 'reset' });
        // Someone polling resetPin for this number gets nothing without the ticket (review F).
        await expect(call(phone.resetPin, { phone: NUMBER, pin: '135790' })).rejects.toMatchObject({ code: 'failed-precondition' });
        await expect(call(phone.resetPin, { phone: NUMBER, pin: '135790', ticket })).resolves.toEqual({ token: 'token-uid-asha' });
        // Every other session ends: whoever had the old PIN is signed out.
        expect(owner.revokeRefreshTokens).toHaveBeenCalledWith('uid-asha');
        await expect(call(phone.signInWithPin, { phone: NUMBER, pin: '135790' })).resolves.toEqual({ token: 'token-uid-asha' });
    });

    it('a blocked account cannot sign in', async () => {
        const [user] = mem.all('users');
        mem.seed('users', user.id, { ...user.data, isActive: false });
        await expect(call(phone.signInWithPin, { phone: NUMBER, pin: '246810' })).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('an account with no PIN is told to set one by code', async () => {
        mem.store.get('auth_pins')!.clear();
        await expect(call(phone.checkPhoneAccount, { phone: NUMBER })).resolves.toMatchObject({ exists: true, hasPin: false });
        await expect(call(phone.signInWithPin, { phone: NUMBER, pin: '246810' }))
            .rejects.toMatchObject({ details: { reason: 'no-pin' } });
    });

    it('a signed-in person can change their PIN', async () => {
        await expect(call(phone.setPin, { pin: '112233' }, 'uid-asha')).rejects.toMatchObject({ details: { reason: 'weak-pin' } });
        await expect(call(phone.setPin, { pin: '192837' }, 'uid-asha')).resolves.toEqual({ saved: true });
        await expect(call(phone.signInWithPin, { phone: NUMBER, pin: '192837' })).resolves.toEqual({ token: 'token-uid-asha' });
    });
});

describe('attempt counters and the caller\'s address (review F)', () => {
    it('count tries inside a transaction, so parallel guesses cannot share one count', async () => {
        const { readFileSync } = await import('node:fs');
        const { resolve } = await import('node:path');
        const read = (file: string) => readFileSync(resolve(__dirname, '../auth', file), 'utf8');
        const body = (text: string, name: string) => text.slice(text.indexOf(`export async function ${name}`)).split('\n}\n')[0];
        expect(body(read('phoneOtp.ts'), 'verifyPhoneOtp')).toContain('db.runTransaction');
        expect(body(read('accounts.ts'), 'checkPin')).toContain('db.runTransaction');
        const email = read('signupOtp.ts');
        expect(email.slice(email.indexOf('export const verifySignupOtp')).split('\n});\n')[0]).toContain('db.runTransaction');
    });

    it('key per-IP limits on the address Google saw, not one the client wrote', async () => {
        const { callerKey } = await import('../auth/accounts.js');
        const req = (xff: string) => ({ rawRequest: { ip: '10.0.0.1', headers: { 'x-forwarded-for': xff } } }) as never;
        expect(callerKey(req('1.1.1.1, 203.0.113.9'))).toBe(callerKey(req('2.2.2.2, 203.0.113.9')));
        expect(callerKey(req('203.0.113.9'))).toBe(callerKey(req('9.9.9.9,203.0.113.9')));
        expect(callerKey(req('1.1.1.1, 203.0.113.9'))).not.toBe(callerKey(req('1.1.1.1, 203.0.113.10')));
    });

    it('knows the PINs attackers try first', async () => {
        const { isWeakPin } = await import('../auth/accounts.js');
        for (const pin of ['000000', '999999', '123456', '234567', '987654', '890123', '112233', '123123']) expect(isWeakPin(pin)).toBe(true);
        for (const pin of ['246810', '135790', '192837', '604175']) expect(isWeakPin(pin)).toBe(false);
    });
});
