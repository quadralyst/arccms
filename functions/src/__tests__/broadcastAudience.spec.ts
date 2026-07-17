/**
 * Tests for the Phase 6 broadcast audience engine
 * (functions/src/email-log/broadcastAudience.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { contactsRef, mockQueueEmail, mockUsersGet } = vi.hoisted(() => ({
  contactsRef: { docs: [] as any[] },
  mockQueueEmail: vi.fn(),
  mockUsersGet: vi.fn(),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'Contacts') {
        const chain: any = {
          where: vi.fn(() => chain),
          orderBy: vi.fn(() => chain),
          limit: vi.fn(() => chain),
          startAfter: vi.fn(() => ({ ...chain, get: async () => ({ docs: [], size: 0 }) })), // page 2 empty
          get: async () => ({ docs: contactsRef.docs, size: contactsRef.docs.length }),
        };
        return chain;
      }
      if (name === 'users') return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockUsersGet }) }) };
      return {};
    }),
  },
}));

vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));
vi.mock('./broadcastHelper', () => ({ getDelayFromLimits: () => 0, sleep: () => Promise.resolve() }));
vi.mock('../email-core/contacts', () => ({ waitlistListId: (id: string) => `waitlist-${id}` }));
vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: vi.fn(() => ({ seconds: 0 })) },
  FieldPath: { documentId: vi.fn(() => '__id__') },
}));

import { countEligible, processAudienceChunk } from '../email-log/broadcastAudience.js';

function contact(id: string, over: any = {}) {
  return { id, data: () => ({ email: `${id}@x.com`, name: id, consent: { marketing: 'subscribed' }, sources: ['import'], ...over }) };
}

describe('broadcast audience', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockQueueEmail.mockResolvedValue({ id: 'log', status: 'pending' });
  });

  describe('countEligible', () => {
    it('excludes unsubscribed contacts', async () => {
      contactsRef.docs = [contact('a'), contact('b', { consent: { marketing: 'unsubscribed' } }), contact('c')];
      const res = await countEligible({ kind: 'list', listId: 'l1' });
      expect(res.count).toBe(2);
      expect(res.scanned).toBe(3);
    });

    it('excludes pending contacts — the preview must not promise reach the send cannot deliver (U2)', async () => {
      // A pending member has not confirmed their address, so queueEmail skips
      // them. Counting them here would overstate the audience.
      contactsRef.docs = [contact('a'), contact('b', { consent: { marketing: 'pending' } }), contact('c')];

      const res = await countEligible({ kind: 'list', listId: 'l1' });

      expect(res.count).toBe(2);
      expect(res.scanned).toBe(3);
    });

    it('excludes legacy contacts carrying no consent object', async () => {
      // getContactConsent reports these as 'pending', so queueEmail skips them.
      contactsRef.docs = [contact('a'), contact('b', { consent: undefined })];

      const res = await countEligible({ kind: 'list', listId: 'l1' });

      expect(res.count).toBe(1);
    });

    it('applies the source filter', async () => {
      contactsRef.docs = [contact('a', { sources: ['import'] }), contact('b', { sources: ['signup'] })];
      const res = await countEligible({ kind: 'list', listId: 'l1', filters: [{ field: 'source', op: '==', value: 'signup' }] });
      expect(res.count).toBe(1);
    });

    it('applies the premiumType filter via user lookup', async () => {
      contactsRef.docs = [contact('a', { userId: 'u1' }), contact('b', { userId: 'u2' })];
      mockUsersGet.mockImplementation(async () => ({ empty: false, docs: [{ data: () => ({ premiumType: 'pro' }) }] }));
      // Only u1 is pro:
      mockUsersGet
        .mockResolvedValueOnce({ empty: false, docs: [{ data: () => ({ premiumType: 'pro' }) }] })
        .mockResolvedValueOnce({ empty: false, docs: [{ data: () => ({ premiumType: 'free' }) }] });
      const res = await countEligible({ kind: 'list', listId: 'l1', filters: [{ field: 'premiumType', op: '==', value: 'pro' }] });
      expect(res.count).toBe(1);
    });
  });

  describe('processAudienceChunk', () => {
    const broadcastData: any = {
      audience: { kind: 'list', listId: 'l1' },
      senderEmail: 's@x.com', senderName: 'S', subject: 'Hi', template: 'body', previewText: '',
    };

    it('queues each contact via queueEmail; consent skips are counted', async () => {
      contactsRef.docs = [contact('a'), contact('b'), contact('c')];
      // queueEmail decides consent: 'b' comes back skipped.
      mockQueueEmail.mockImplementation(async (p: any) =>
        p.toEmail === 'b@x.com' ? { id: 'l', status: 'skipped', skipReason: 'unsubscribed' } : { id: 'l', status: 'pending' },
      );

      const res = await processAudienceChunk({
        broadcastData, broadcastId: 'bc1', providerLimits: { perSecond: 100 },
        timeBudgetMs: 100000, initialSent: 0, initialSkipped: 0, initialFailed: 0,
      });

      expect(res.done).toBe(true);
      expect(res.sentCount).toBe(2);
      expect(res.skippedCount).toBe(1);
      expect(res.failedCount).toBe(0);
      expect(mockQueueEmail).toHaveBeenCalledTimes(3);
      expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({ source: 'broadcast', category: 'marketing' }));
    });

    it('counts a thrown queueEmail as failed', async () => {
      contactsRef.docs = [contact('a')];
      mockQueueEmail.mockRejectedValue(new Error('boom'));
      const res = await processAudienceChunk({
        broadcastData, broadcastId: 'bc1', providerLimits: { perSecond: 100 },
        timeBudgetMs: 100000, initialSent: 0, initialSkipped: 0, initialFailed: 0,
      });
      expect(res.failedCount).toBe(1);
    });
  });
});
