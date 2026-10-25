/**
 * An app signs a member in with their own sign-in PIN (F32, docs/app/pin.html#member-pin),
 * on an in-memory Firestore: the real hashing, lockout and rate-limit code. Tries count
 * in auth_pins, the same count as the sign-in page.
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
import { MEMBER_PIN_WRONG_PER_HOUR } from '../app-kit/memberPin.js';
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

    it('counts a wrong PIN as a wrong sign-in try: the same count as the sign-in page, and it locks there too', async () => {
        person('u1');
        await setPin('u1', GOOD);
        for (const remaining of [4, 3, 2, 1]) {
            await expect(signInWithMemberPin(request(), 'u1', WRONG)).rejects.toMatchObject({ code: 'permission-denied', details: { reason: 'wrong', remaining } });
        }
        expect(mem.read(AUTH_PINS, 'u1')?.['failedAttempts']).toBe(4);
        await expect(signInWithMemberPin(request(), 'u1', WRONG)).rejects.toMatchObject({ code: 'resource-exhausted', details: { reason: 'locked' } });
        // Locked for sign-in itself, and the right PIN no longer opens it here
        await expect(checkPin('u1', GOOD)).resolves.toEqual({ ok: false, reason: 'locked' });
        await expect(signInWithMemberPin(request(), 'u1', GOOD)).rejects.toMatchObject({ details: { reason: 'locked' } });
        // Forgot PIN on the sign-in page sets a new PIN, which unlocks it here too
        await setPin('u1', '135792');
        await expect(signInWithMemberPin(request(), 'u1', '135792')).resolves.toEqual({ token: 'token-for-u1' });
    });

    it('a right PIN resets the count of earlier wrong ones, for the sign-in page too', async () => {
        person('u1');
        await setPin('u1', GOOD);
        await expect(signInWithMemberPin(request(), 'u1', WRONG)).rejects.toMatchObject({ details: { reason: 'wrong' } });
        await signInWithMemberPin(request(), 'u1', GOOD);
        expect(mem.read(AUTH_PINS, 'u1')?.['failedAttempts']).toBe(0);
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
