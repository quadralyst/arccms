/**
 * Tests for the Contacts/Lists core helpers (functions/src/email-core/contacts.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, mockRunTransaction } = vi.hoisted(() => ({
  store: new Map<string, any>(),
  mockRunTransaction: vi.fn(),
}));

// A tiny in-memory Firestore good enough for the helper logic.
function docRef(path: string) {
  return {
    path,
    get: vi.fn(async () => ({ exists: store.has(path), data: () => store.get(path) })),
    set: vi.fn(async (data: any, opts?: any) => {
      const prev = store.get(path) || {};
      store.set(path, opts?.merge ? mergeMock({ ...prev }, data) : data);
    }),
    update: vi.fn(async (data: any) => {
      store.set(path, mergeMock({ ...(store.get(path) || {}) }, data));
    }),
    delete: vi.fn(async () => store.delete(path)),
  };
}

// Emulate FieldValue sentinels used by the helpers.
function mergeMock(target: any, patch: any): any {
  for (const [k, v] of Object.entries(patch)) {
    if (v && (v as any).__arrayUnion) {
      const cur = Array.isArray(target[k]) ? target[k] : [];
      target[k] = [...new Set([...cur, ...(v as any).__arrayUnion])];
    } else if (v && (v as any).__arrayRemove) {
      const cur = Array.isArray(target[k]) ? target[k] : [];
      target[k] = cur.filter((x: any) => !(v as any).__arrayRemove.includes(x));
    } else if (v && (v as any).__increment !== undefined) {
      target[k] = (target[k] || 0) + (v as any).__increment;
    } else if (v && (v as any).__delete) {
      delete target[k];
    } else {
      target[k] = v;
    }
  }
  return target;
}

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((col: string) => ({ doc: (id: string) => docRef(`${col}/${id}`) })),
    runTransaction: (fn: any) => mockRunTransaction(fn),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: vi.fn(() => ({ seconds: 0, nanoseconds: 0 })) },
  FieldValue: {
    arrayUnion: (...vals: any[]) => ({ __arrayUnion: vals }),
    arrayRemove: (...vals: any[]) => ({ __arrayRemove: vals }),
    increment: (n: number) => ({ __increment: n }),
    delete: () => ({ __delete: true }),
  },
}));

vi.mock('../constant', () => ({ constant: { isProduction: false, live_url: 'https://x/', local_url: 'http://l/' } }));

import {
  upsertContact,
  addContactToLists,
  removeContactFromLists,
  getContactConsent,
  setContactConsent,
  ensureList,
  SYSTEM_LISTS,
  waitlistListId,
} from '../email-core/contacts.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';

// Run transactions inline against the in-memory store.
mockRunTransaction.mockImplementation(async (fn: any) => {
  const txn = {
    get: (ref: any) => ref.get(),
    update: (ref: any, data: any) => ref.update(data),
    set: (ref: any, data: any, opts: any) => ref.set(data, opts),
  };
  return fn(txn);
});

const EMAIL = 'user@example.com';
const HASH = computeEmailHash(EMAIL);

describe('contacts helpers', () => {
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

  it('upsertContact creates a contact keyed by emailHash with default consent', async () => {
    const res = await upsertContact({ email: EMAIL, source: 'signup' });
    expect(res.created).toBe(true);
    expect(res.emailHash).toBe(HASH);
    const c = store.get(`Contacts/${HASH}`);
    expect(c.email).toBe(EMAIL);
    expect(c.sources).toContain('signup');
    expect(c.consent.marketing).toBe('subscribed');
  });

  it('upsertContact merges a second source without duplicating', async () => {
    await upsertContact({ email: EMAIL, source: 'signup' });
    const res = await upsertContact({ email: EMAIL, source: 'customer' });
    expect(res.created).toBe(false);
    const c = store.get(`Contacts/${HASH}`);
    expect(c.sources.sort()).toEqual(['customer', 'signup']);
  });

  it('addContactToLists updates listIds and increments memberCount once', async () => {
    await upsertContact({ email: EMAIL, source: 'signup' });
    await ensureList(SYSTEM_LISTS.ALL_USERS, { name: 'All Users' });

    const added = await addContactToLists(HASH, [SYSTEM_LISTS.ALL_USERS]);
    expect(added).toEqual([SYSTEM_LISTS.ALL_USERS]);
    expect(store.get(`Contacts/${HASH}`).listIds).toContain(SYSTEM_LISTS.ALL_USERS);
    expect(store.get(`Lists/${SYSTEM_LISTS.ALL_USERS}`).memberCount).toBe(1);

    // Idempotent: re-adding does not double count.
    const again = await addContactToLists(HASH, [SYSTEM_LISTS.ALL_USERS]);
    expect(again).toEqual([]);
    expect(store.get(`Lists/${SYSTEM_LISTS.ALL_USERS}`).memberCount).toBe(1);
  });

  it('removeContactFromLists decrements memberCount and updates listIds', async () => {
    await upsertContact({ email: EMAIL, source: 'signup' });
    await ensureList('newsletter', { name: 'Newsletter', type: 'manual' });
    await addContactToLists(HASH, ['newsletter']);
    expect(store.get(`Lists/newsletter`).memberCount).toBe(1);

    const removed = await removeContactFromLists(HASH, ['newsletter']);
    expect(removed).toEqual(['newsletter']);
    expect(store.get(`Contacts/${HASH}`).listIds).not.toContain('newsletter');
    expect(store.get(`Lists/newsletter`).memberCount).toBe(0);
  });

  it('setContactConsent + getContactConsent round-trip', async () => {
    await upsertContact({ email: EMAIL, source: 'signup' });
    expect(await getContactConsent(HASH)).toBe('subscribed');
    await setContactConsent(HASH, 'unsubscribed');
    expect(await getContactConsent(HASH)).toBe('unsubscribed');
  });

  it('getContactConsent returns null when no contact exists', async () => {
    expect(await getContactConsent('nonexistent')).toBeNull();
  });

  it('ensureList does not reset an existing memberCount', async () => {
    await ensureList('newsletter', { name: 'Newsletter', type: 'manual' });
    store.set('Lists/newsletter', { ...store.get('Lists/newsletter'), memberCount: 5 });
    await ensureList('newsletter', { name: 'Renamed' });
    expect(store.get('Lists/newsletter').memberCount).toBe(5);
  });

  it('waitlistListId is deterministic', () => {
    expect(waitlistListId('abc')).toBe('waitlist-abc');
  });
});
