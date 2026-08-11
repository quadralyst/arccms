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

// Enough query surface for the helpers that page over Contacts.
function makeCollection(col: string) {
  return {
    doc: (id: string) => docRef(`${col}/${id}`),
    where: (field: string, op: string, value: any) => makeQuery(col, [{ field, op, value }]),
  };
}

function makeQuery(col: string, filters: any[], max?: number): any {
  return {
    where: (field: string, op: string, value: any) => makeQuery(col, [...filters, { field, op, value }], max),
    limit: (n: number) => makeQuery(col, filters, n),
    get: async () => {
      let docs = [...store.entries()]
        .filter(([path]) => path.startsWith(`${col}/`))
        .filter(([, data]) => filters.every((f) => matchesFilter(data, f)))
        .map(([path, data]) => ({ id: path.slice(col.length + 1), data: () => data, ref: docRef(path) }));
      if (max !== undefined) docs = docs.slice(0, max);
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  };
}

function matchesFilter(data: any, f: any): boolean {
  const v = data?.[f.field];
  if (f.op === 'array-contains') return Array.isArray(v) && v.includes(f.value);
  if (f.op === '==') return v === f.value;
  return true;
}

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((col: string) => makeCollection(col)),
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

// Membership helpers trigger drip enroll/exit (Phase 7) — stub them out here.
vi.mock('../email-core/dripEnrollment', () => ({
  enrollInListCampaigns: vi.fn().mockResolvedValue(undefined),
  exitListCampaignEnrollments: vi.fn().mockResolvedValue(undefined),
}));

import {
  upsertContact,
  addContactToLists,
  removeContactFromLists,
  getContactConsent,
  setContactConsent,
  ensureList,
  ensureFormList,
  deleteFormList,
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

  describe('ensureFormList', () => {
    it('creates the mirrored list with the form back-pointer', async () => {
      const listId = await ensureFormList('wl-1', 'Beta Waitlist');

      expect(listId).toBe('waitlist-wl-1');
      expect(store.get('Lists/waitlist-wl-1')).toMatchObject({
        name: 'Beta Waitlist',
        formId: 'wl-1',
        type: 'system',
        memberCount: 0,
      });
    });

    it('repairs a list created by the old lazy path (no formId, placeholder name)', async () => {
      // What contactSync's ensureList left behind before U1.
      await ensureList('waitlist-wl-1', { name: 'Waitlist wl-1', type: 'system' });
      store.set('Lists/waitlist-wl-1', { ...store.get('Lists/waitlist-wl-1'), memberCount: 7 });

      await ensureFormList('wl-1', 'Beta Waitlist');

      const list = store.get('Lists/waitlist-wl-1');
      expect(list.formId).toBe('wl-1');
      expect(list.name).toBe('Beta Waitlist');
      // Repair must never disturb membership counts.
      expect(list.memberCount).toBe(7);
    });

    it('is idempotent', async () => {
      await ensureFormList('wl-1', 'Beta');
      await ensureFormList('wl-1', 'Beta');
      expect(store.get('Lists/waitlist-wl-1').memberCount).toBe(0);
    });
  });

  describe('deleteFormList', () => {
    it('detaches every member and deletes the list doc', async () => {
      await ensureFormList('wl-1', 'Beta');
      await upsertContact({ email: 'a@x.com', source: 'waitlist', addLists: ['waitlist-wl-1'] });
      await upsertContact({ email: 'b@x.com', source: 'waitlist', addLists: ['waitlist-wl-1', 'newsletter'] });
      expect(store.get('Lists/waitlist-wl-1').memberCount).toBe(2);

      const res = await deleteFormList('wl-1');

      expect(res.removed).toBe(2);
      expect(store.has('Lists/waitlist-wl-1')).toBe(false);
      // No contact keeps a listId pointing at the deleted form...
      for (const [path, data] of store.entries()) {
        if (path.startsWith('Contacts/')) expect(data.listIds).not.toContain('waitlist-wl-1');
      }
      // ...but their other memberships survive.
      const b = store.get(`Contacts/${computeEmailHash('b@x.com')}`);
      expect(b.listIds).toEqual(['newsletter']);
    });

    it('handles a form list with no members', async () => {
      await ensureFormList('wl-1', 'Beta');

      const res = await deleteFormList('wl-1');

      expect(res.removed).toBe(0);
      expect(store.has('Lists/waitlist-wl-1')).toBe(false);
    });
  });
});
