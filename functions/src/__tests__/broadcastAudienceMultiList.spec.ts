/**
 * U4: multi-list broadcast audiences — union across lists, send-once dedup,
 * exclusion, and resume across the compound cursor.
 *
 * Uses a list-aware Firestore mock (the sibling broadcastAudience.spec.ts mock
 * returns the same page for every query, which cannot express "different members
 * per list").
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, mockQueueEmail } = vi.hoisted(() => ({
  // contactId -> { lists: string[], consent: string }
  store: {
    contacts: new Map<string, { lists: string[]; consent: string }>(),
    // App users (live) lists (CO6.5b): list id -> its current members.
    liveLists: new Map<string, Array<{ docId: string; email: string; consent: string }>>(),
  },
  mockQueueEmail: vi.fn(),
}));

/** Minimal Contacts query mock supporting array-contains + startAfter paging. */
function contactsQuery(filterListId?: string, after?: string) {
  const chain: any = {
    where: (field: string, _op: string, value: string) =>
      field === 'listIds' ? contactsQuery(value, after) : chain,
    orderBy: () => chain,
    limit: () => chain,
    startAfter: (cursor: string) => contactsQuery(filterListId, cursor),
    get: async () => {
      let ids = [...store.contacts.entries()]
        .filter(([, c]) => !filterListId || c.lists.includes(filterListId))
        .map(([id]) => id)
        .sort();
      if (after) ids = ids.filter((id) => id > after);
      const docs = ids.map((id) => ({
        id,
        data: () => ({
          email: `${id}@x.com`,
          name: id,
          listIds: store.contacts.get(id)!.lists,
          consent: { marketing: store.contacts.get(id)!.consent },
        }),
      }));
      return { docs, size: docs.length };
    },
  };
  return chain;
}

vi.mock('../init', async () => {
  const { createHash } = await import('node:crypto');
  const hash = (email: string) => createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
  return {
  db: {
    getAll: async (...refs: Array<{ coll: string; id: string }>) => refs.map((r) => {
      if (r.coll === 'Lists') {
        const live = store.liveLists.has(r.id);
        return { exists: live, data: () => (live ? { type: 'app', conditions: [{ field: 'list', op: 'is', value: r.id }] } : undefined) };
      }
      const entry = [...store.contacts.entries()].find(([id]) => hash(`${id}@x.com`) === r.id);
      return entry
        ? { exists: true, id: r.id, data: () => ({ email: `${entry[0]}@x.com`, listIds: entry[1].lists, consent: { marketing: entry[1].consent } }) }
        : { exists: false, id: r.id, data: () => undefined };
    }),
    collection: vi.fn((name: string) => {
      if (name === 'Lists') return { doc: (id: string) => ({ coll: 'Lists', id }) };
      if (name === 'Contacts') return Object.assign(contactsQuery(), { doc: (id: string) => ({ coll: 'Contacts', id }) });
      if (name === 'users') {
        return { where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }) };
      }
      return {};
    }),
  },
  };
});

vi.mock('../app-audience/adminCallables', () => ({ readAppAudienceSettings: async () => ({ key: { source: 'docId' }, watchedFields: [] }) }));
vi.mock('../app-audience/appLists', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../app-audience/appLists.js')>()),
  // The list's own id rides in its one condition, so each live list has its own members.
  resolveAppList: async (conditions: Array<{ value: string }>) => ({
    members: (store.liveLists.get(conditions[0].value) || []).map((m) => ({
      ...m, key: m.docId, name: m.docId, appUserId: `h-${m.docId}`, fields: { plan: 'pro' },
    })),
    scanned: 0,
    truncated: false,
  }),
}));

vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));
vi.mock('../email-log/broadcastHelper', () => ({ getDelayFromLimits: () => 0, sleep: () => Promise.resolve() }));
vi.mock('../email-core/contacts', () => ({ waitlistListId: (id: string) => `waitlist-${id}` }));
vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: vi.fn(() => ({ seconds: 0 })) },
  FieldPath: { documentId: vi.fn(() => '__id__') },
}));

import {
  countEligible,
  processAudienceChunk,
  audienceListIds,
  audienceListId,
} from '../email-log/broadcastAudience.js';

function seed(rows: Array<[string, string[], string?]>): void {
  store.contacts.clear();
  store.liveLists.clear();
  for (const [id, lists, consent] of rows) {
    store.contacts.set(id, { lists, consent: consent || 'subscribed' });
  }
}

const broadcastData: any = {
  waitlistId: '',
  subject: 'Hi',
  senderName: 'Site',
  senderEmail: 's@x.com',
  template: '<p>hi</p>',
};

async function send(audience: any, startAfterId?: string, timeBudgetMs = 60_000) {
  return processAudienceChunk({
    broadcastData: { ...broadcastData, audience },
    broadcastId: 'bc-1',
    providerLimits: {} as any,
    timeBudgetMs,
    startAfterId,
    initialSent: 0,
    initialSkipped: 0,
    initialFailed: 0,
  });
}

function recipients(): string[] {
  return mockQueueEmail.mock.calls.map((c) => c[0].toEmail).sort();
}

describe('multi-list audiences (U4)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mirror the real marketing gate: only a `subscribed` contact is queued, so
    // sentCount here means the same thing it does in production.
    mockQueueEmail.mockImplementation(async (params: any) => {
      const id = String(params.toEmail).split('@')[0];
      // A contact's consent wins; otherwise the app user's (queueEmail's isSubscribed fallback).
      const contact = store.contacts.get(id);
      const subscribed = contact ? contact.consent === 'subscribed' : params.isSubscribed !== false;
      return subscribed
        ? { id: 'log', status: 'pending' }
        : { id: 'log', status: 'skipped', skipReason: 'unsubscribed' };
    });
  });

  describe('audienceListIds normalisation', () => {
    it('reads the new include shape', () => {
      expect(audienceListIds({ include: ['a', 'b'] })).toEqual(['a', 'b']);
    });

    it('still reads a pre-U4 list doc', () => {
      expect(audienceListIds({ kind: 'list', listId: 'l1' })).toEqual(['l1']);
    });

    it('still reads a pre-U4 waitlist doc', () => {
      expect(audienceListIds({ kind: 'waitlist', waitlistId: 'wl1' })).toEqual(['waitlist-wl1']);
    });

    it('de-duplicates repeated list ids', () => {
      expect(audienceListIds({ include: ['a', 'a', 'b'] })).toEqual(['a', 'b']);
    });

    it('audienceListId still returns a single label for history/back-compat', () => {
      expect(audienceListId({ include: ['a', 'b'] })).toBe('a');
      expect(audienceListId({})).toBeNull();
    });
  });

  describe('union + send-once', () => {
    it('sends to the union of two lists', async () => {
      seed([['a', ['l1']], ['b', ['l2']]]);

      const res = await send({ include: ['l1', 'l2'] });

      expect(recipients()).toEqual(['a@x.com', 'b@x.com']);
      expect(res.sentCount).toBe(2);
    });

    it('emails a contact on BOTH lists exactly once', async () => {
      // The headline U4 guarantee: "everyone across these forms", not "twice".
      seed([['a', ['l1', 'l2']], ['b', ['l2']]]);

      const res = await send({ include: ['l1', 'l2'] });

      expect(recipients()).toEqual(['a@x.com', 'b@x.com']);
      expect(res.sentCount).toBe(2);
    });

    it('preview count matches what the send delivers', async () => {
      seed([['a', ['l1', 'l2']], ['b', ['l2']], ['c', ['l1'], 'pending']]);
      const audience = { include: ['l1', 'l2'] };

      const preview = await countEligible(audience);
      const res = await send(audience);

      expect(preview.count).toBe(2); // c is pending ⇒ not mailable
      expect(res.sentCount).toBe(preview.count);
    });
  });

  describe('exclude', () => {
    it('skips contacts on an excluded list', async () => {
      seed([['a', ['l1']], ['b', ['l1', 'customers']]]);

      const res = await send({ include: ['l1'], exclude: ['customers'] });

      expect(recipients()).toEqual(['a@x.com']);
      expect(res.sentCount).toBe(1);
    });

    it('exclusion wins over membership of several included lists', async () => {
      seed([['a', ['l1', 'l2', 'customers']], ['b', ['l2']]]);

      await send({ include: ['l1', 'l2'], exclude: ['customers'] });

      expect(recipients()).toEqual(['b@x.com']);
    });

    it('preview reflects exclusion too', async () => {
      seed([['a', ['l1']], ['b', ['l1', 'customers']]]);

      const res = await countEligible({ include: ['l1'], exclude: ['customers'] });

      expect(res.count).toBe(1);
    });
  });

  describe('resume across lists', () => {
    it('a compound cursor resumes the correct list without re-sending', async () => {
      seed([['a', ['l1']], ['b', ['l1']], ['c', ['l2']]]);

      // Resume at list index 1 (l2), nothing consumed yet in it.
      const res = await send({ include: ['l1', 'l2'] }, '1|');

      expect(recipients()).toEqual(['c@x.com']);
      expect(res.sentCount).toBe(1);
    });

    it('resumes mid-list after a given contact', async () => {
      seed([['a', ['l1']], ['b', ['l1']], ['c', ['l1']]]);

      const res = await send({ include: ['l1'] }, '0|a');

      expect(recipients()).toEqual(['b@x.com', 'c@x.com']);
      expect(res.sentCount).toBe(2);
    });

    it('treats a bare contact id (pre-U4 paused broadcast) as list 0', async () => {
      seed([['a', ['l1']], ['b', ['l1']]]);

      const res = await send({ kind: 'list', listId: 'l1' }, 'a');

      expect(recipients()).toEqual(['b@x.com']);
      expect(res.sentCount).toBe(1);
    });

    it('returns a compound cursor when it times out', async () => {
      seed([['a', ['l1']], ['b', ['l1']]]);

      // Zero budget ⇒ bail before the first contact, cursor must still be shaped
      // so the next chunk knows which list it was in.
      const res = await send({ include: ['l1', 'l2'] }, undefined, -1);

      expect(res.timedOut).toBe(true);
      expect(res.done).toBe(false);
      expect(res.sentCount).toBe(0);
    });
  });

  describe('empty audience', () => {
    it('an audience with no lists is done immediately', async () => {
      seed([['a', ['l1']]]);

      const res = await send({ include: [] });

      expect(res.done).toBe(true);
      expect(mockQueueEmail).not.toHaveBeenCalled();
    });
  });

  describe('App users (live) lists (CO6.5b)', () => {
    const live = (listId: string, rows: Array<[string, string?]>) =>
      store.liveLists.set(listId, rows.map(([id, consent]) => ({ docId: id, email: `${id}@x.com`, consent: consent || 'subscribed' })));

    it('sends to a live list\'s members with their app fields, skipping app unsubscribes', async () => {
      seed([]);
      live('app1', [['ann'], ['bob', 'unsubscribed']]);
      const res = await send({ include: ['app1'] });
      expect(recipients()).toEqual(['ann@x.com', 'bob@x.com']);
      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
        toEmail: 'ann@x.com', isSubscribed: true, appUser: { id: 'h-ann', fields: { plan: 'pro' } },
      }));
      expect(res).toMatchObject({ sentCount: 1, skippedCount: 1, done: true });
    });

    it('emails an address on a contact list and a live list once, by the first list', async () => {
      seed([['ann', ['c1']], ['cat', ['c1']]]);
      live('app1', [['ann'], ['dan']]);
      await send({ include: ['c1', 'app1'] });
      expect(recipients()).toEqual(['ann@x.com', 'cat@x.com', 'dan@x.com']);

      mockQueueEmail.mockClear();
      await send({ include: ['app1', 'c1'] });
      expect(recipients()).toEqual(['ann@x.com', 'cat@x.com', 'dan@x.com']);
    });

    it('excludes by live list and by contact list, across kinds', async () => {
      seed([['ann', ['c1']], ['cat', ['c1', 'blocked']]]);
      live('app1', [['cat'], ['dan']]);
      live('app-ex', [['ann']]);
      await send({ include: ['c1', 'app1'], exclude: ['app-ex', 'blocked'] });
      expect(recipients()).toEqual(['dan@x.com']);
    });

    it('counts what the send would deliver', async () => {
      seed([['ann', ['c1']], ['eve', ['c1'], 'unsubscribed']]);
      live('app1', [['ann'], ['dan'], ['fay', 'unsubscribed'], ['eve']]);
      // ann: once. dan: yes. fay: app-unsubscribed. eve: the contact's unsubscribe wins.
      expect((await countEligible({ include: ['c1', 'app1'] })).count).toBe(2);
    });

    it('resumes a live list after its last document', async () => {
      seed([]);
      live('app1', [['ann'], ['bob'], ['cat']]);
      await send({ include: ['app1'] }, '0|bob');
      expect(recipients()).toEqual(['cat@x.com']);
    });
  });
});

