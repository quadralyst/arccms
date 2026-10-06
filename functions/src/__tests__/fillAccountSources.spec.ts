/**
 * fillAccountSources (functions/src/users/fillAccountSources.ts): older `users` records
 * get `by: 'unknown'`, so the users list's People filter finds them.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const m = vi.hoisted(() => {
    const records = new Map<string, Record<string, unknown>>();
    const commits: number[] = [];
    const db = {
        collection: vi.fn((name: string) => {
            if (name !== 'users') throw new Error(`unexpected collection ${name}`);
            return {
                select: (...fields: string[]) => ({
                    get: async () => {
                        const docs = [...records.entries()].map(([id, data]) => ({
                            id,
                            ref: { id },
                            data: () => Object.fromEntries(fields.filter((f) => f in data).map((f) => [f, data[f]])),
                        }));
                        return { docs, size: docs.length };
                    },
                }),
            };
        }),
        batch: vi.fn(() => {
            const updates: Array<[string, Record<string, unknown>]> = [];
            return {
                update: (ref: { id: string }, patch: Record<string, unknown>) => { updates.push([ref.id, patch]); },
                commit: async () => {
                    for (const [id, patch] of updates) records.set(id, { ...records.get(id), ...patch });
                    commits.push(updates.length);
                },
            };
        }),
    };
    return { records, commits, db };
});

vi.mock('../init', () => ({ db: m.db }));
vi.mock('../init.js', () => ({ db: m.db }));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
    onCall: (handler: unknown) => handler,
    HttpsError: class HttpsError extends Error {
        constructor(public code: string, message: string) { super(message); }
    },
}));

import { fillAccountSources, hasSource, UNKNOWN_SOURCE } from '../users/fillAccountSources.js';

const call = (token: Record<string, unknown> | undefined) =>
    (fillAccountSources as unknown as (req: unknown) => Promise<{ filled: number; total: number }>)({ auth: token ? { uid: 'a', token } : undefined, data: {} });
const ADMIN = { arccms_role: 'admin' };

beforeEach(() => {
    m.records.clear();
    m.commits.length = 0;
});

describe('fillAccountSources', () => {
    it('gives a record with no by, or an empty one, by: unknown, and leaves every other record alone', async () => {
        m.records.set('old', { name: 'Old', email: 'old@x.com' });
        m.records.set('blank', { name: 'Blank', by: '' });
        m.records.set('email', { name: 'Asha', by: 'email' });
        m.records.set('app', { name: 'Kiosk', by: 'app' });
        m.records.set('custom', { name: 'Imported', by: 'import' });

        await expect(call(ADMIN)).resolves.toEqual({ filled: 2, total: 5 });

        expect(m.records.get('old')).toEqual({ name: 'Old', email: 'old@x.com', by: UNKNOWN_SOURCE });
        expect(m.records.get('blank')?.['by']).toBe(UNKNOWN_SOURCE);
        expect(m.records.get('email')?.['by']).toBe('email');
        expect(m.records.get('app')?.['by']).toBe('app');
        expect(m.records.get('custom')?.['by']).toBe('import');
    });

    it('writes nothing on a second run', async () => {
        m.records.set('old', { name: 'Old' });
        await call(ADMIN);
        await expect(call(ADMIN)).resolves.toEqual({ filled: 0, total: 1 });
        expect(m.commits).toEqual([1]);
    });

    it('writes in batches Firestore accepts', async () => {
        for (let i = 0; i < 950; i++) m.records.set(`r${i}`, { name: `R${i}` });
        await expect(call(ADMIN)).resolves.toEqual({ filled: 950, total: 950 });
        expect(m.commits).toEqual([400, 400, 150]);
    });

    it('is for admins only', async () => {
        m.records.set('old', { name: 'Old' });
        await expect(call(undefined)).rejects.toMatchObject({ code: 'permission-denied' });
        await expect(call({ arccms_role: 'user' })).rejects.toMatchObject({ code: 'permission-denied' });
        // A host app's own admin claim is not an Arc CMS admin.
        await expect(call({ role: 'admin' })).rejects.toMatchObject({ code: 'permission-denied' });
        expect(m.records.get('old')).toEqual({ name: 'Old' });
    });
});

describe('hasSource', () => {
    it('is true only for a non-empty string', () => {
        expect(hasSource({ by: 'email' })).toBe(true);
        expect(hasSource({ by: '  ' })).toBe(false);
        expect(hasSource({ by: null })).toBe(false);
        expect(hasSource({})).toBe(false);
        expect(hasSource(undefined)).toBe(false);
    });
});
