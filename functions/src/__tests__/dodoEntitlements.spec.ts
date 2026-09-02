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

describe('grantEntitlement — grandfathering audit trail', () => {
    it('writes the locked-in tier label and discount code', async () => {
        const { set } = withCurrent({});
        await grantEntitlement(userRef, product, { subscriptionId: 's1', tierLabel: 'First 100', discountCode: 'EARLY' });
        expect(set.mock.calls[0][1]).toMatchObject({ premiumTierLabel: 'First 100', premiumDiscountCode: 'EARLY' });
    });

    it('preserves the original deal on a renewal whose metadata is missing', async () => {
        const { set } = withCurrent({ premiumTierLabel: 'First 100', premiumDiscountCode: 'EARLY' });
        await grantEntitlement(userRef, product, { subscriptionId: 's1' }); // no tierLabel/discountCode
        expect(set.mock.calls[0][1]).toMatchObject({ premiumTierLabel: 'First 100', premiumDiscountCode: 'EARLY' });
    });

    // Dodo round-trips absent checkout metadata as '' (see the renewal payload:
    // "tierLabel": "", "discountCode": ""), which `??` would happily write through.
    it('preserves the original deal when the event carries empty-string metadata', async () => {
        const { set } = withCurrent({ premiumTierLabel: 'First 100', premiumDiscountCode: 'EARLY' });
        await grantEntitlement(userRef, product, { subscriptionId: 's1', tierLabel: '', discountCode: '' });
        expect(set.mock.calls[0][1]).toMatchObject({ premiumTierLabel: 'First 100', premiumDiscountCode: 'EARLY' });
    });

    it('preserves a stored customer id when the event omits one', async () => {
        const { set } = withCurrent({ providerCustomerId: 'cus_1' });
        await grantEntitlement(userRef, product, { subscriptionId: 's1' });
        expect(set.mock.calls[0][1].providerCustomerId).toBe('cus_1');
    });
});

describe('grantEntitlement — premiumExpiresAt', () => {
    const sub = { premiumType: 'gold', tierRank: 2, type: 'subscription', interval: 'month' } as any;

    it('stores the gateway next_billing_date when the event carries one', async () => {
        const { set } = withCurrent({});
        await grantEntitlement(userRef, sub, { subscriptionId: 's1', nextBillingDate: '2026-09-03T10:12:33Z' });
        expect(set.mock.calls[0][1].premiumExpiresAt.ms).toBe(new Date('2026-09-03T10:12:33Z').getTime());
    });

    // The regression: a Payment-type payload has subscription_id but no
    // next_billing_date, and used to null out the date subscription.active just set.
    it('never nulls a still-valid expiry when the event carries no date', async () => {
        const future = new FakeTimestamp(new Date('2026-09-03T00:00:00Z').getTime());
        const { set } = withCurrent({ premiumExpiresAt: future });
        await grantEntitlement(userRef, sub, { subscriptionId: 's1', eventAt: new Date('2026-08-03T10:13:08Z') });
        expect('premiumExpiresAt' in set.mock.calls[0][1]).toBe(false);
    });

    it('derives the expiry from the billing interval on a first charge with no date', async () => {
        const { set } = withCurrent({});
        await grantEntitlement(userRef, sub, { subscriptionId: 's1', eventAt: new Date('2026-08-03T10:13:08Z') });
        expect(set.mock.calls[0][1].premiumExpiresAt.ms).toBe(new Date('2026-09-03T10:13:08Z').getTime());
    });

    it('advances a lapsed expiry on a renewal charge with no date', async () => {
        const lapsed = new FakeTimestamp(new Date('2026-08-03T00:00:00Z').getTime());
        const { set } = withCurrent({ premiumExpiresAt: lapsed });
        await grantEntitlement(userRef, sub, { subscriptionId: 's1', eventAt: new Date('2026-08-03T10:13:08Z') });
        expect(set.mock.calls[0][1].premiumExpiresAt.ms).toBe(new Date('2026-09-03T10:13:08Z').getTime());
    });

    it('uses trialDays for the first charge of a trialing subscription', async () => {
        const trial = { ...sub, trialDays: 14 };
        const { set } = withCurrent({});
        await grantEntitlement(userRef, trial, {
            subscriptionId: 's1', isTrial: true, eventAt: new Date('2026-08-03T00:00:00Z'),
        });
        expect(set.mock.calls[0][1].premiumExpiresAt.ms).toBe(new Date('2026-08-17T00:00:00Z').getTime());
    });

    it('derives a yearly period', async () => {
        const yearly = { ...sub, interval: 'year' };
        const { set } = withCurrent({});
        await grantEntitlement(userRef, yearly, { subscriptionId: 's1', eventAt: new Date('2026-08-03T00:00:00Z') });
        expect(set.mock.calls[0][1].premiumExpiresAt.ms).toBe(new Date('2027-08-03T00:00:00Z').getTime());
    });

    it('leaves the expiry alone when no date and no interval can be resolved', async () => {
        const noInterval = { premiumType: 'gold', tierRank: 2, type: 'subscription' } as any;
        const { set } = withCurrent({});
        await grantEntitlement(userRef, noInterval, { subscriptionId: 's1', eventAt: new Date(1000) });
        expect('premiumExpiresAt' in set.mock.calls[0][1]).toBe(false);
    });

    it('ignores an unparseable next_billing_date rather than storing Invalid Date', async () => {
        const { set } = withCurrent({});
        await grantEntitlement(userRef, sub, {
            subscriptionId: 's1', nextBillingDate: 'not-a-date', eventAt: new Date('2026-08-03T00:00:00Z'),
        });
        expect(set.mock.calls[0][1].premiumExpiresAt.ms).toBe(new Date('2026-09-03T00:00:00Z').getTime());
    });

    it('deletes the expiry for a one-time product so the sweep can never match it', async () => {
        const oneTime = { premiumType: 'gold', tierRank: 2, type: 'one_time' } as any;
        const { set } = withCurrent({});
        await grantEntitlement(userRef, oneTime, { eventAt: new Date(1000) });
        expect(set.mock.calls[0][1].premiumExpiresAt).toBe('__DELETE__');
    });

    it('treats a subscription id as authoritative when the product has no type', async () => {
        const untyped = { premiumType: 'gold', tierRank: 2, interval: 'month' } as any;
        const { set } = withCurrent({});
        await grantEntitlement(userRef, untyped, { subscriptionId: 's1', eventAt: new Date('2026-08-03T00:00:00Z') });
        expect(set.mock.calls[0][1].premiumExpiresAt.ms).toBe(new Date('2026-09-03T00:00:00Z').getTime());
    });
});

describe('grantEntitlement — updatesUntil (one-time free-updates window)', () => {
    const oneTime = { premiumType: 'gold', tierRank: 2, type: 'one_time', updatesYears: 2 } as any;

    it('sets updatesUntil = purchase date + updatesYears for a one-time product', async () => {
        const { set } = withCurrent({});
        await grantEntitlement(userRef, oneTime, { eventAt: new Date('2026-01-01T00:00:00Z') });
        const written = set.mock.calls[0][1];
        expect(written.updatesUntil).toBeInstanceOf(FakeTimestamp);
        expect(written.updatesUntil.ms).toBe(new Date('2028-01-01T00:00:00Z').getTime());
    });

    it('does not set updatesUntil for a subscription product', async () => {
        const { set } = withCurrent({});
        const sub = { premiumType: 'gold', tierRank: 2, type: 'subscription' } as any;
        await grantEntitlement(userRef, sub, { eventAt: new Date('2026-01-01T00:00:00Z'), subscriptionId: 's1' });
        expect('updatesUntil' in set.mock.calls[0][1]).toBe(false);
    });

    it('preserves an already-set updatesUntil (set once)', async () => {
        const { set } = withCurrent({ updatesUntil: new FakeTimestamp(999) });
        await grantEntitlement(userRef, oneTime, { eventAt: new Date('2026-01-01T00:00:00Z') });
        expect('updatesUntil' in set.mock.calls[0][1]).toBe(false);
    });

    it('sets updatesUntil null when the one-time product has no updates window', async () => {
        const { set } = withCurrent({});
        const noWindow = { premiumType: 'gold', tierRank: 2, type: 'one_time' } as any;
        await grantEntitlement(userRef, noWindow, { eventAt: new Date('2026-01-01T00:00:00Z') });
        expect(set.mock.calls[0][1].updatesUntil).toBeNull();
    });
});

describe('revokeEntitlement — scoping + ordering', () => {
  it('leaves a different active subscription untouched', async () => {
    const { set } = withCurrent({ providerSubscriptionId: 'subA' });
    await revokeEntitlement(userRef, 'subB', 'cancelled');
    expect(set).not.toHaveBeenCalled();
  });

  it('skips a stale revoke', async () => {
    const { set } = withCurrent({ providerSubscriptionId: 'subA', premiumEventAt: new FakeTimestamp(5000) });
    await revokeEntitlement(userRef, 'subA', 'cancelled', new Date(1000));
    expect(set).not.toHaveBeenCalled();
  });

  it('revokes the matching subscription', async () => {
    const { set } = withCurrent({ providerSubscriptionId: 'subA' });
    await revokeEntitlement(userRef, 'subA', 'expired', new Date(9000));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][1]).toMatchObject({ isPro: false, premiumStatus: 'expired', premiumType: null });
  });
});

describe('markPastDue — scoping + ordering', () => {
  it('ignores a failure for a subscription that is not the active one', async () => {
    const { set } = withCurrent({ providerSubscriptionId: 'subA' });
    await markPastDue(userRef, 'subB');
    expect(set).not.toHaveBeenCalled();
  });

  it('marks past_due for the active subscription', async () => {
    const { set } = withCurrent({ providerSubscriptionId: 'subA' });
    await markPastDue(userRef, 'subA', new Date(1000));
    expect(set).toHaveBeenCalledTimes(1);
    expect(set.mock.calls[0][1]).toMatchObject({ premiumStatus: 'past_due' });
  });

  it('skips a stale past_due event', async () => {
    const { set } = withCurrent({ providerSubscriptionId: 'subA', premiumEventAt: new FakeTimestamp(8000) });
    await markPastDue(userRef, 'subA', new Date(1000));
    expect(set).not.toHaveBeenCalled();
  });
});
