/**
 * Tests for functions/src/dodo-payments/scanTrialEndings.ts
 *
 * Covers the reminder guards (already sent / already ended / no real trial-end
 * date) and the paging that keeps the scan bounded as the user base grows.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockStartAfter, mockSendEmail, FakeTimestamp } = vi.hoisted(() => {
  class FakeTimestamp {
    constructor(public ms: number) {}
    toDate() {
      return new Date(this.ms);
    }
    static fromDate(d: Date) {
      return new FakeTimestamp(d.getTime());
    }
    static now() {
      return new FakeTimestamp(0);
    }
  }
  return { mockGet: vi.fn(), mockStartAfter: vi.fn(), mockSendEmail: vi.fn(), FakeTimestamp };
});

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: (_opts: unknown, handler: unknown) => handler,
}));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: FakeTimestamp, QueryDocumentSnapshot: class {} }));
vi.mock('../dodo-payments/paymentEmailHelper', () => ({ sendPaymentEmail: mockSendEmail }));

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

vi.mock('../init', () => ({ db: { collection: () => query } }));

import { scanTrialEndings } from '../dodo-payments/scanTrialEndings.js';

let docCounter = 0;
function userDoc(data: Record<string, unknown>) {
  const id = `u${++docCounter}`;
  return { id, data: () => data, ref: { update: vi.fn() } };
}

function page(docs: unknown[]) {
  return { docs, empty: docs.length === 0, size: docs.length };
}

/** Days from now as the fake Timestamp the scan reads. */
function inDays(days: number) {
  return new FakeTimestamp(Date.now() + days * 24 * 60 * 60 * 1000);
}

function trialing(extra: Record<string, unknown> = {}) {
  return userDoc({
    premiumStatus: 'trialing',
    premiumExpiresAt: inDays(2),
    email: 'a@b.com',
    name: 'Ada',
    premiumType: 'gold',
    ...extra,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  docCounter = 0;
  mockGet.mockResolvedValue(page([]));
  mockSendEmail.mockResolvedValue(undefined);
});

describe('scanTrialEndings', () => {
  it('emails a user whose trial ends inside the window and marks them reminded', async () => {
    const user = trialing();
    mockGet.mockResolvedValueOnce(page([user]));

    await (scanTrialEndings as any)();

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toBe('trial_ending_email');
    expect(mockSendEmail.mock.calls[0][2]).toMatchObject({ plan: 'gold' });
    expect(user.ref.update).toHaveBeenCalledWith({ premiumTrialReminderSent: true });
  });

  it('passes a per-user dedupe key so a crash before the flag cannot re-remind', async () => {
    const user = trialing();
    mockGet.mockResolvedValueOnce(page([user]));

    await (scanTrialEndings as any)();

    expect(mockSendEmail.mock.calls[0][3]).toBe(`trial:${user.id}`);
  });

  it('skips a user already reminded', async () => {
    mockGet.mockResolvedValueOnce(page([trialing({ premiumTrialReminderSent: true })]));

    await (scanTrialEndings as any)();

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('skips a trial that has already ended', async () => {
    mockGet.mockResolvedValueOnce(page([trialing({ premiumExpiresAt: inDays(-1) })]));

    await (scanTrialEndings as any)();

    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  // Null sorts below every type in Firestore, so a null expiry matches the range
  // filter. Reminding on that would send a trial notice with a blank date.
  it('skips a user whose expiry is null rather than a date', async () => {
    const user = trialing({ premiumExpiresAt: null });
    mockGet.mockResolvedValueOnce(page([user]));

    await (scanTrialEndings as any)();

    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(user.ref.update).not.toHaveBeenCalled();
  });
});

describe('scanTrialEndings — paging', () => {
  it('follows the cursor past a full page', async () => {
    // Reminded users still match the filter (the flag is not part of the query),
    // so only the cursor stops this run from revisiting them.
    const first = page(Array.from({ length: 200 }, () => trialing()));
    mockGet.mockResolvedValueOnce(first).mockResolvedValueOnce(page([]));

    await (scanTrialEndings as any)();

    expect(mockStartAfter).toHaveBeenCalledWith(first.docs[199]);
    expect(mockSendEmail).toHaveBeenCalledTimes(200);
  });

  it('stops after a short page without asking for another', async () => {
    mockGet.mockResolvedValueOnce(page([trialing()]));

    await (scanTrialEndings as any)();

    expect(mockStartAfter).not.toHaveBeenCalled();
    expect(mockGet).toHaveBeenCalledTimes(1);
  });
});
