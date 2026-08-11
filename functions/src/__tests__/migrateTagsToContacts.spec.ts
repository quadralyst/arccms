/**
 * Tests for the U2 tag migration callable
 * (functions/src/email-core/migrateTagsToContacts.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, mockRunTransaction } = vi.hoisted(() => ({
  store: new Map<string, any>(),
  mockRunTransaction: vi.fn(),
}));

function mergeMock(target: any, patch: any): any {
  for (const [k, v] of Object.entries(patch)) {
    if (v && (v as any).__arrayUnion) {
      const cur = Array.isArray(target[k]) ? target[k] : [];
      target[k] = [...new Set([...cur, ...(v as any).__arrayUnion])];
    } else if (v && (v as any).__increment !== undefined) {
      target[k] = (target[k] || 0) + (v as any).__increment;
    } else {
      target[k] = v;
    }
  }
  return target;
}

function docRef(path: string) {
  return {
    path,
    id: path.split('/').pop(),
    get: vi.fn(async () => ({ exists: store.has(path), data: () => store.get(path) })),
    set: vi.fn(async (data: any, opts?: any) => {
      const prev = store.get(path) || {};
      store.set(path, opts?.merge ? mergeMock({ ...prev }, data) : data);
    }),
    update: vi.fn(async (data: any) => {
      store.set(path, mergeMock({ ...(store.get(path) || {}) }, data));
    }),
  };
}

/** Docs directly under `prefix` (no deeper nesting). */
function docsUnder(prefix: string) {
  return [...store.entries()]
    .filter(([path]) => path.startsWith(`${prefix}/`) && !path.slice(prefix.length + 1).includes('/'))
    .map(([path, data]) => ({ id: path.split('/').pop()!, data: () => data, ref: docRef(path) }));
}

function collectionApi(col: string): any {
  return {
    doc: (id: string) => ({
      ...docRef(`${col}/${id}`),
      collection: (sub: string) => collectionApi(`${col}/${id}/${sub}`),
    }),
    get: async () => {
      const docs = docsUnder(col);
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  };
}

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((col: string) => collectionApi(col)),
    runTransaction: (fn: any) => mockRunTransaction(fn),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: vi.fn(() => ({ seconds: 0, nanoseconds: 0 })) },
  FieldValue: {
    arrayUnion: (...vals: any[]) => ({ __arrayUnion: vals }),
    arrayRemove: (...vals: any[]) => ({ __arrayRemove: vals }),
    increment: (n: number) => ({ __increment: n }),
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

import { migrateTagsToContacts } from '../email-core/migrateTagsToContacts.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';

const call = (data: any = {}) => (migrateTagsToContacts as any)({ auth: { token: { role: 'admin' } }, data });

const EMAIL_A = 'a@x.com';
const EMAIL_B = 'b@x.com';
const HASH_A = computeEmailHash(EMAIL_A);
const HASH_B = computeEmailHash(EMAIL_B);

describe('migrateTagsToContacts', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    mockRunTransaction.mockImplementation(async (fn: any) => {
      const txn = {
        get: (ref: any) => ref.get(),
        update: (ref: any, data: any) => ref.update(data),
        set: (ref: any, data: any, opts: any) => ref.set(data, opts),
      };
      return fn(txn);
    });
  });

  it('rejects non-admins', async () => {
    await expect(
      (migrateTagsToContacts as any)({ auth: { token: { role: 'user' } }, data: {} }),
    ).rejects.toThrow(/Admin role required/);
  });

  it('copies a waitlist tag onto the member contact', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha' });
    store.set('WaitlistUserTags_wl-1/t1', { label: 'VIP', color: '#ef4444' });
    store.set('Waitlists/wl-1/users/u1', { email: EMAIL_A, tags: ['t1'] });
    store.set(`Contacts/${HASH_A}`, { email: EMAIL_A, tags: [] });

    const res = await call();

    expect(res).toMatchObject({ tagsCreated: 1, contactsTagged: 1, assignmentsCopied: 1 });
    expect(store.get('ContactTags/vip')).toMatchObject({ label: 'VIP', color: '#ef4444' });
    expect(store.get(`Contacts/${HASH_A}`).tags).toEqual(['vip']);
    expect(store.get('ContactTags/vip').usageCount).toBe(1);
  });

  it('merges the same label across two waitlists into one global tag', async () => {
    // The headline win: "VIP" existed twice, unqueryable together.
    store.set('Waitlists/wl-1', { name: 'Alpha' });
    store.set('Waitlists/wl-2', { name: 'Beta' });
    store.set('WaitlistUserTags_wl-1/t1', { label: 'VIP', color: '#ef4444' });
    store.set('WaitlistUserTags_wl-2/t9', { label: 'vip', color: '#10b981' });
    store.set('Waitlists/wl-1/users/u1', { email: EMAIL_A, tags: ['t1'] });
    store.set('Waitlists/wl-2/users/u2', { email: EMAIL_B, tags: ['t9'] });
    store.set(`Contacts/${HASH_A}`, { email: EMAIL_A, tags: [] });
    store.set(`Contacts/${HASH_B}`, { email: EMAIL_B, tags: [] });

    const res = await call();

    expect(res).toMatchObject({ tagsCreated: 1, tagsMerged: 1 });
    expect([...store.keys()].filter((k) => k.startsWith('ContactTags/'))).toEqual(['ContactTags/vip']);
    // Both contacts now carry the one tag — targetable together.
    expect(store.get(`Contacts/${HASH_A}`).tags).toEqual(['vip']);
    expect(store.get(`Contacts/${HASH_B}`).tags).toEqual(['vip']);
    expect(store.get('ContactTags/vip').usageCount).toBe(2);
    // First colour wins; the merge doesn't restyle the existing tag.
    expect(store.get('ContactTags/vip').color).toBe('#ef4444');
  });

  it('is idempotent — a second run copies nothing new', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha' });
    store.set('WaitlistUserTags_wl-1/t1', { label: 'VIP' });
    store.set('Waitlists/wl-1/users/u1', { email: EMAIL_A, tags: ['t1'] });
    store.set(`Contacts/${HASH_A}`, { email: EMAIL_A, tags: [] });

    await call();
    const second = await call();

    expect(second).toMatchObject({ tagsCreated: 0, tagsMerged: 1, assignmentsCopied: 0 });
    expect(store.get(`Contacts/${HASH_A}`).tags).toEqual(['vip']);
    expect(store.get('ContactTags/vip').usageCount).toBe(1);
  });

  it('remaps the form default tag to the global id', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha', defaultTagId: 't1' });
    store.set('WaitlistUserTags_wl-1/t1', { label: 'Early Bird' });

    const res = await call();

    expect(res.defaultTagsRemapped).toBe(1);
    expect(store.get('Waitlists/wl-1').defaultTagId).toBe('early-bird');
  });

  it('counts members whose contact does not exist yet, without failing', async () => {
    // backfillPendingContacts creates these; re-running then picks them up.
    store.set('Waitlists/wl-1', { name: 'Alpha' });
    store.set('WaitlistUserTags_wl-1/t1', { label: 'VIP' });
    store.set('Waitlists/wl-1/users/u1', { email: EMAIL_A, tags: ['t1'] });

    const res = await call();

    expect(res).toMatchObject({ membersWithoutContact: 1, assignmentsCopied: 0 });
  });

  it('reports unsluggable labels instead of silently dropping them', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha' });
    store.set('WaitlistUserTags_wl-1/t1', { label: '!!!' });

    const res = await call();

    expect(res.skippedLabels).toEqual(['wl-1/t1:"!!!"']);
    expect(res.tagsCreated).toBe(0);
  });

  it('ignores waitlists with no tag collection', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha' });
    const res = await call();
    expect(res).toMatchObject({ forms: 1, tagsCreated: 0, assignmentsCopied: 0 });
  });

  it('dryRun reports without writing', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha', defaultTagId: 't1' });
    store.set('WaitlistUserTags_wl-1/t1', { label: 'VIP' });
    store.set('Waitlists/wl-1/users/u1', { email: EMAIL_A, tags: ['t1'] });
    store.set(`Contacts/${HASH_A}`, { email: EMAIL_A, tags: [] });

    const res = await call({ dryRun: true });

    expect(res).toMatchObject({ dryRun: true, tagsCreated: 1, assignmentsCopied: 1, defaultTagsRemapped: 1 });
    expect(store.has('ContactTags/vip')).toBe(false);
    expect(store.get(`Contacts/${HASH_A}`).tags).toEqual([]);
    expect(store.get('Waitlists/wl-1').defaultTagId).toBe('t1');
  });

  it('leaves legacy tags and member docs in place (non-destructive)', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha' });
    store.set('WaitlistUserTags_wl-1/t1', { label: 'VIP' });
    store.set('Waitlists/wl-1/users/u1', { email: EMAIL_A, tags: ['t1'] });
    store.set(`Contacts/${HASH_A}`, { email: EMAIL_A, tags: [] });

    await call();

    expect(store.get('WaitlistUserTags_wl-1/t1')).toMatchObject({ label: 'VIP' });
    expect(store.get('Waitlists/wl-1/users/u1').tags).toEqual(['t1']);
  });
});
