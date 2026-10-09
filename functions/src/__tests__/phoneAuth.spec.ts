/**
 * Phone sign-in end to end through the callables, on an in-memory Firestore
 * with the log SMS provider (the code is read back from SmsLogs, as an admin
 * would while testing).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Claims as Firebase keeps them: what setCustomUserClaims writes, getUser reads back
// (mergeUserClaims reads its write back, specs/app-accounts-spec.md C-D6).
const claims = vi.hoisted(() => ({} as Record<string, Record<string, unknown>>));
const owner = vi.hoisted(() => ({
    createUser: vi.fn(),
    deleteUser: vi.fn(),
    createCustomToken: vi.fn(async (uid: string) => `token-${uid}`),
    getUser: vi.fn(async (uid: string) => ({ uid, customClaims: claims[uid] ?? {} })),
    setCustomUserClaims: vi.fn(async (uid: string, next: Record<string, unknown>) => { claims[uid] = next; }),
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
    for (const uid of Object.keys(claims)) delete claims[uid];
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

    it('shows a reset code only when an admin turned that on (Settings, SMS)', async () => {
        await signUp();
        ageLastCode();
        mem.seed('Settings', 'sms', { provider: 'log', showResetCodes: true });
        const reply = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'reset' });
        expect(reply).toEqual({ sent: true, phone: E164, testMode: true, testCode: lastCode() });

        // The code it shows resets the PIN, as one read from SMS Logs would.
        const { ticket } = await call(phone.verifyPhoneOtp, { phone: NUMBER, code: reply.testCode, purpose: 'reset' });
        await expect(call(phone.resetPin, { phone: NUMBER, pin: '135792', ticket })).resolves.toMatchObject({ token: 'token-uid-asha' });
    });

    it('never shows a link code, even with reset codes on (review F)', async () => {
        await signUp();
        ageLastCode();
        mem.seed('Settings', 'sms', { provider: 'log', showResetCodes: true });
        const reply = await call(phone.requestPhoneOtp, { phone: '98765 00000', purpose: 'link' }, 'uid-asha');
        expect(reply).toEqual({ sent: true, phone: '+919876500000', testMode: true });
    });

    it('never returns the code with a real provider', async () => {
        mem.seed('Settings', 'sms', { provider: 'msg91', msg91AuthKey: 'k', msg91OtpTemplateId: 't', showResetCodes: true });
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

    it('sends nothing new for 60 seconds', async () => {
        await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        await expect(call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' }))
            .resolves.toMatchObject({ alreadySent: true });
        expect(mem.all('SmsLogs')).toHaveLength(1);
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

describe('the one-minute wait and the hourly limit (specs/sign-in-codes-spec.md)', () => {
    const numberCount = () => Number(mem.read('_rate_limits', `otp-phone-${phoneHash(E164)}`)?.['count'] ?? 0);

    it('answers a request inside the minute with the code already sent and the seconds left, sending and using up nothing (SC-D3, F22)', async () => {
        const first = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        for (let i = 0; i < 6; i++) {
            const again = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
            expect(again).toMatchObject({ sent: true, alreadySent: true, testMode: true, testCode: first.testCode });
            expect(again.wait).toBeGreaterThan(55);
            expect(again.wait).toBeLessThanOrEqual(60);
        }
        expect(mem.all('SmsLogs')).toHaveLength(1);
        expect(numberCount()).toBe(1);
        ageLastCode();
        await expect(call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' })).resolves.toMatchObject({ sent: true, sameCode: true });
        expect(numberCount()).toBe(2);
    });

    it('a code for another purpose never holds back a reset code (F22)', async () => {
        await signUp();
        mem.seed('Settings', 'sms', { provider: 'log', showResetCodes: true });
        // A sign-up code for this number went out a moment ago (another tab, before the account existed).
        mem.seed('phone_otps', phoneHash(E164), {
            purpose: 'signup', uid: null, codeHash: 'x', attempts: 0, verified: false,
            issuedAt: { toMillis: () => Date.now() - 10_000 },
            lastSentAt: { toMillis: () => Date.now() - 10_000 },
            expiresAt: { toMillis: () => Date.now() + 590_000 },
        });
        const reply = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'reset' });
        expect(reply).toEqual({ sent: true, phone: E164, testMode: true, testCode: lastCode() });
        expect(mem.read('phone_otps', phoneHash(E164))?.['purpose']).toBe('reset');
        const { ticket } = await call(phone.verifyPhoneOtp, { phone: NUMBER, code: reply.testCode, purpose: 'reset' });
        await expect(call(phone.resetPin, { phone: NUMBER, pin: '135792', ticket })).resolves.toMatchObject({ token: 'token-uid-asha' });
    });

    it('a reset code asked for again inside the minute is the same one, shown only where reset codes may be', async () => {
        await signUp();
        const hidden = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'reset' });
        const again = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'reset' });
        expect(hidden).toEqual({ sent: true, phone: E164, testMode: true });
        expect(again).toEqual({ sent: true, phone: E164, testMode: true, alreadySent: true, wait: expect.any(Number) });
        mem.seed('Settings', 'sms', { provider: 'log', showResetCodes: true });
        await expect(call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'reset' })).resolves.toMatchObject({ alreadySent: true, testCode: lastCode() });
    });

    it('refuses with the seconds left inside the minute when the code sent can no longer be used', async () => {
        const { testCode } = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        await call(phone.verifyPhoneOtp, { phone: NUMBER, code: testCode, purpose: 'signup' });
        const refused = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' }).catch((e) => e);
        expect(refused).toMatchObject({ code: 'resource-exhausted', details: { reason: 'wait' } });
        expect(numberCount()).toBe(1);
    });

    it('a second request at once for the same code is still held by the minute (SC-D11)', async () => {
        const { issuePhoneOtp } = await import('../auth/phoneOtp.js');
        const { DEFAULT_SMS_SETTINGS } = await import('../sms/smsSettings.js');
        const sms = DEFAULT_SMS_SETTINGS;
        await issuePhoneOtp(E164, 'signup', sms);
        await expect(issuePhoneOtp(E164, 'signup', sms)).rejects.toMatchObject({ details: { reason: 'wait' } });
        await expect(issuePhoneOtp(E164, 'link', sms, 'uid-other')).resolves.toMatchObject({ testCode: expect.any(String) });
    });

    it('says when the hourly limit reopens (SC-D5)', async () => {
        for (let i = 0; i < 5; i++) {
            await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
            ageLastCode();
        }
        const refused = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' }).catch((e) => e);
        expect(refused).toMatchObject({ code: 'resource-exhausted', details: { reason: 'too-many-codes' } });
        expect(refused.details.retryAfter).toBeGreaterThan(3500);
        expect(refused.details.retryAfter).toBeLessThanOrEqual(3600);
    });

    it('gives the counts back when the SMS provider refuses the send (SC-D4)', async () => {
        mem.seed('Settings', 'sms', { provider: 'msg91', msg91AuthKey: 'k', msg91OtpTemplateId: 't' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ type: 'error', message: 'down' }) }));
        try {
            await expect(call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' })).rejects.toMatchObject({ details: { reason: 'sms-failed' } });
            expect(numberCount()).toBe(0);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('gives every refusal a member sees a reason', async () => {
        await expect(call(phone.checkPhoneAccount, { phone: '123' })).rejects.toMatchObject({ details: { reason: 'invalid-number' } });
        await expect(call(phone.checkPhoneAccount, { phone: '+44 7700 900123' })).rejects.toMatchObject({
            details: { reason: 'country-not-allowed', codes: '+91' },
        });
        await expect(call(phone.signInWithPin, { phone: NUMBER, pin: '246810' })).rejects.toMatchObject({ details: { reason: 'no-account' } });
    });
});

describe('one code at a time (specs/sign-in-codes-spec.md, SC4)', () => {
    const stored = () => mem.read('phone_otps', phoneHash(E164))!;
    const change = (fields: Record<string, unknown>) => mem.seed('phone_otps', phoneHash(E164), { ...stored(), ...fields });
    const wrongFor = (code: string) => (code === '111111' ? '222222' : '111111');
    // Fixed when made, not when read: a time read later would be younger than asked, and
    // "30 minutes ago" would fall a few milliseconds inside the 30-minute limit.
    const minutesAgo = (m: number) => { const at = Date.now() - m * 60_000; return { toMillis: () => at }; };

    it('sends the same code again while it still works, and says so (SC-D9, SC-D12)', async () => {
        const first = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        expect(first.sameCode).toBeUndefined();
        ageLastCode();
        const again = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        expect(again).toMatchObject({ sent: true, sameCode: true, testCode: first.testCode });
        const texts = mem.all('SmsLogs').map((log) => String(log.data['text']).slice(0, 6));
        expect(texts).toEqual([first.testCode, first.testCode]);
        // The code from either message works.
        await expect(call(phone.verifyPhoneOtp, { phone: NUMBER, code: first.testCode, purpose: 'signup' })).resolves.toHaveProperty('ticket');
    });

    it('keeps the wrong tries and restarts the 10 minutes (SC-D11)', async () => {
        const { testCode } = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        for (let i = 0; i < 2; i++) {
            await expect(call(phone.verifyPhoneOtp, { phone: NUMBER, code: wrongFor(testCode), purpose: 'signup' })).rejects.toMatchObject({ details: { reason: 'code-wrong' } });
        }
        change({ lastSentAt: minutesAgo(8), expiresAt: { toMillis: () => Date.now() + 2 * 60_000 } });
        await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        expect(stored()['attempts']).toBe(2);
        const expiresIn = (stored()['expiresAt'] as { toMillis: () => number }).toMillis() - Date.now();
        expect(expiresIn).toBeGreaterThan(9 * 60_000);
        for (let i = 0; i < 3; i++) await call(phone.verifyPhoneOtp, { phone: NUMBER, code: wrongFor(testCode), purpose: 'signup' }).catch(() => undefined);
        await expect(call(phone.verifyPhoneOtp, { phone: NUMBER, code: testCode, purpose: 'signup' })).rejects.toMatchObject({ details: { reason: 'code-tries' } });
    });

    it.each([
        ['expired', { expiresAt: minutesAgo(1) }],
        ['out of tries', { attempts: 5 }],
        ['made 30 minutes ago', { issuedAt: minutesAgo(30) }],
        ['stored before SC4, with no sealed code', { codeSealed: undefined }],
        ['sealed but damaged', { codeSealed: 'v1.AAAA.AAAA.AAAA' }],
    ])('makes a new code when the old one is %s', async (_, fields) => {
        const { testCode } = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        change({ ...fields, lastSentAt: minutesAgo(2) });
        const reply = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        expect(reply.sameCode).toBeUndefined();
        expect(stored()['attempts']).toBe(0);
        // Rarely the new random code is the old one; the stored hash is new either way.
        expect(reply.testCode === testCode ? stored()['codeSealed'] : reply.testCode).not.toBe(testCode);
    });

    it('makes a new code once the old one is verified, or for another purpose', async () => {
        await signUp();
        ageLastCode();
        await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'reset' });
        expect(stored()['purpose']).toBe('reset');
        const resetCode = lastCode();
        await call(phone.verifyPhoneOtp, { phone: NUMBER, code: resetCode, purpose: 'reset' });
        ageLastCode();
        await expect(call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'reset' })).resolves.not.toHaveProperty('sameCode');
        expect(stored()['verified']).toBe(false);
    });

    it('keeps a link code for the account that asked for it', async () => {
        await signUp();
        const key = phoneHash('+919876500000');
        const age = () => mem.seed('phone_otps', key, { ...mem.read('phone_otps', key)!, lastSentAt: minutesAgo(2) });
        await call(phone.requestPhoneOtp, { phone: '98765 00000', purpose: 'link' }, 'uid-asha');
        age();
        await expect(call(phone.requestPhoneOtp, { phone: '98765 00000', purpose: 'link' }, 'uid-asha')).resolves.toMatchObject({ sameCode: true });
        // Another account asking for the same number gets a code of its own.
        mem.seed('users', 'uid-ravi', { uid: 'uid-ravi', name: 'Ravi', role: 'user' });
        age();
        await expect(call(phone.requestPhoneOtp, { phone: '98765 00000', purpose: 'link' }, 'uid-ravi')).resolves.not.toHaveProperty('sameCode');
        expect(mem.read('phone_otps', key)!['uid']).toBe('uid-ravi');
    });

    it('keeps the code sealed, never as it is (SC-D10)', async () => {
        const { testCode } = await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        const record = stored();
        expect(String(record['codeSealed'])).toMatch(/^v1\./);
        expect(JSON.stringify(record)).not.toContain(testCode);
    });

    it('puts the old times back when the provider refuses a resend', async () => {
        await call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' });
        const sentAt = minutesAgo(2);
        change({ lastSentAt: sentAt });
        const expiresAt = stored()['expiresAt'];
        mem.seed('Settings', 'sms', { provider: 'msg91', msg91AuthKey: 'k', msg91OtpTemplateId: 't' });
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, json: async () => ({ type: 'error', message: 'down' }) }));
        try {
            await expect(call(phone.requestPhoneOtp, { phone: NUMBER, purpose: 'signup' })).rejects.toMatchObject({ details: { reason: 'sms-failed' } });
        } finally {
            vi.unstubAllGlobals();
        }
        expect(stored()['lastSentAt']).toBe(sentAt);
        expect(stored()['expiresAt']).toBe(expiresAt);
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

    it('peppers new PIN hashes, and upgrades a PIN set before the pepper when it is used (review F)', async () => {
        const { hashPin, PIN_HASH_VERSION, PIN_PEPPER_DOC, resetPinPepperCache } = await import('../auth/accounts.js');
        resetPinPepperCache(); // the store was cleared since an earlier test read it
        const token = await signUp('246810');
        expect(token).toBe('token-uid-asha');
        const stored = mem.read('auth_pins', 'uid-asha')!;
        expect(stored['version']).toBe(PIN_HASH_VERSION);
        expect(mem.read(PIN_PEPPER_DOC.collection, PIN_PEPPER_DOC.doc)!['value']).toMatch(/^[A-Za-z0-9+/=]{44}$/);
        // Without the pepper, the stored hash cannot be matched by guessing PINs.
        expect(await hashPin('246810', Buffer.from(String(stored['salt']), 'hex'))).not.toBe(stored['hash']);

        const salt = Buffer.from('00112233445566778899aabbccddeeff', 'hex');
        mem.seed('auth_pins', 'uid-asha', { salt: salt.toString('hex'), hash: await hashPin('246810', salt), failedAttempts: 0 });
        await expect(call(phone.signInWithPin, { phone: NUMBER, pin: '246810' })).resolves.toEqual({ token: 'token-uid-asha' });
        expect(mem.read('auth_pins', 'uid-asha')).toMatchObject({ version: PIN_HASH_VERSION, failedAttempts: 0 });
        await expect(call(phone.signInWithPin, { phone: NUMBER, pin: '246810' })).resolves.toEqual({ token: 'token-uid-asha' });
    });
});
