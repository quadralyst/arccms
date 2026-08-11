/**
 * Tests for the U3 form→list backfill callable
 * (functions/src/email-core/stampFormTargetLists.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((col: string) => ({
      doc: (id: string) => ({
        update: async (data: any) => {
          store.set(`${col}/${id}`, { ...(store.get(`${col}/${id}`) || {}), ...data });
        },
      }),
      get: async () => {
        const docs = [...store.entries()]
          .filter(([path]) => path.startsWith(`${col}/`))
          .map(([path, data]) => ({ id: path.slice(col.length + 1), data: () => data }));
        return { size: docs.length, docs, empty: docs.length === 0 };
      },
    })),
  },
}));

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

import { stampFormTargetLists } from '../email-core/stampFormTargetLists.js';

const call = (data: any = {}) => (stampFormTargetLists as any)({ auth: { token: { role: 'admin' } }, data });

describe('stampFormTargetLists', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('rejects non-admins', async () => {
    await expect(
      (stampFormTargetLists as any)({ auth: { token: { role: 'user' } }, data: {} }),
    ).rejects.toThrow(/Admin role required/);
  });

  it('stamps the own list on a form that has no targetListIds', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha' });

    const res = await call();

    expect(res).toMatchObject({ forms: 1, stamped: 1, alreadyOk: 0 });
    expect(store.get('Waitlists/wl-1').targetListIds).toEqual(['waitlist-wl-1']);
  });

  it('preserves existing manual lists while ensuring the own list leads', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha', targetListIds: ['newsletter'] });

    await call();

    expect(store.get('Waitlists/wl-1').targetListIds).toEqual(['waitlist-wl-1', 'newsletter']);
  });

  it('is idempotent — an already-correct form is left alone', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha', targetListIds: ['waitlist-wl-1', 'newsletter'] });

    const res = await call();

    expect(res).toMatchObject({ stamped: 0, alreadyOk: 1 });
  });

  it('dryRun reports without writing', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha' });

    const res = await call({ dryRun: true });

    expect(res).toMatchObject({ dryRun: true, stamped: 1 });
    expect(store.get('Waitlists/wl-1').targetListIds).toBeUndefined();
  });

  it('handles several forms in mixed states', async () => {
    store.set('Waitlists/wl-1', { name: 'A' });                                        // needs stamp
    store.set('Waitlists/wl-2', { name: 'B', targetListIds: ['waitlist-wl-2'] });      // ok
    store.set('Waitlists/wl-3', { name: 'C', targetListIds: ['other'] });              // needs own list

    const res = await call();

    expect(res).toMatchObject({ forms: 3, stamped: 2, alreadyOk: 1 });
    expect(store.get('Waitlists/wl-3').targetListIds).toEqual(['waitlist-wl-3', 'other']);
  });
});
