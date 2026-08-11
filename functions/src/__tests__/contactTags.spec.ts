/**
 * Tests for the global contact-tags helpers (functions/src/email-core/contactTags.ts).
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
    } else if (v && (v as any).__arrayRemove) {
      const cur = Array.isArray(target[k]) ? target[k] : [];
      target[k] = cur.filter((x: any) => !(v as any).__arrayRemove.includes(x));
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
  },
}));

import {
  tagIdFromLabel,
  ensureTag,
  addTagsToContact,
  removeTagsFromContact,
  setContactTags,
} from '../email-core/contactTags.js';

const HASH = 'hash-1';

describe('contactTags', () => {
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

  describe('tagIdFromLabel', () => {
    it('slugifies so equivalent labels collapse to one tag', () => {
      expect(tagIdFromLabel('VIP')).toBe('vip');
      expect(tagIdFromLabel('vip')).toBe('vip');
      expect(tagIdFromLabel('  VIP  ')).toBe('vip');
      // This is what merges per-waitlist duplicates on migration.
      expect(tagIdFromLabel('Beta Tester')).toBe('beta-tester');
      expect(tagIdFromLabel('beta   tester')).toBe('beta-tester');
      expect(tagIdFromLabel('Beta--Tester!')).toBe('beta-tester');
    });

    it('returns empty for a label with nothing sluggable', () => {
      expect(tagIdFromLabel('!!!')).toBe('');
      expect(tagIdFromLabel('')).toBe('');
      expect(tagIdFromLabel('   ')).toBe('');
    });

    it('caps length', () => {
      expect(tagIdFromLabel('a'.repeat(100)).length).toBe(60);
    });
  });

  describe('ensureTag', () => {
    it('creates a tag with a slug id and zero usage', async () => {
      const id = await ensureTag('VIP', '#ef4444');
      expect(id).toBe('vip');
      expect(store.get('ContactTags/vip')).toMatchObject({
        id: 'vip', label: 'VIP', color: '#ef4444', usageCount: 0,
      });
    });

    it('never clobbers an existing tag (migration merges, admin renames survive)', async () => {
      await ensureTag('VIP', '#ef4444');
      store.set('ContactTags/vip', { ...store.get('ContactTags/vip'), usageCount: 7, label: 'VIP Renamed' });

      const id = await ensureTag('vip', '#10b981');

      expect(id).toBe('vip');
      const tag = store.get('ContactTags/vip');
      expect(tag.label).toBe('VIP Renamed');
      expect(tag.color).toBe('#ef4444');
      expect(tag.usageCount).toBe(7);
    });

    it('refuses an unsluggable label instead of writing an empty id', async () => {
      expect(await ensureTag('!!!')).toBeNull();
      expect(store.size).toBe(0);
    });

    it('defaults the colour when none given', async () => {
      await ensureTag('Plain');
      expect(store.get('ContactTags/plain').color).toBe('#6b7280');
    });
  });

  describe('addTagsToContact', () => {
    beforeEach(() => {
      store.set(`Contacts/${HASH}`, { email: 'a@x.com', tags: [] });
      store.set('ContactTags/vip', { id: 'vip', label: 'VIP', usageCount: 0 });
    });

    it('adds the tag and bumps usageCount', async () => {
      const added = await addTagsToContact(HASH, ['vip']);
      expect(added).toEqual(['vip']);
      expect(store.get(`Contacts/${HASH}`).tags).toEqual(['vip']);
      expect(store.get('ContactTags/vip').usageCount).toBe(1);
    });

    it('is idempotent — re-adding does not double-count', async () => {
      await addTagsToContact(HASH, ['vip']);
      const again = await addTagsToContact(HASH, ['vip']);
      expect(again).toEqual([]);
      expect(store.get('ContactTags/vip').usageCount).toBe(1);
    });

    it('no-ops for a contact that does not exist', async () => {
      expect(await addTagsToContact('missing', ['vip'])).toEqual([]);
      expect(store.get('ContactTags/vip').usageCount).toBe(0);
    });

    it('ignores empty input', async () => {
      expect(await addTagsToContact(HASH, [])).toEqual([]);
    });
  });

  describe('removeTagsFromContact', () => {
    beforeEach(() => {
      store.set(`Contacts/${HASH}`, { email: 'a@x.com', tags: ['vip', 'beta'] });
      store.set('ContactTags/vip', { id: 'vip', usageCount: 1 });
      store.set('ContactTags/beta', { id: 'beta', usageCount: 1 });
    });

    it('removes only the named tag and decrements its count', async () => {
      const removed = await removeTagsFromContact(HASH, ['vip']);
      expect(removed).toEqual(['vip']);
      expect(store.get(`Contacts/${HASH}`).tags).toEqual(['beta']);
      expect(store.get('ContactTags/vip').usageCount).toBe(0);
      expect(store.get('ContactTags/beta').usageCount).toBe(1);
    });

    it('does not decrement for a tag the contact never had', async () => {
      store.set('ContactTags/other', { id: 'other', usageCount: 3 });
      expect(await removeTagsFromContact(HASH, ['other'])).toEqual([]);
      expect(store.get('ContactTags/other').usageCount).toBe(3);
    });
  });

  describe('setContactTags', () => {
    beforeEach(() => {
      store.set(`Contacts/${HASH}`, { email: 'a@x.com', tags: ['vip'] });
      store.set('ContactTags/vip', { id: 'vip', usageCount: 1 });
      store.set('ContactTags/beta', { id: 'beta', usageCount: 0 });
    });

    it('diffs so counts stay right on both sides', async () => {
      await setContactTags(HASH, ['beta']);

      expect(store.get(`Contacts/${HASH}`).tags).toEqual(['beta']);
      expect(store.get('ContactTags/vip').usageCount).toBe(0);
      expect(store.get('ContactTags/beta').usageCount).toBe(1);
    });

    it('clearing all tags decrements everything held', async () => {
      await setContactTags(HASH, []);
      expect(store.get(`Contacts/${HASH}`).tags).toEqual([]);
      expect(store.get('ContactTags/vip').usageCount).toBe(0);
    });

    it('setting the same tags is a no-op', async () => {
      await setContactTags(HASH, ['vip']);
      expect(store.get(`Contacts/${HASH}`).tags).toEqual(['vip']);
      expect(store.get('ContactTags/vip').usageCount).toBe(1);
    });
  });
});
