/**
 * Tests for functions/src/dodo-payments/entitlements.ts
 *
 * Covers the Phase 1 correctness guards:
 *  - grant/revoke/markPastDue discard out-of-order (stale) webhook events
 *  - revoke/markPastDue only touch the subscription currently granting access
 *  - grant advances the stored event timestamp
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRunTransaction, FakeTimestamp } = vi.hoisted(() => {
  /** Minimal Timestamp stand-in with the surface the module relies on. */
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
  return { mockRunTransaction: vi.fn(), FakeTimestamp };
});

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: FakeTimestamp,
  FieldValue: { delete: () => '__DELETE__' },
}));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('../init', () => ({ db: { runTransaction: mockRunTransaction } }));

import { grantEntitlement, revokeEntitlement, markPastDue } from '../dodo-payments/entitlements.js';

const product = { premiumType: 'gold', tierRank: 2 } as any;

/** Wire db.runTransaction to a tx whose get() returns `current`; capture set(). */
function withCurrent(current: Record<string, unknown>) {
  const set = vi.fn();
  const tx = { get: vi.fn().mockResolvedValue({ data: () => current }), set };
  mockRunTransaction.mockImplementation(async (fn: any) => fn(tx));
  return { set };
}

const userRef = { id: 'userRef' } as any;

beforeEach(() => vi.clearAllMocks());

describe('grantEntitlement — ordering guard', () => {
  it('skips a stale event (older than the last applied one)', async () => {
    const { set } = withCurrent({ premiumEventAt: new FakeTimestamp(2000) });
    await grantEntitlement(userRef, product, { eventAt: new Date(1000) });
    expect(set).not.toHaveBeenCalled();
  });

  it('applies a newer event and advances premiumEventAt', async () => {
    const { set } = withCurrent({ premiumEventAt: new FakeTimestamp(1000) });
    await grantEntitlement(userRef, product, { eventAt: new Date(2000), subscriptionId: 'sub1' });
    expect(set).toHaveBeenCalledTimes(1);
    const written = set.mock.calls[0][1];
    expect(written).toMatchObject({ isPro: true, premiumType: 'gold', premiumTierRank: 2 });
    expect(written.premiumEventAt).toBeInstanceOf(FakeTimestamp);
    expect(written.premiumEventAt.ms).toBe(2000);
  });

  it('applies when no timestamp is available (guard is a no-op)', async () => {
    const { set } = withCurrent({});
    await grantEntitlement(userRef, product, {});
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][1].premiumEventAt).toBeUndefined();
  });
});

describe('revokeEntitlement — scoping + ordering', () => {
  it('leaves a different active subscription untouched', async () => {
    const { set } = withCurrent({ dodoSubscriptionId: 'subA' });
    await revokeEntitlement(userRef, 'subB', 'cancelled');
    expect(set).not.toHaveBeenCalled();
  });

  it('skips a stale revoke', async () => {
    const { set } = withCurrent({ dodoSubscriptionId: 'subA', premiumEventAt: new FakeTimestamp(5000) });
    await revokeEntitlement(userRef, 'subA', 'cancelled', new Date(1000));
    expect(set).not.toHaveBeenCalled();
  });

  it('revokes the matching subscription', async () => {
    const { set } = withCurrent({ dodoSubscriptionId: 'subA' });
    await revokeEntitlement(userRef, 'subA', 'expired', new Date(9000));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][1]).toMatchObject({ isPro: false, premiumStatus: 'expired', premiumType: null });
  });
});

describe('markPastDue — scoping + ordering', () => {
  it('ignores a failure for a subscription that is not the active one', async () => {
    const { set } = withCurrent({ dodoSubscriptionId: 'subA' });
    await markPastDue(userRef, 'subB');
    expect(set).not.toHaveBeenCalled();
  });

  it('marks past_due for the active subscription', async () => {
    const { set } = withCurrent({ dodoSubscriptionId: 'subA' });
    await markPastDue(userRef, 'subA', new Date(1000));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][1]).toMatchObject({ premiumStatus: 'past_due' });
  });

  it('skips a stale past_due event', async () => {
    const { set } = withCurrent({ dodoSubscriptionId: 'subA', premiumEventAt: new FakeTimestamp(8000) });
    await markPastDue(userRef, 'subA', new Date(1000));
    expect(set).not.toHaveBeenCalled();
  });
});
