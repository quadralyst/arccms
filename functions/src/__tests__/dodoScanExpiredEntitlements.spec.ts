/**
 * Tests for functions/src/dodo-payments/scanExpiredEntitlements.ts
 *
 * The daily safety net force-expires subscriptions past their grace window while
 * leaving lifetime (one-time) grants — which have no providerSubscriptionId — alone.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockStartAfter, mockBatchSet, mockBatchCommit, FakeTimestamp } = vi.hoisted(() => {
  class FakeTimestamp {
    constructor(public ms: number) {}
    static fromDate(d: Date) {
      return new FakeTimestamp(d.getTime());
    }
    static now() {
      return new FakeTimestamp(0);
    }
  }
  return {
    mockGet: vi.fn(),
    mockStartAfter: vi.fn(),
    mockBatchSet: vi.fn(),
    mockBatchCommit: vi.fn(),
    FakeTimestamp,
  };
});

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: FakeTimestamp, QueryDocumentSnapshot: class {} }));

/** Chainable query stub — every builder call returns itself; get() is the mock. */
const query: any = {
  where: () => query,
  orderBy: () => query,
  limit: () => query,
  startAfter: (...args: unknown[]) => {
    mockStartAfter(...args);
    return query;
  },
  get: (...args: unknown[]) => mockGet(...args),
};

vi.mock('../init', () => ({
  db: {
    collection: () => query,
    batch: () => ({ set: mockBatchSet, commit: mockBatchCommit }),
  },
}));

import { scanExpiredEntitlements } from '../dodo-payments/scanExpiredEntitlements.js';

let docCounter = 0;
function userDoc(data: Record<string, unknown>) {
  const id = `u${++docCounter}`;
  return { id, data: () => data, ref: { id, path: `users/${id}` } };
}

/** A page smaller than PAGE_SIZE, which ends the paging loop. */
function page(docs: unknown[]) {
  return { docs, empty: docs.length === 0, size: docs.length };
}

/** A long-lapsed expiry — the query is mocked, so only the type/value matters here. */
const lapsed = new FakeTimestamp(new Date('2020-01-01T00:00:00Z').getTime());

/** Refs passed to batch.set() during the run. */
function batchedRefs() {
  return mockBatchSet.mock.calls.map((c) => c[0]);
}

beforeEach(() => {
  vi.clearAllMocks();
  docCounter = 0;
  mockGet.mockResolvedValue(page([]));
  mockBatchCommit.mockResolvedValue(undefined);
});

describe('scanExpiredEntitlements', () => {
  it('force-expires a subscription past the grace window', async () => {
    const sub = userDoc({ providerSubscriptionId: 'sub1', premiumStatus: 'active', premiumExpiresAt: lapsed });
    mockGet.mockResolvedValueOnce(page([sub])); // first status query returns it

    await (scanExpiredEntitlements as any)();

    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    expect(mockBatchSet.mock.calls[0][0]).toBe(sub.ref);
    expect(mockBatchSet.mock.calls[0][1]).toMatchObject({
      isPro: false,
      premiumStatus: 'expired',
      premiumType: null,
      premiumTierRank: null,
    });
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('leaves a lifetime (one-time) grant untouched — no subscription id', async () => {
    const lifetime = userDoc({ premiumStatus: 'active', isPro: true }); // no providerSubscriptionId
    mockGet.mockResolvedValueOnce(page([lifetime]));

    await (scanExpiredEntitlements as any)();

    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  // Firestore sorts null below every other type, so `premiumExpiresAt <= cutoff`
  // matches a null. Revoking on that would cut off a paying subscriber.
  it('never revokes a subscriber whose expiry is null rather than a date', async () => {
    const nulled = userDoc({ providerSubscriptionId: 'sub1', premiumStatus: 'active', premiumExpiresAt: null });
    mockGet.mockResolvedValueOnce(page([nulled]));

    await (scanExpiredEntitlements as any)();

    expect(mockBatchSet).not.toHaveBeenCalled();
  });

  it('commits nothing when a page yields no eligible users', async () => {
    mockGet.mockResolvedValueOnce(page([userDoc({ premiumStatus: 'active' })]));

    await (scanExpiredEntitlements as any)();

    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('queries all three active statuses', async () => {
    await (scanExpiredEntitlements as any)();
    // active + trialing + past_due
    expect(mockGet).toHaveBeenCalledTimes(3);
  });
});

describe('scanExpiredEntitlements — paging', () => {
  /** A full page (PAGE_SIZE = 200), which makes the loop fetch another. */
  function fullPage() {
    return page(
      Array.from({ length: 200 }, () =>
        userDoc({ providerSubscriptionId: 'sub1', premiumStatus: 'active', premiumExpiresAt: lapsed }),
      ),
    );
  }

  // Previously a single unbounded .get() loaded every matching user into memory
  // and wrote them one await at a time.
  it('follows the cursor past a full page instead of stopping at one query', async () => {
    const first = fullPage();
    mockGet.mockResolvedValueOnce(first).mockResolvedValueOnce(page([]));

    await (scanExpiredEntitlements as any)();

    // Continues from the last doc of the full page...
    expect(mockStartAfter).toHaveBeenCalledWith(first.docs[199]);
    // ...and each page commits as one batch rather than 200 separate writes.
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
    expect(batchedRefs()).toHaveLength(200);
  });

  it('stops after a short page without asking for another', async () => {
    mockGet.mockResolvedValueOnce(
      page([userDoc({ providerSubscriptionId: 'sub1', premiumStatus: 'active', premiumExpiresAt: lapsed })]),
    );

    await (scanExpiredEntitlements as any)();

    expect(mockStartAfter).not.toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledTimes(3); // one short page per status
  });
});
