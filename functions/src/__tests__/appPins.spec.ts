/**
 * PINs an app checks itself (specs/app-pin-spec.md, docs/app/pin.html), on an
 * in-memory Firestore: the real hashing, transaction and lockout code.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner: {} };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp, FieldValue: { delete: () => ({ _delete: true }) } };
});
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
// The app's password and PIN strength (src/custom/sign-in.ts): strict unless a test says simple.
const strength = vi.hoisted(() => ({ value: 'strict' as 'strict' | 'simple' }));
vi.mock('../sign-in-choice', () => ({ signInStrength: () => strength.value }));
vi.mock('firebase-functions/v2/https', () => ({
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string, public details?: unknown) { super(message); }
    },
    onCall: vi.fn((handler: unknown) => handler),
}));

import { db } from '../init.js';
import { APP_PINS, callerKey, createPinStore, hashedKey } from '../app-kit/index.js';
import { checkPin, setPin, AUTH_PINS } from '../auth/accounts.js';

const mem = db as unknown as { store: Map<string, Map<string, Record<string, unknown>>>; all(c: string): Array<{ id: string; data: Record<string, unknown> }> };
const GOOD = '604175';
const OTHER = '246810';

beforeEach(() => {
    mem.store.clear();
    strength.value = 'strict';
});

describe('createPinStore', () => {
    const kiosk = () => createPinStore('kiosk');

    it('sets and checks a PIN, kept in app_pins under <namespace>__<uid>, never in auth_pins', async () => {
        await kiosk().set('u1', GOOD);
        await expect(kiosk().check('u1', GOOD)).resolves.toEqual({ ok: true });
        expect(mem.all(APP_PINS).map((d) => d.id)).toEqual(['kiosk__u1']);
        expect(mem.all(APP_PINS)[0].data).toMatchObject({ uid: 'u1', namespace: 'kiosk', failedAttempts: 0 });
        expect(JSON.stringify(mem.all(APP_PINS)[0].data)).not.toContain(GOOD);
        expect(mem.all(AUTH_PINS)).toEqual([]);
    });

    it('counts wrong PINs down, locks at the limit, and a correct PIN does not open a lock', async () => {
        const store = createPinStore('kiosk', { maxAttempts: 3 });
        await store.set('u1', GOOD);
        await expect(store.check('u1', OTHER)).resolves.toEqual({ ok: false, reason: 'wrong', remaining: 2 });
        await expect(store.check('u1', OTHER)).resolves.toEqual({ ok: false, reason: 'wrong', remaining: 1 });
        await expect(store.check('u1', OTHER)).resolves.toEqual({ ok: false, reason: 'locked' });
        await expect(store.check('u1', GOOD)).resolves.toEqual({ ok: false, reason: 'locked' });
    });

    it('unlocks with clearLock() without changing the PIN, or with a new PIN', async () => {
        const store = createPinStore('kiosk', { maxAttempts: 1 });
        await store.set('u1', GOOD);
        await store.check('u1', OTHER);
        await store.clearLock('u1');
        await expect(store.check('u1', GOOD)).resolves.toEqual({ ok: true });
        await store.check('u1', OTHER);
        await store.set('u1', OTHER);
        await expect(store.check('u1', OTHER)).resolves.toEqual({ ok: true });
    });

    it('a correct PIN resets the count of earlier wrong ones', async () => {
        const store = kiosk();
        await store.set('u1', GOOD);
        await store.check('u1', OTHER);
        await store.check('u1', GOOD);
        await expect(store.check('u1', OTHER)).resolves.toEqual({ ok: false, reason: 'wrong', remaining: 4 });
    });

    it('refuses a PIN that is not 6 digits, or too easy, at set()', async () => {
        await expect(kiosk().set('u1', '12345')).rejects.toThrow('A PIN is 6 digits.');
        await expect(kiosk().set('u1', '123456')).rejects.toThrow('too easy');
        await expect(kiosk().set('u1', '111111')).rejects.toThrow('too easy');
        expect(mem.all(APP_PINS)).toEqual([]);
    });

    it('follows the app\'s simple PINs, unless the store asks for strict', async () => {
        strength.value = 'simple';
        await expect(kiosk().set('u1', '123456')).resolves.toBeUndefined();
        await expect(kiosk().check('u1', '123456')).resolves.toEqual({ ok: true });
        await expect(kiosk().set('u1', '12345')).rejects.toMatchObject({ code: 'invalid-argument' });
        const staff = createPinStore('staff', { strength: 'strict' });
        await expect(staff.set('u1', '123456')).rejects.toMatchObject({ details: { reason: 'weak-pin' } });
        // And the other way: a strict app can keep a simple store.
        strength.value = 'strict';
        await expect(createPinStore('kiosk', { strength: 'simple' }).set('u2', '111111')).resolves.toBeUndefined();
    });

    it('refuses a strength that is not strict or simple', () => {
        expect(() => createPinStore('kiosk', { strength: 'easy' as never })).toThrow(/'strict' or 'simple'/);
    });

    it('treats a malformed PIN at check() as a wrong one', async () => {
        await kiosk().set('u1', GOOD);
        await expect(kiosk().check('u1', 12345 as unknown)).resolves.toEqual({ ok: false, reason: 'wrong', remaining: 4 });
    });

    it('keeps namespaces apart, says none for no PIN, and removes', async () => {
        await createPinStore('kiosk').set('u1', GOOD);
        await expect(createPinStore('staff').check('u1', GOOD)).resolves.toEqual({ ok: false, reason: 'none' });
        await expect(createPinStore('kiosk').has('u1')).resolves.toBe(true);
        await expect(createPinStore('staff').has('u1')).resolves.toBe(false);
        await createPinStore('kiosk').remove('u1');
        await expect(createPinStore('kiosk').has('u1')).resolves.toBe(false);
    });

    it('leaves Arc CMS\'s phone PIN alone', async () => {
        await setPin('u1', OTHER);
        await kiosk().set('u1', GOOD);
        await expect(checkPin('u1', OTHER)).resolves.toEqual({ ok: true });
        await expect(kiosk().check('u1', OTHER)).resolves.toMatchObject({ ok: false, reason: 'wrong' });
    });

    it('refuses bad namespaces, limits and uids', async () => {
        for (const bad of ['', 'T', 'kiosk app', 'a__b', '9kiosk', 'x']) expect(() => createPinStore(bad)).toThrow('PIN namespace');
        for (const bad of [0, 21, 2.5]) expect(() => createPinStore('kiosk', { maxAttempts: bad })).toThrow('maxAttempts');
        expect(() => createPinStore('kiosk', { maxAttempts: 1 })).not.toThrow();
        expect(() => createPinStore('kiosk', { maxAttempts: 20 })).not.toThrow();
        await expect(kiosk().set('', GOOD)).rejects.toThrow('No such person.');
        await expect(kiosk().set('a/b', GOOD)).rejects.toThrow('No such person.');
    });
});

describe('rate limits an app chooses', () => {
    it('hashedKey is stable, scoped, and never holds the raw value', () => {
        const key = hashedKey('kiosk-device', 'device-123');
        expect(key).toBe(hashedKey('kiosk-device', 'device-123'));
        expect(key).not.toBe(hashedKey('staff', 'device-123'));
        expect(key).toMatch(/^app-kiosk-device-[0-9a-f]{32}$/);
        expect(key).not.toContain('device-123');
        expect(() => hashedKey('Kiosk', 'x')).toThrow('Rate-limit scope');
        expect(() => hashedKey('kiosk', ' ')).toThrow('Nothing to count');
    });

    it('callerKey skips proxies of the app\'s own only when told to', () => {
        const req = (xff: string) => ({ rawRequest: { ip: '10.0.0.1', headers: { 'x-forwarded-for': xff } } }) as never;
        // Default: the last entry, the address Google's front end saw (today's behaviour).
        expect(callerKey(req('1.1.1.1, 203.0.113.9'))).toBe(callerKey(req('203.0.113.9')));
        // One proxy of its own (a Hosting rewrite): the entry before it.
        expect(callerKey(req('203.0.113.9, 151.101.1.1'), { trustedProxies: 1 })).toBe(callerKey(req('203.0.113.9')));
        expect(callerKey(req('203.0.113.9, 151.101.1.1'), { trustedProxies: 1 }))
            .not.toBe(callerKey(req('203.0.113.10, 151.101.1.1'), { trustedProxies: 1 }));
        // Too few entries: the connection's own address.
        expect(callerKey(req('203.0.113.9'), { trustedProxies: 3 })).toBe(callerKey({ rawRequest: { ip: '10.0.0.1', headers: {} } } as never));
    });
});
