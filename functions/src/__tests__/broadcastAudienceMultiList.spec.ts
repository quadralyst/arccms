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
  store: { contacts: new Map<string, { lists: string[]; consent: string }>() },
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

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'Contacts') return contactsQuery();
      if (name === 'users') {
        return { where: () => ({ limit: () => ({ get: async () => ({ empty: true, docs: [] }) }) }) };
      }
      return {};
    }),
  },
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
      const subscribed = store.contacts.get(id)?.consent === 'subscribed';
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
});
