/**
 * Tests for functions/src/dodo-payments/scanExpiredEntitlements.ts
 *
 * The daily safety net force-expires subscriptions past their grace window while
 * leaving lifetime (one-time) grants — which have no providerSubscriptionId — alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, FakeTimestamp } = vi.hoisted(() => {
  class FakeTimestamp {
    constructor(public ms: number) {}
    static fromDate(d: Date) {
      return new FakeTimestamp(d.getTime());
    }
    static now() {
      return new FakeTimestamp(0);
    }
  }
  return { mockGet: vi.fn(), FakeTimestamp };
});

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: FakeTimestamp }));

vi.mock('../init', () => ({
  db: {
    collection: () => ({
      where: () => ({ where: () => ({ get: mockGet }) }),
    }),
  },
}));

import { scanExpiredEntitlements } from '../dodo-payments/scanExpiredEntitlements.js';

function userDoc(data: Record<string, unknown>) {
  return { data: () => data, ref: { set: vi.fn() } };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGet.mockResolvedValue({ docs: [] });
});

describe('scanExpiredEntitlements', () => {
  it('force-expires a subscription past the grace window', async () => {
    const sub = userDoc({ providerSubscriptionId: 'sub1', premiumStatus: 'active' });
    mockGet.mockResolvedValueOnce({ docs: [sub] }); // first status query returns it

    await (scanExpiredEntitlements as any)();

    expect(sub.ref.set).toHaveBeenCalledTimes(1);
    expect(sub.ref.set.mock.calls[0][0]).toMatchObject({
      isPro: false,
      premiumStatus: 'expired',
      premiumType: null,
      premiumTierRank: null,
    });
  });

  it('leaves a lifetime (one-time) grant untouched — no subscription id', async () => {
    const lifetime = userDoc({ premiumStatus: 'active', isPro: true }); // no providerSubscriptionId
    mockGet.mockResolvedValueOnce({ docs: [lifetime] });

    await (scanExpiredEntitlements as any)();

    expect(lifetime.ref.set).not.toHaveBeenCalled();
  });

  it('queries all three active statuses', async () => {
    await (scanExpiredEntitlements as any)();
    // active + trialing + past_due
    expect(mockGet).toHaveBeenCalledTimes(3);
  });
});
