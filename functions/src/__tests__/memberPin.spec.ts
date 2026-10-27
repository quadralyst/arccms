/**
 * An app signs a member in with their own sign-in PIN (F32, docs/app/pin.html#member-pin),
 * on an in-memory Firestore: the real hashing, lockout and rate-limit code. Wrong tries
 * lock the person on the rate key they were made on, and reach the account lock only at
 * 20 in a day (F36).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const owner = vi.hoisted(() => ({ createCustomToken: vi.fn(async (uid: string, claims?: unknown) => `token-for-${uid}${claims ? `-${JSON.stringify(claims)}` : ''}`) }));
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
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string, public details?: unknown) { super(message); }
    },
    onCall: vi.fn((handler: unknown) => handler),
}));

import { db } from '../init.js';
import { hashedKey, signInWithMemberPin } from '../app-kit/index.js';
import { MEMBER_PIN_TRIES, MEMBER_PIN_TRIES_HERE, MEMBER_PIN_TRIES_PER_DAY, MEMBER_PIN_WRONG_PER_HOUR } from '../app-kit/memberPin.js';
import { AUTH_PINS, RATE_LIMITS, checkPin, setPin } from '../auth/accounts.js';

const mem = db as unknown as {
    store: Map<string, Map<string, Record<string, unknown>>>;
    all(c: string): Array<{ id: string; data: Record<string, unknown> }>;
    read(c: string, id: string): Record<string, unknown> | undefined;
    seed(c: string, id: string, data: Record<string, unknown>): void;
};
const GOOD = '604175';
const WRONG = '246810';
const request = (ip = '203.0.113.9') => ({ rawRequest: { ip, headers: { 'x-forwarded-for': ip } } }) as never;

function person(uid: string, extra: Record<string, unknown> = {}) {
    mem.seed('users', `rec-${uid}`, { uid, name: uid, isActive: true, status: 'Active', ...extra });
}

beforeEach(() => {
    mem.store.clear();
    owner.createCustomToken.mockClear();
});

describe('signInWithMemberPin', () => {
    it('returns a sign-in token for the right PIN, with the session claims', async () => {
        person('u1');
        await setPin('u1', GOOD);
        await expect(signInWithMemberPin(request(), 'u1', GOOD)).resolves.toEqual({ token: 'token-for-u1' });
        await signInWithMemberPin(request(), 'u1', GOOD, { sessionClaims: { pos: 'pos-2' } });
        expect(owner.createCustomToken).toHaveBeenLastCalledWith('u1', { arccms_session: { pos: 'pos-2' } });
    });

    it('locks a person on the rate key after 5 wrong tries, not their sign-in elsewhere (F36)', async () => {
        person('u1');
        await setPin('u1', GOOD);
        const till = { rateKey: hashedKey('till', 'pos-2') };
        for (const remaining of [4, 3, 2, 1]) {
            await expect(signInWithMemberPin(request(), 'u1', WRONG, till)).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'wrong', remaining } });
        }
        await expect(signInWithMemberPin(request(), 'u1', WRONG, till)).rejects.toMatchObject({
            code: 'resource-exhausted', message: 'Too many wrong PINs here. Try again in 5 minutes.', details: { reason: 'locked-here', retryAfter: 300 },
        });
        // Locked here, the right PIN too, and nothing more is counted
        await expect(signInWithMemberPin(request(), 'u1', GOOD, till)).rejects.toMatchObject({ details: { reason: 'locked-here' } });
        // Not locked anywhere else: the sign-in page and another device still take the PIN
        expect(mem.read(AUTH_PINS, 'u1')?.['failedAttempts']).toBe(0);
        await expect(checkPin('u1', GOOD)).resolves.toEqual({ ok: true });
        await expect(signInWithMemberPin(request(), 'u1', GOOD, { rateKey: hashedKey('till', 'pos-3') })).resolves.toEqual({ token: 'token-for-u1' });
    });

    it('waits longer after each lock on the same rate key: 5 minutes, then 15, then an hour', async () => {
        person('u1');
        await setPin('u1', GOOD);
        const till = { rateKey: hashedKey('till', 'pos-2') };
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            // Three locks are 15 wrong tries; a fourth round would reach the day's 20 and lock the account.
            for (const wait of [300, 900, 3600]) {
                for (let i = 0; i < MEMBER_PIN_TRIES_HERE - 1; i++) await signInWithMemberPin(request(), 'u1', WRONG, till).catch(() => undefined);
                await expect(signInWithMemberPin(request(), 'u1', WRONG, till)).rejects.toMatchObject({ details: { reason: 'locked-here', retryAfter: wait } });
                vi.setSystemTime(Date.now() + wait * 1000 + 1000);
            }
        } finally {
            vi.useRealTimers();
        }
    });

    it('a right PIN resets the count on its rate key, and only there', async () => {
        person('u1');
        await setPin('u1', GOOD);
        const till = { rateKey: hashedKey('till', 'pos-2') };
        const other = { rateKey: hashedKey('till', 'pos-3') };
        for (let i = 0; i < 3; i++) await signInWithMemberPin(request(), 'u1', WRONG, till).catch(() => undefined);
        await signInWithMemberPin(request(), 'u1', WRONG, other).catch(() => undefined);
        await signInWithMemberPin(request(), 'u1', GOOD, till);
        await expect(signInWithMemberPin(request(), 'u1', WRONG, till)).rejects.toMatchObject({ details: { reason: 'wrong', remaining: 4 } });
        await expect(signInWithMemberPin(request(), 'u1', WRONG, other)).rejects.toMatchObject({ details: { reason: 'wrong', remaining: 3 } });
        // The sign-in page's own count is the sign-in page's
        expect(mem.read(AUTH_PINS, 'u1')?.['failedAttempts']).toBe(0);
    });

    it('locks the account only at 20 wrong tries in a day across every rate key, so slow guessing still ends', async () => {
        person('u1');
        await setPin('u1', GOOD);
        let device = 0;
        for (let i = 1; i < MEMBER_PIN_TRIES_PER_DAY; i++) {
            if (i % (MEMBER_PIN_TRIES_HERE - 1) === 1) device++; // move on before any one device locks
            await expect(signInWithMemberPin(request(), 'u1', WRONG, { rateKey: hashedKey('till', `pos-${device}`) })).rejects.toMatchObject({ details: { reason: 'wrong' } });
        }
        await expect(signInWithMemberPin(request(), 'u1', WRONG, { rateKey: hashedKey('till', 'pos-new') })).rejects.toMatchObject({ details: { reason: 'locked' } });
        // The account lock: the sign-in page and every device refuse, until Forgot PIN
        await expect(checkPin('u1', GOOD)).resolves.toEqual({ ok: false, reason: 'locked' });
        await expect(signInWithMemberPin(request(), 'u1', GOOD, { rateKey: hashedKey('till', 'pos-other') })).rejects.toMatchObject({ details: { reason: 'locked' } });
        await setPin('u1', '135792');
        await expect(signInWithMemberPin(request(), 'u1', '135792', { rateKey: hashedKey('till', 'pos-1') })).resolves.toEqual({ token: 'token-for-u1' });
        expect(mem.read(AUTH_PINS, 'u1')?.['appFailed']).toBeUndefined();
    });

    it('starts the day\'s total again after a day', async () => {
        person('u1');
        await setPin('u1', GOOD);
        vi.useFakeTimers({ toFake: ['Date'] });
        try {
            for (let i = 0; i < MEMBER_PIN_TRIES_PER_DAY - 1; i++) {
                await signInWithMemberPin(request(), 'u1', WRONG, { rateKey: hashedKey('till', `pos-${i}`) }).catch(() => undefined);
            }
            vi.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
            await expect(signInWithMemberPin(request(), 'u1', WRONG, { rateKey: hashedKey('till', 'pos-next') })).rejects.toMatchObject({ details: { reason: 'wrong' } });
            expect(mem.read(AUTH_PINS, 'u1')?.['appFailed']).toBe(1);
        } finally {
            vi.useRealTimers();
        }
    });

    it('a new PIN (Forgot PIN) lifts a lock here at once', async () => {
        person('u1');
        await setPin('u1', GOOD);
        const till = { rateKey: hashedKey('till', 'pos-2') };
        for (let i = 0; i < MEMBER_PIN_TRIES_HERE; i++) await signInWithMemberPin(request(), 'u1', WRONG, till).catch(() => undefined);
        await expect(signInWithMemberPin(request(), 'u1', GOOD, till)).rejects.toMatchObject({ details: { reason: 'locked-here' } });
        await setPin('u1', '135792');
        await expect(signInWithMemberPin(request(), 'u1', '135792', till)).resolves.toEqual({ token: 'token-for-u1' });
    });

    it('refuses with the account lock the sign-in page set, without counting anything here', async () => {
        person('u1');
        await setPin('u1', GOOD);
        for (let i = 0; i < 5; i++) await checkPin('u1', WRONG);
        await expect(signInWithMemberPin(request(), 'u1', GOOD)).rejects.toMatchObject({ code: 'resource-exhausted', details: { reason: 'locked' } });
        expect(mem.all(MEMBER_PIN_TRIES)).toEqual([]);
    });

    it('refuses a PIN that is not 6 digits without costing a try', async () => {
        person('u1');
        await setPin('u1', GOOD);
        for (const typed of ['12345', '1234567', 'abcdef', 604175, undefined]) {
            await expect(signInWithMemberPin(request(), 'u1', typed)).rejects.toMatchObject({ code: 'invalid-argument', details: { reason: 'pin-format' } });
        }
        expect(mem.read(AUTH_PINS, 'u1')?.['failedAttempts']).toBe(0);
    });

    it('says no-pin for a person with no sign-in PIN, no-account for no such person, and refuses a blocked one', async () => {
        person('nopin');
        person('blocked', { isActive: false });
        await setPin('blocked', GOOD);
        await expect(signInWithMemberPin(request(), 'nopin', GOOD)).rejects.toMatchObject({ code: 'failed-precondition', details: { reason: 'no-pin' } });
        await expect(signInWithMemberPin(request(), 'ghost', GOOD)).rejects.toMatchObject({ code: 'not-found', details: { reason: 'no-account' } });
        await expect(signInWithMemberPin(request(), '', GOOD)).rejects.toMatchObject({ details: { reason: 'no-account' } });
        await expect(signInWithMemberPin(request(), 'a/b', GOOD)).rejects.toMatchObject({ details: { reason: 'no-account' } });
        await expect(signInWithMemberPin(request(), 'blocked', GOOD)).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'account-blocked' } });
        expect(owner.createCustomToken).not.toHaveBeenCalled();
    });

    it('refuses bad session claims and a blank rate key before anything is counted', async () => {
        person('u1');
        await setPin('u1', GOOD);
        await expect(signInWithMemberPin(request(), 'u1', WRONG, { sessionClaims: { arccms_uid: 'x' } })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(signInWithMemberPin(request(), 'u1', WRONG, { rateKey: ' ' })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mem.read(AUTH_PINS, 'u1')?.['failedAttempts']).toBe(0);
        expect(mem.all(RATE_LIMITS)).toEqual([]);
    });

    it('counts only wrong tries against the rate key, so a busy shared screen is never slowed', async () => {
        person('u1');
        await setPin('u1', GOOD);
        for (let i = 0; i < MEMBER_PIN_WRONG_PER_HOUR + 5; i++) await signInWithMemberPin(request(), 'u1', GOOD);
        expect(mem.all(RATE_LIMITS)).toEqual([]);
    });

    it('stops a caller after 30 wrong tries in an hour across many people, before any PIN is checked', async () => {
        const till = hashedKey('till', 'pos-2');
        for (let i = 0; i < MEMBER_PIN_WRONG_PER_HOUR; i++) {
            person(`p${i}`);
            await setPin(`p${i}`, GOOD);
            await expect(signInWithMemberPin(request(), `p${i}`, WRONG, { rateKey: till })).rejects.toMatchObject({ details: { reason: 'wrong' } });
        }
        person('last');
        await setPin('last', GOOD);
        await expect(signInWithMemberPin(request(), 'last', GOOD, { rateKey: till })).rejects.toMatchObject({
            code: 'resource-exhausted',
            details: { reason: 'too-many-attempts', retryAfter: expect.any(Number) },
        });
        expect(mem.read(AUTH_PINS, 'last')?.['failedAttempts']).toBe(0);
        // Another key (another till, or the caller's address) is counted apart
        await expect(signInWithMemberPin(request(), 'last', GOOD)).resolves.toEqual({ token: 'token-for-last' });
    });
});
