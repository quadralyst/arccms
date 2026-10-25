/**
 * The devices a person proved for PIN sign-in (functions/src/auth/devices.ts), on an
 * in-memory Firestore: only hashes kept, at most 10, a year unused forgotten.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner: {} };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return { Timestamp: FakeTimestamp };
});

import { db } from '../init.js';
import { AUTH_DEVICES, DEVICE_UNUSED_MS, MAX_DEVICES, forgetDevices, knownDevice, readDeviceKey, rememberDevice } from '../auth/devices.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
const key = (n: number) => `key-${String(n).padStart(40, '0')}`;

beforeEach(() => {
    mem.store.clear();
    vi.useRealTimers();
});

describe('device keys', () => {
    it('takes only a key the page could have made, never anything else', () => {
        expect(readDeviceKey(key(1))).toBe(key(1));
        for (const bad of ['short', 'x'.repeat(129), 'has space'.padEnd(40, 'x'), 42, undefined, null]) expect(readDeviceKey(bad)).toBeNull();
    });

    it('keeps only a hash of the key', async () => {
        await rememberDevice('u1', key(1));
        expect(JSON.stringify(mem.read(AUTH_DEVICES, 'u1'))).not.toContain(key(1));
        await expect(knownDevice('u1', key(1))).resolves.toBe(true);
        await expect(knownDevice('u1', key(2))).resolves.toBe(false);
        await expect(knownDevice('u2', key(1))).resolves.toBe(false);
        await expect(knownDevice('u1', null)).resolves.toBe(false);
    });

    it('keeps the 10 most recently used, dropping the least recently used', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        for (let i = 1; i <= MAX_DEVICES; i++) {
            vi.setSystemTime(1_000_000 + i * 1000);
            await rememberDevice('u1', key(i));
        }
        vi.setSystemTime(2_000_000);
        await knownDevice('u1', key(1)); // used again: now the most recent
        await rememberDevice('u1', key(99));
        await expect(knownDevice('u1', key(2))).resolves.toBe(false);
        await expect(knownDevice('u1', key(1))).resolves.toBe(true);
        await expect(knownDevice('u1', key(99))).resolves.toBe(true);
        expect((mem.read(AUTH_DEVICES, 'u1')?.['devices'] as unknown[]).length).toBe(MAX_DEVICES);
    });

    it('forgets a device unused for a year, and all of them on Forgot PIN', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(1_000_000);
        await rememberDevice('u1', key(1));
        vi.setSystemTime(1_000_000 + DEVICE_UNUSED_MS + 1);
        await expect(knownDevice('u1', key(1))).resolves.toBe(false);
        await rememberDevice('u1', key(2));
        await forgetDevices('u1');
        await expect(knownDevice('u1', key(2))).resolves.toBe(false);
    });
});
