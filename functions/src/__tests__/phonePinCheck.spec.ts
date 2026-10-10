/**
 * A check of the phone sign-in PIN for an app's own gate (docs/app/pin.html#phone-pin),
 * on an in-memory Firestore: the real hashing and transaction code. Wrong tries count
 * in their own collection and never touch phone sign-in's lockout in auth_pins.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { randomBytes } from 'node:crypto';

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner: {} };
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
import { APP_PINS, createPhonePinCheck, createPinStore } from '../app-kit/index.js';
import { PHONE_PIN_TRIES } from '../app-kit/phonePinCheck.js';
import { AUTH_PINS, MAX_PIN_ATTEMPTS, checkPin, hashPin, setPin } from '../auth/accounts.js';

const mem = db as unknown as {
    store: Map<string, Map<string, Record<string, unknown>>>;
    all(c: string): Array<{ id: string; data: Record<string, unknown> }>;
    read(c: string, id: string): Record<string, unknown> | undefined;
    seed(c: string, id: string, data: Record<string, unknown>): void;
};
const GOOD = '604175';
const OTHER = '246810';
const gate = (maxAttempts?: number) => createPhonePinCheck('parent', maxAttempts ? { maxAttempts } : {});

beforeEach(() => mem.store.clear());

describe('createPhonePinCheck', () => {
    it('opens on the person\'s phone sign-in PIN, writing nothing', async () => {
        await setPin('u1', GOOD);
        const before = JSON.stringify(mem.read(AUTH_PINS, 'u1'));
        await expect(gate().check('u1', GOOD)).resolves.toEqual({ ok: true });
        expect(JSON.stringify(mem.read(AUTH_PINS, 'u1'))).toBe(before);
        expect(mem.all(PHONE_PIN_TRIES)).toEqual([]);
    });

    it('counts wrong PINs down and locks at the limit; a correct PIN does not open a lock', async () => {
        await setPin('u1', GOOD);
        const check = gate(3);
        await expect(check.check('u1', OTHER)).resolves.toEqual({ ok: false, reason: 'wrong', remaining: 2 });
        await expect(check.check('u1', OTHER)).resolves.toEqual({ ok: false, reason: 'wrong', remaining: 1 });
        await expect(check.check('u1', OTHER)).resolves.toEqual({ ok: false, reason: 'locked' });
        await expect(check.check('u1', GOOD)).resolves.toEqual({ ok: false, reason: 'locked' });
        expect(mem.all(PHONE_PIN_TRIES)).toEqual([
            { id: 'parent__u1', data: expect.objectContaining({ uid: 'u1', namespace: 'parent', failedAttempts: 3 }) },
        ]);
    });

    it('a correct PIN resets the count of earlier wrong ones', async () => {
        await setPin('u1', GOOD);
        await gate().check('u1', OTHER);
        await gate().check('u1', OTHER);
        await expect(gate().check('u1', GOOD)).resolves.toEqual({ ok: true });
        expect(mem.all(PHONE_PIN_TRIES)).toEqual([]);
        await expect(gate().check('u1', OTHER)).resolves.toEqual({ ok: false, reason: 'wrong', remaining: 4 });
    });

    it('never touches phone sign-in\'s lockout: its count stays, and sign-in still works with the gate locked', async () => {
        await setPin('u1', GOOD);
        await checkPin('u1', OTHER);
        await checkPin('u1', OTHER);
        const signInCount = mem.read(AUTH_PINS, 'u1')?.['failedAttempts'];
        expect(signInCount).toBe(2);

        const check = gate(20);
        for (let i = 0; i < 20; i++) await check.check('u1', OTHER);
        await expect(check.check('u1', GOOD)).resolves.toEqual({ ok: false, reason: 'locked' });
        expect(mem.read(AUTH_PINS, 'u1')?.['failedAttempts']).toBe(signInCount);

        // A correct PIN at the gate does not reset sign-in's count either.
        await check.clearLock('u1');
        await expect(check.check('u1', GOOD)).resolves.toEqual({ ok: true });
        expect(mem.read(AUTH_PINS, 'u1')?.['failedAttempts']).toBe(signInCount);

        await expect(checkPin('u1', OTHER)).resolves.toEqual({ ok: false, reason: 'wrong', remaining: MAX_PIN_ATTEMPTS - 3 });
        await expect(checkPin('u1', GOOD)).resolves.toEqual({ ok: true });
    });

    it('still opens when phone sign-in is locked: the two locks are apart', async () => {
        await setPin('u1', GOOD);
        for (let i = 0; i < MAX_PIN_ATTEMPTS; i++) await checkPin('u1', OTHER);
        await expect(checkPin('u1', GOOD)).resolves.toEqual({ ok: false, reason: 'locked' });
        await expect(gate().check('u1', GOOD)).resolves.toEqual({ ok: true });
        expect(mem.read(AUTH_PINS, 'u1')?.['failedAttempts']).toBe(MAX_PIN_ATTEMPTS);
    });

    it('says none, and has() false, for a person with no phone PIN (email or Google sign-in), without counting', async () => {
        await expect(gate().has('u1')).resolves.toBe(false);
        await expect(gate().check('u1', GOOD)).resolves.toEqual({ ok: false, reason: 'none' });
        expect(mem.all(PHONE_PIN_TRIES)).toEqual([]);
        await setPin('u1', GOOD);
        await expect(gate().has('u1')).resolves.toBe(true);
    });

    it('unlocks with clearLock(), or when the phone PIN is set again (Forgot PIN)', async () => {
        await setPin('u1', GOOD);
        const check = gate(1);
        await check.check('u1', OTHER);
        await check.clearLock('u1');
        await expect(check.check('u1', GOOD)).resolves.toEqual({ ok: true });

        await check.check('u1', OTHER);
        await expect(check.check('u1', GOOD)).resolves.toEqual({ ok: false, reason: 'locked' });
        await setPin('u1', OTHER);
        await expect(check.check('u1', OTHER)).resolves.toEqual({ ok: true });
    });

    it('checks a PIN set before the pepper, and leaves it as it is for sign-in to upgrade', async () => {
        const salt = randomBytes(16);
        const record = { salt: salt.toString('hex'), hash: await hashPin(GOOD, salt), failedAttempts: 0 };
        mem.seed(AUTH_PINS, 'u1', record);
        await expect(gate().check('u1', OTHER)).resolves.toMatchObject({ ok: false, reason: 'wrong' });
        await expect(gate().check('u1', GOOD)).resolves.toEqual({ ok: true });
        expect(mem.read(AUTH_PINS, 'u1')).toEqual(record);
    });

    it('treats a malformed PIN as a wrong one', async () => {
        await setPin('u1', GOOD);
        await expect(gate().check('u1', 604175 as unknown)).resolves.toEqual({ ok: false, reason: 'wrong', remaining: 4 });
        await expect(gate().check('u1', undefined)).resolves.toEqual({ ok: false, reason: 'wrong', remaining: 3 });
    });

    it('keeps gates apart from each other and from an app PIN store of the same name', async () => {
        await setPin('u1', GOOD);
        await createPinStore('parent').set('u1', OTHER);
        await createPhonePinCheck('parent', { maxAttempts: 1 }).check('u1', OTHER);
        await expect(createPhonePinCheck('parent', { maxAttempts: 1 }).check('u1', GOOD)).resolves.toEqual({ ok: false, reason: 'locked' });
        await expect(createPhonePinCheck('settings', { maxAttempts: 1 }).check('u1', GOOD)).resolves.toEqual({ ok: true });
        await expect(createPinStore('parent').check('u1', OTHER)).resolves.toEqual({ ok: true });
        expect(mem.read(APP_PINS, 'parent__u1')?.['failedAttempts']).toBe(0);
    });

    it('never stores or returns the PIN or its hash', async () => {
        await setPin('u1', GOOD);
        const { hash, salt } = mem.read(AUTH_PINS, 'u1') as { hash: string; salt: string };
        const results = [await gate().check('u1', OTHER), await gate().check('u1', GOOD)];
        const tries = JSON.stringify(mem.all(PHONE_PIN_TRIES));
        await gate().check('u1', OTHER);
        const written = JSON.stringify(mem.all(PHONE_PIN_TRIES));
        for (const text of [JSON.stringify(results), tries, written]) {
            for (const secret of [GOOD, OTHER, hash, salt]) expect(text).not.toContain(secret);
        }
    });

    it('refuses bad namespaces, limits and uids, as createPinStore does', async () => {
        for (const bad of ['', 'T', 'parent area', 'a__b', '9parent', 'x']) expect(() => createPhonePinCheck(bad)).toThrow('PIN namespace');
        for (const bad of [0, 21, 2.5]) expect(() => createPhonePinCheck('parent', { maxAttempts: bad })).toThrow('maxAttempts');
        expect(() => createPhonePinCheck('parent', { maxAttempts: 20 })).not.toThrow();
        await expect(gate().check('', GOOD)).rejects.toThrow('No such person.');
        await expect(gate().check('a/b', GOOD)).rejects.toThrow('No such person.');
        await expect(gate().has('a/b')).rejects.toThrow('No such person.');
        await expect(gate().clearLock(' ')).rejects.toThrow('No such person.');
    });
});
