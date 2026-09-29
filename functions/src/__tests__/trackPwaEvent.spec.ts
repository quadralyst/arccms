/**
 * App install tracking: daily counters by platform, and the `pwa` note on the
 * signed-in person's record.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../init', async () => {
    const { MemoryFirestore } = await import('./helpers/memoryFirestore.js');
    return { db: new MemoryFirestore(), owner: {} };
});
vi.mock('firebase-admin/firestore', async () => {
    const { FakeTimestamp } = await import('./helpers/memoryFirestore.js');
    return {
        Timestamp: FakeTimestamp,
        FieldValue: {
            delete: () => ({ _delete: true }),
            increment: (n: number) => ({ _increment: n }),
            serverTimestamp: () => ({ _serverTimestamp: true }),
        },
    };
});
vi.mock('firebase-functions/v2/https', () => ({
    onCall: vi.fn((handler: unknown) => handler),
    HttpsError: class extends Error {
        constructor(public code: string, message: string) {
            super(message);
        }
    },
}));

import { db } from '../init.js';
import { PWA_EVENTS_PER_HOUR, PWA_STATS, statsDay, statsUpdate, trackPwaEvent } from '../pwa/trackPwaEvent.js';
import type { MemoryFirestore } from './helpers/memoryFirestore.js';

const mem = db as unknown as MemoryFirestore;
type Handler = (request: unknown) => Promise<any>;
const call = (data: Record<string, unknown>, uid?: string) =>
    (trackPwaEvent as unknown as Handler)({ data, auth: uid ? { uid, token: {} } : undefined });

beforeEach(() => {
    mem.store.clear();
});

describe('statsDay and statsUpdate', () => {
    it('names the day in UTC', () => {
        expect(statsDay(new Date('2026-10-11T23:30:00Z'))).toBe('2026-10-11');
    });

    it('counts the event in total and for its platform', () => {
        expect(statsUpdate('installed', 'ios', '2026-10-11')).toEqual({
            date: '2026-10-11',
            installed: { total: { _increment: 1 }, ios: { _increment: 1 } },
            updatedAt: { _serverTimestamp: true },
        });
    });
});

describe('trackPwaEvent', () => {
    it('counts an event from someone not signed in', async () => {
        await expect(call({ event: 'prompt_shown', platform: 'android' })).resolves.toEqual({ ok: true });
        expect(mem.read(PWA_STATS, statsDay())).toMatchObject({ prompt_shown: { total: { _increment: 1 }, android: { _increment: 1 } } });
    });

    it('refuses an unknown event or platform', async () => {
        await expect(call({ event: 'hacked', platform: 'ios' })).rejects.toMatchObject({ code: 'invalid-argument' });
        await expect(call({ event: 'installed', platform: 'windows-phone' })).rejects.toMatchObject({ code: 'invalid-argument' });
        expect(mem.all(PWA_STATS)).toHaveLength(0);
    });

    it('marks the signed-in person as installed, and never rewrites the install time', async () => {
        mem.seed('users', 'rec-1', { uid: 'u1', name: 'Asha' });
        await call({ event: 'installed', platform: 'ios' }, 'u1');
        expect(mem.read('users', 'rec-1')).toMatchObject({
            name: 'Asha',
            pwa: { installed: true, platform: 'ios', installedAt: { _serverTimestamp: true } },
        });

        await call({ event: 'opened_installed', platform: 'ios' }, 'u1');
        const pwa = mem.read('users', 'rec-1')!['pwa'] as Record<string, unknown>;
        expect(pwa).toMatchObject({ installed: true, lastOpenedAt: { _serverTimestamp: true } });
        expect(pwa['installedAt']).toBeUndefined(); // not in the second write, so Firestore keeps the first
    });

    it('leaves the record alone for the other events', async () => {
        mem.seed('users', 'rec-1', { uid: 'u1' });
        await call({ event: 'dismissed', platform: 'desktop' }, 'u1');
        expect(mem.read('users', 'rec-1')!['pwa']).toBeUndefined();
    });

    it(`counts at most ${PWA_EVENTS_PER_HOUR} events an hour from one caller, quietly (review F)`, async () => {
        const from = (ip: string) => (trackPwaEvent as unknown as Handler)({
            data: { event: 'prompt_shown', platform: 'android' }, rawRequest: { ip, headers: {} },
        });
        for (let i = 0; i < PWA_EVENTS_PER_HOUR; i++) await from('203.0.113.9');
        await expect(from('203.0.113.9')).resolves.toEqual({ ok: true, counted: false });
        await expect(from('203.0.113.10')).resolves.toEqual({ ok: true });
    });

    it('writes the record only when something changes: not again for the same install or the same day (review F)', async () => {
        const today = { toDate: () => new Date() };
        mem.seed('users', 'rec-1', { uid: 'u1', pwa: { installed: true, platform: 'ios', lastOpenedAt: today } });
        await call({ event: 'installed', platform: 'ios' }, 'u1');
        await call({ event: 'opened_installed', platform: 'ios' }, 'u1');
        expect(mem.read('users', 'rec-1')!['pwa']).toEqual({ installed: true, platform: 'ios', lastOpenedAt: today });

        mem.seed('users', 'rec-1', { uid: 'u1', pwa: { installed: true, platform: 'ios', lastOpenedAt: { toDate: () => new Date(Date.now() - 2 * 86_400_000) } } });
        await call({ event: 'opened_installed', platform: 'ios' }, 'u1');
        expect((mem.read('users', 'rec-1')!['pwa'] as Record<string, unknown>)['lastOpenedAt']).toEqual({ _serverTimestamp: true });
    });
});
