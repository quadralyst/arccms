/**
 * Tests for functions/src/dodo-payments/handlePaymentEvent.ts
 *
 * Covers: success increments the product counter once + records a transaction +
 * grants entitlement + sends the success email; duplicate payment is a no-op;
 * subscription renewals do NOT increment the buyer counter; cancellation revokes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockTxnGet,
  mockTxnAdd,
  mockProductGet,
  mockProductUpdate,
  mockCountedCreate,
  mockFindUserRef,
  mockGrant,
  mockRevoke,
  mockMarkPastDue,
  mockSendEmail,
  mockGrantCredits,
  mockRefundCredits,
  mockRefundableAmount,
  mockTestCheckoutGet,
  mockPaymentRetrieve,
  mockCurrent,
  mockChargeGet,
  mockProductsByField,
  mockNotifyAdmins,
} = vi.hoisted(() => ({
  mockTxnGet: vi.fn(),
  mockTxnAdd: vi.fn(),
  mockProductGet: vi.fn(),
  mockProductUpdate: vi.fn(),
  mockCountedCreate: vi.fn(),
  mockFindUserRef: vi.fn(),
  mockGrant: vi.fn(),
  mockRevoke: vi.fn(),
  mockMarkPastDue: vi.fn(),
  mockSendEmail: vi.fn(),
  mockGrantCredits: vi.fn(),
  mockRefundCredits: vi.fn(),
  mockRefundableAmount: vi.fn(),
  mockTestCheckoutGet: vi.fn(),
  mockPaymentRetrieve: vi.fn(),
  mockCurrent: vi.fn(),
  mockChargeGet: vi.fn(),
  mockProductsByField: vi.fn(),
  mockNotifyAdmins: vi.fn(),
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (_path: string, handler: unknown) => handler,
}));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'Transactions') {
        // The idempotency check asks by key; a refund asks for the charge it reverses.
        const query = (field: string) => {
          const chain: any = { where: () => chain, limit: () => chain, get: field === 'idempotencyKey' ? mockTxnGet : mockChargeGet };
          return chain;
        };
        return { where: (field: string) => query(field), add: mockTxnAdd };
      }
      if (name === 'Products') {
        return {
          doc: () => ({ get: mockProductGet, update: mockProductUpdate }),
          where: (field: string, _op: string, value: string) => ({ limit: () => ({ get: () => mockProductsByField(field, value) }) }),
        };
      }
      if (name === 'CountedBuyers') {
        return { doc: () => ({ create: mockCountedCreate }) };
      }
      if (name === 'TestCheckouts') {
        return { doc: () => ({ get: mockTestCheckoutGet, set: vi.fn().mockResolvedValue(undefined) }) };
      }
      return { doc: vi.fn() };
    }),
  },
}));

vi.mock('../dodo-payments/entitlements', () => ({
  findUserRef: mockFindUserRef,
  grantEntitlement: mockGrant,
  revokeEntitlement: mockRevoke,
  markPastDue: mockMarkPastDue,
  currentEntitlement: mockCurrent,
}));

vi.mock('../email-core/adminAlerts', () => ({ notifyAdmins: mockNotifyAdmins }));

vi.mock('../dodo-payments/credits', () => ({
  grantCredits: mockGrantCredits,
  refundCredits: mockRefundCredits,
  refundableCreditAmount: mockRefundableAmount,
}));

vi.mock('../dodo-payments/paymentEmailHelper', () => ({ sendPaymentEmail: mockSendEmail }));
vi.mock('../dodo-payments/dodoClient', () => ({
  getDodoClient: async () => ({ client: { payments: { retrieve: mockPaymentRetrieve } }, settings: {} }),
}));

import { handlePaymentEvent } from '../dodo-payments/handlePaymentEvent.js';

const product = { id: 'p1', type: 'one_time', premiumType: 'gold', tierRank: 2, purchaseCount: 5, providerProductIds: { dodo: 'prod_p1' } };
/** What the gateway says was bought: the product of p1, for a payment and for a subscription. */
const PAID = { product_cart: [{ product_id: 'prod_p1', quantity: 1 }], product_id: 'prod_p1' };

function makeEvent(payload: unknown) {
  const update = vi.fn();
  // get() backs the retry path's read-back of processingAttempts; without it a
  // failure inside processEvent would surface as a confusing "not a function".
  const get = vi.fn().mockResolvedValue({ data: () => ({}) });
  return {
    event: { params: { eventId: 'e1' }, data: { data: () => ({ rawPayload: payload }), ref: { update, get } } },
    update,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTxnGet.mockResolvedValue({ empty: true }); // no existing transaction
  mockTxnAdd.mockResolvedValue({ id: 't1' });
  mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => product });
  mockProductUpdate.mockResolvedValue(undefined);
  mockCountedCreate.mockResolvedValue(undefined); // buyer not yet counted
  mockFindUserRef.mockResolvedValue({ id: 'userRef' });
  mockGrant.mockResolvedValue(undefined);
  mockRevoke.mockResolvedValue(undefined);
  mockSendEmail.mockResolvedValue(undefined);
  mockGrantCredits.mockResolvedValue({ applied: 0, balance: 0 });
  mockRefundCredits.mockResolvedValue({ applied: 0, balance: 0 });
  // Default: no ledger history, so the product's allowance is the clawback figure.
  mockRefundableAmount.mockImplementation(async (o: { fallback: number }) => o.fallback);
  mockTestCheckoutGet.mockResolvedValue({ exists: false, data: () => undefined });
  mockPaymentRetrieve.mockResolvedValue({ product_cart: null });
  mockCurrent.mockResolvedValue({});
  mockChargeGet.mockResolvedValue({ empty: true, docs: [] });
  mockProductsByField.mockResolvedValue({ docs: [] });
  mockNotifyAdmins.mockResolvedValue(undefined);
});

/** The `payment.succeeded` Transaction a refund finds for the charge it reverses. */
function chargeOf(fields: Record<string, unknown>) {
  const charge = { userId: 'u1', premiumType: 'gold', eventType: 'payment.succeeded', ...fields };
  mockChargeGet.mockResolvedValue({ empty: false, docs: [{ data: () => charge }] });
}

describe('handlePaymentEvent', () => {
  it('payment.succeeded records txn, increments counter once, grants, emails', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'pay1', total_amount: 4999, currency: 'USD', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    const { event, update } = makeEvent(payload);
    await (handlePaymentEvent as any)(event);

    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockTxnAdd.mock.calls[0][0]).toMatchObject({ status: 'succeeded', amount: 49.99, currency: 'USD', userId: 'u1', provider: 'dodo', providerPaymentId: 'pay1' });
    expect(mockProductUpdate).toHaveBeenCalledTimes(1); // counter incremented
    expect(mockGrant).toHaveBeenCalledTimes(1);
    // 4th arg is the dedupe key that makes the enqueue idempotent under retry.
    expect(mockSendEmail).toHaveBeenCalledWith(
      'payment_succeeded_email', expect.anything(), expect.anything(), expect.any(String),
    );
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ processed: true }));
  });

  it('duplicate delivery is a no-op (no double txn / no increment / no second email)', async () => {
    mockTxnGet.mockResolvedValue({ empty: false }); // existing transaction found
    mockCountedCreate.mockRejectedValue(new Error('ALREADY_EXISTS')); // buyer already counted
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'pay1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  // The trigger now retries, and a retry can land after the Transaction was
  // already written. Buyer counting must not be gated on that — CountedBuyers is
  // the guard — or the purchase count is silently lost.
  it('a retry after the txn was written still counts the buyer', async () => {
    mockTxnGet.mockResolvedValue({ empty: false }); // txn survived the failed attempt
    const payload = {
      type: 'subscription.active',
      data: { subscription_id: 'sub1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockCountedCreate).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).toHaveBeenCalledTimes(1);
  });

  it('subscription.renewed records a txn but does NOT increment the buyer counter', async () => {
    const payload = {
      type: 'subscription.renewed',
      data: { payment_id: 'pay2', subscription_id: 'sub1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).not.toHaveBeenCalled(); // renewals don't add buyers
  });

  it('subscription.active increments the buyer counter once (keyed on subscription)', async () => {
    const payload = {
      type: 'subscription.active',
      data: { subscription_id: 'sub1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockCountedCreate).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).toHaveBeenCalledTimes(1);
  });

  it('recurring payment.succeeded carrying a subscription_id does NOT add a buyer', async () => {
    // A renewal charge arrives as payment.succeeded WITH a subscription id — must not count.
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payR', subscription_id: 'sub1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).toHaveBeenCalledTimes(1); // still recorded
    expect(mockCountedCreate).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it('an already-counted buyer (marker exists) does not double-increment', async () => {
    mockCountedCreate.mockRejectedValue(new Error('ALREADY_EXISTS')); // marker already present
    const payload = {
      type: 'subscription.active',
      data: { subscription_id: 'sub1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockCountedCreate).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).not.toHaveBeenCalled(); // create failed → no increment
  });

  it('subscription.active with no payment_id still dedups (transaction idempotencyKey)', async () => {
    mockTxnGet.mockResolvedValue({ empty: false }); // same activation already recorded
    mockCountedCreate.mockRejectedValue(new Error('ALREADY_EXISTS'));
    const payload = {
      type: 'subscription.active',
      data: { subscription_id: 'sub1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it('records the discount code and passes the locked-in deal to grantEntitlement', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: {
        payment_id: 'payD',
        total_amount: 1500,
        currency: 'USD',
        ...PAID, metadata: { productId: 'p1', userId: 'u1', tierLabel: 'First 100', discountCode: 'EARLY' },
        customer: { email: 'a@b.com' },
      },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd.mock.calls[0][0]).toMatchObject({ tierApplied: 'First 100', discountCode: 'EARLY' });
    const opts = mockGrant.mock.calls[0][2];
    expect(opts).toMatchObject({ tierLabel: 'First 100', discountCode: 'EARLY' });
  });

  it('passes the payload timestamp through to grantEntitlement for ordering', async () => {
    const payload = {
      type: 'payment.succeeded',
      timestamp: '2026-01-01T00:00:00.000Z',
      data: { payment_id: 'pay9', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockGrant).toHaveBeenCalledTimes(1);
    const opts = mockGrant.mock.calls[0][2];
    expect(opts.eventAt).toBeInstanceOf(Date);
    expect(opts.eventAt.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('grants credits on a one-time purchase of a credit product', async () => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => ({ ...product, creditsGranted: 100 }) });
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payC', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockGrantCredits).toHaveBeenCalledTimes(1);
    expect(mockGrantCredits.mock.calls[0]).toMatchObject([
      { id: 'userRef' },
      'u1',
      100,
      { ledgerId: 'grant:pay:payC', reason: 'purchase', productId: 'p1' },
    ]);
  });

  it('grants a renewal allowance on subscription.renewed (reason: renewal)', async () => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => ({ ...product, type: 'subscription', creditsGranted: 50 }) });
    const payload = {
      type: 'subscription.renewed',
      data: { subscription_id: 'sub1', next_billing_date: '2026-09-10', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockGrantCredits).toHaveBeenCalledTimes(1);
    expect(mockGrantCredits.mock.calls[0][2]).toBe(50);
    expect(mockGrantCredits.mock.calls[0][3]).toMatchObject({ ledgerId: 'grant:sub:sub1:renew:2026-09-10', reason: 'renewal' });
  });

  it('does NOT grant credits for a non-credit product', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payX', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it('claws back credits on a FULL refund of a credit product', async () => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => ({ ...product, creditsGranted: 100 }) });
    chargeOf({ providerPaymentId: 'payR' });
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', premiumType: 'gold', premiumPaymentId: 'payR' });
    const payload = {
      type: 'refund.succeeded',
      data: { payment_id: 'payR', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockRefundCredits).toHaveBeenCalledTimes(1);
    expect(mockRefundCredits.mock.calls[0]).toMatchObject([{ id: 'userRef' }, 'u1', 100, { ledgerId: 'refund:payR' }]);
    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });

  it('a PARTIAL refund records a txn but does NOT revoke access or claw back credits', async () => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => ({ ...product, creditsGranted: 100 }) });
    const payload = {
      type: 'refund.succeeded',
      data: { payment_id: 'payP', is_partial: true, amount: 500, currency: 'USD', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockTxnAdd.mock.calls[0][0]).toMatchObject({ status: 'refunded', amount: 5 }); // 500 minor units → 5.00
    expect(mockRefundCredits).not.toHaveBeenCalled();
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('subscription.cancelled revokes the entitlement', async () => {
    const payload = {
      type: 'subscription.cancelled',
      data: { subscription_id: 'sub1', metadata: { userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockRevoke).toHaveBeenCalledWith({ id: 'userRef' }, 'sub1', 'cancelled', undefined);
    expect(mockSendEmail).toHaveBeenCalledWith(
      'subscription_lifecycle_email', expect.anything(), { status: 'cancelled' }, expect.any(String),
    );
  });
});

/** The Transaction written by the last recordTransaction() call. */
function lastTxn() {
  return mockTxnAdd.mock.calls[mockTxnAdd.mock.calls.length - 1][0];
}

describe('handlePaymentEvent — idempotency keys', () => {
  // A refund payload repeats the ORIGINAL payment_id. Keying on that alone made
  // the refund collide with the charge it reverses, so it was never recorded.
  it('keys a refund on its own refund_id, not the original payment id', async () => {
    const payload = {
      type: 'refund.succeeded',
      data: {
        refund_id: 'ref_1', payment_id: 'pay1', amount: 500, currency: 'USD',
        ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' },
      },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(lastTxn().idempotencyKey).toBe('ref:ref_1:refund.succeeded');
  });

  it('scopes a payment key by event type so a refund can never collide with its charge', async () => {
    const data = { payment_id: 'pay1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } };
    await (handlePaymentEvent as any)(makeEvent({ type: 'payment.succeeded', data }).event);
    const chargeKey = lastTxn().idempotencyKey;

    // Same payment id, refund event, no refund_id — must still be a distinct key.
    await (handlePaymentEvent as any)(makeEvent({ type: 'refund.succeeded', data }).event);

    expect(chargeKey).toBe('pay:pay1:payment.succeeded');
    expect(lastTxn().idempotencyKey).toBe('pay:pay1:refund.succeeded');
    expect(mockTxnAdd).toHaveBeenCalledTimes(2);
  });

  // Without a period component every renewal collapsed onto one key, so only the
  // first renewal of a subscription was ever recorded.
  it('distinguishes renewals that carry no billing date, using the event timestamp', async () => {
    const data = { subscription_id: 'sub1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } };
    await (handlePaymentEvent as any)(makeEvent({ type: 'subscription.renewed', timestamp: '2026-08-03T10:13:08Z', data }).event);
    const first = lastTxn().idempotencyKey;
    await (handlePaymentEvent as any)(makeEvent({ type: 'subscription.renewed', timestamp: '2026-09-03T10:13:08Z', data }).event);

    expect(first).not.toBe(lastTxn().idempotencyKey);
  });

  it('prefers the billing period over the event timestamp when the payload has one', async () => {
    const payload = {
      type: 'subscription.renewed',
      timestamp: '2026-08-03T10:13:08Z',
      data: {
        subscription_id: 'sub1', next_billing_date: '2026-09-03',
        ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' },
      },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(lastTxn().idempotencyKey).toBe('sub:sub1:subscription.renewed:2026-09-03');
  });

  it('records a refund at the refunded amount, not the original charge', async () => {
    const payload = {
      type: 'refund.succeeded',
      data: {
        refund_id: 'ref_2', payment_id: 'pay1', amount: 500, total_amount: 4999, currency: 'USD',
        ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' },
      },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(lastTxn()).toMatchObject({ status: 'refunded', amount: 5 });
  });
});

describe('handlePaymentEvent — one receipt per charge', () => {
  const subData = {
    subscription_id: 'sub1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' },
  };

  // Dodo emits BOTH events for a single charge; emailing on each sent two receipts.
  it('does not send a receipt for subscription.active', async () => {
    await (handlePaymentEvent as any)(makeEvent({ type: 'subscription.active', data: subData }).event);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('does not send a receipt for subscription.renewed', async () => {
    await (handlePaymentEvent as any)(makeEvent({ type: 'subscription.renewed', data: subData }).event);
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('sends exactly one receipt for the payment event that moved the money', async () => {
    const data = { ...subData, payment_id: 'pay1', total_amount: 4999, currency: 'USD' };
    await (handlePaymentEvent as any)(makeEvent({ type: 'payment.succeeded', data }).event);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toBe('payment_succeeded_email');
  });

  // A trial start has no charge, so no payment event covers it.
  it('announces a trial start on subscription.active instead of a receipt', async () => {
    const data = { ...subData, trial_period_days: 14 };
    await (handlePaymentEvent as any)(makeEvent({ type: 'subscription.active', data }).event);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toBe('subscription_lifecycle_email');
    expect(mockSendEmail.mock.calls[0][2]).toMatchObject({ status: 'trialing' });
  });

  it('sends a dunning notice — not a second failure receipt — on subscription.failed', async () => {
    await (handlePaymentEvent as any)(makeEvent({ type: 'subscription.failed', data: subData }).event);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toBe('subscription_lifecycle_email');
    expect(mockSendEmail.mock.calls[0][2]).toMatchObject({ status: 'past_due' });
    expect(mockMarkPastDue).toHaveBeenCalledTimes(1);
  });

  it('sends the failure receipt on payment.failed', async () => {
    const data = { payment_id: 'payF', total_amount: 4999, currency: 'USD', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } };
    await (handlePaymentEvent as any)(makeEvent({ type: 'payment.failed', data }).event);

    expect(mockSendEmail).toHaveBeenCalledTimes(1);
    expect(mockSendEmail.mock.calls[0][0]).toBe('payment_failed_email');
  });
});

describe('handlePaymentEvent — retry semantics', () => {
  const payload = {
    type: 'payment.succeeded',
    data: { payment_id: 'pay1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
  };

  /** An event doc whose stored attempt count can be varied per test. */
  function failingEvent(priorAttempts: number) {
    const update = vi.fn();
    const ref = {
      update,
      get: vi.fn().mockResolvedValue({ data: () => ({ processingAttempts: priorAttempts }) }),
    };
    return { event: { params: { eventId: 'e1' }, data: { data: () => ({ rawPayload: payload }), ref } }, update };
  }

  beforeEach(() => {
    mockGrant.mockRejectedValue(new Error('firestore unavailable'));
  });

  // Swallowing the error made the trigger a no-retry black hole: a customer was
  // charged, the grant failed, and nothing ever ran again.
  it('rethrows so the platform retries, recording the attempt', async () => {
    const { event, update } = failingEvent(0);

    await expect((handlePaymentEvent as any)(event)).rejects.toThrow('firestore unavailable');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ processed: false, processingAttempts: 1, processingError: 'firestore unavailable' }),
    );
  });

  it('gives up after the attempt cap and flags the event for manual replay', async () => {
    const { event, update } = failingEvent(4); // this run is attempt 5

    await expect((handlePaymentEvent as any)(event)).resolves.toBeUndefined();
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ processingAttempts: 5, processingFailedPermanently: true }),
    );
  });

  it('reads the attempt count back from the document, not the stale snapshot', async () => {
    const { event, update } = failingEvent(2);

    await expect((handlePaymentEvent as any)(event)).rejects.toThrow();
    expect(update.mock.calls[0][0].processingAttempts).toBe(3);
  });
});

describe('handlePaymentEvent — admin test checkouts', () => {
  const TOKEN = `t_${'a'.repeat(32)}`;
  const testMeta = { productId: 'p1', userId: 'admin1', test: TOKEN };

  // createTestCheckoutLink keeps the token it stamps, with the product it was made for.
  beforeEach(() => {
    mockTestCheckoutGet.mockResolvedValue({ exists: true, data: () => ({ productId: 'p1', adminUid: 'admin1', createdAt: { toMillis: () => Date.now() } }) });
  });

  it('records the charge, flagged isTest', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payT', total_amount: 4999, currency: 'USD', metadata: testMeta, customer: { email: 'admin@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockTxnAdd.mock.calls[0][0]).toMatchObject({ isTest: true, status: 'succeeded', amount: 49.99 });
  });

  // purchaseCount selects the pricing tier for REAL buyers, so testing the tier
  // ladder used to silently advance it.
  it('never advances the product purchase count', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payT', metadata: testMeta, customer: { email: 'admin@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockCountedCreate).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it('grants the admin no entitlement, no credits, and sends no email', async () => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => ({ ...product, creditsGranted: 100 }) });
    const payload = {
      type: 'subscription.active',
      data: { subscription_id: 'subT', metadata: testMeta, customer: { email: 'admin@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockGrantCredits).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('does not revoke or claw back on a test refund', async () => {
    const payload = {
      type: 'refund.succeeded',
      data: { refund_id: 'refT', payment_id: 'payT', amount: 500, currency: 'USD', metadata: testMeta, customer: { email: 'admin@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd.mock.calls[0][0]).toMatchObject({ isTest: true, status: 'refunded', amount: 5 });
    expect(mockRevoke).not.toHaveBeenCalled();
    expect(mockRefundCredits).not.toHaveBeenCalled();
  });

  it('does not mark a real subscription past due from a test failure', async () => {
    const payload = {
      type: 'subscription.failed',
      data: { subscription_id: 'subT', metadata: testMeta, customer: { email: 'admin@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd.mock.calls[0][0]).toMatchObject({ isTest: true, status: 'failed' });
    expect(mockMarkPastDue).not.toHaveBeenCalled();
  });

  it('leaves a genuine customer purchase untouched (no isTest flag)', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'pay1', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd.mock.calls[0][0].isTest).toBeUndefined();
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).toHaveBeenCalledTimes(1);
  });
});

describe('handlePaymentEvent — refund clawback amount', () => {
  const refundPayload = {
    type: 'refund.succeeded',
    data: {
      refund_id: 'refX', payment_id: 'payX', subscription_id: 'subX', amount: 500, currency: 'USD',
      ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' },
    },
  };

  beforeEach(() => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => ({ ...product, creditsGranted: 100 }) });
    chargeOf({ providerPaymentId: 'payX', providerSubscriptionId: 'subX' });
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', premiumType: 'gold', providerSubscriptionId: 'subX' });
  });

  // Previously this always clawed back product.creditsGranted, so a subscription
  // that had granted an allowance per renewal gave back only one period's worth.
  it('claws back what the refunded charge actually granted', async () => {
    mockRefundableAmount.mockResolvedValue(300);

    await (handlePaymentEvent as any)(makeEvent(refundPayload).event);

    expect(mockRefundableAmount).toHaveBeenCalledWith({
      providerPaymentId: 'payX',
      providerSubscriptionId: 'subX',
      fallback: 100,
    });
    expect(mockRefundCredits.mock.calls[0][2]).toBe(300);
  });

  it('falls back to the product allowance when the ledger yields nothing', async () => {
    mockRefundableAmount.mockImplementation(async (o: { fallback: number }) => o.fallback);

    await (handlePaymentEvent as any)(makeEvent(refundPayload).event);

    expect(mockRefundCredits.mock.calls[0][2]).toBe(100);
  });

  it('does not look up an amount for a non-credit product', async () => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => product });

    await (handlePaymentEvent as any)(makeEvent(refundPayload).event);

    expect(mockRefundableAmount).not.toHaveBeenCalled();
    expect(mockRefundCredits).not.toHaveBeenCalled();
  });
});

describe('handlePaymentEvent — a test flag only an admin test checkout can set', () => {
  // A buyer can put their own metadata on a gateway payment link, so `test` is not
  // proof of an admin test. Unproven, the event is a real purchase with every check.
  it('handles a plain test: "true" as a real purchase', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payF', ...PAID, metadata: { productId: 'p1', userId: 'u1', test: 'true' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTestCheckoutGet).not.toHaveBeenCalled();
    expect(mockTxnAdd.mock.calls[0][0].isTest).toBeUndefined();
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).toHaveBeenCalledTimes(1);
  });

  it('handles a token no admin test checkout made as a real purchase', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payF', ...PAID, metadata: { productId: 'p1', userId: 'u1', test: `t_${'b'.repeat(32)}` }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTestCheckoutGet).toHaveBeenCalledTimes(1);
    expect(mockTxnAdd.mock.calls[0][0].isTest).toBeUndefined();
    expect(mockGrant).toHaveBeenCalledTimes(1);
  });

  it('handles a token made for another product as a real purchase', async () => {
    mockTestCheckoutGet.mockResolvedValue({ exists: true, data: () => ({ productId: 'p2' }) });
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payF', ...PAID, metadata: { productId: 'p1', userId: 'u1', test: `t_${'c'.repeat(32)}` }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd.mock.calls[0][0].isTest).toBeUndefined();
    expect(mockGrant).toHaveBeenCalledTimes(1);
  });

  it('a forged flag cannot skip the product check', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: {
        payment_id: 'payF', product_cart: [{ product_id: 'prod_cheap', quantity: 1 }],
        metadata: { productId: 'p1', userId: 'u1', test: 'true' }, customer: { email: 'a@b.com' },
      },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockGrant).not.toHaveBeenCalled();
  });
});

describe('handlePaymentEvent — the product paid for', () => {
  it('grants when the paid product is the Product\'s gateway product', async () => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => ({ ...product, creditsGranted: 10 }) });
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payM', product_cart: [{ product_id: 'prod_p1', quantity: 1 }], metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrantCredits).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).toHaveBeenCalledTimes(1);
  });

  // A cheap product bought through a payment link whose metadata names a dearer Product.
  it('records but grants nothing when another product was paid for', async () => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => ({ ...product, creditsGranted: 10 }) });
    const payload = {
      type: 'payment.succeeded',
      data: {
        payment_id: 'payX', total_amount: 100, currency: 'USD', product_cart: [{ product_id: 'prod_cheap', quantity: 1 }],
        metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' },
      },
    };
    const { event, update } = makeEvent(payload);
    await (handlePaymentEvent as any)(event);

    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockTxnAdd.mock.calls[0][0]).toMatchObject({ productId: 'p1', status: 'succeeded', providerPaymentId: 'payX', productMismatch: true });
    expect(mockNotifyAdmins).toHaveBeenCalledWith('admin_payment_check', expect.objectContaining({ link: '/admin/transactions' }));
    expect(mockNotifyAdmins).not.toHaveBeenCalledWith('admin_payment_received', expect.anything());
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockGrantCredits).not.toHaveBeenCalled();
    expect(mockCountedCreate).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ processed: true }));
  });

  it('grants nothing for a subscription of another product', async () => {
    const payload = {
      type: 'subscription.active',
      data: { subscription_id: 'subX', product_id: 'prod_cheap', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it('grants nothing for a one-time payment that names no product, even in the gateway\'s own record', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payN', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockPaymentRetrieve).toHaveBeenCalledWith('payN');
    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  // A short payload must not cost a real buyer the plan they paid for.
  it('reads a one-time payment with no product list back from the gateway', async () => {
    mockPaymentRetrieve.mockResolvedValue({ product_cart: [{ product_id: 'prod_p1', quantity: 1 }] });
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payR1', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockPaymentRetrieve).toHaveBeenCalledWith('payR1');
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).toHaveBeenCalledTimes(1);
  });

  it('retries the event when the gateway cannot be read', async () => {
    mockPaymentRetrieve.mockRejectedValue(new Error('gateway down'));
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payR2', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    const { event, update } = makeEvent(payload);
    await expect((handlePaymentEvent as any)(event)).rejects.toThrow('gateway down');
    expect(mockGrant).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ processed: false, processingAttempts: 1 }));
  });

  // The Transaction used to be written before the gateway read, so the retry found it,
  // took the event as already handled, and the buyer never got a receipt.
  it('writes nothing before the gateway read, so the retry still sends the receipt', async () => {
    mockPaymentRetrieve.mockRejectedValueOnce(new Error('gateway down'))
      .mockResolvedValueOnce({ product_cart: [{ product_id: 'prod_p1', quantity: 1 }] });
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payR4', total_amount: 999, currency: 'USD', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await expect((handlePaymentEvent as any)(makeEvent(payload).event)).rejects.toThrow('gateway down');
    expect(mockTxnAdd).not.toHaveBeenCalled();

    await (handlePaymentEvent as any)(makeEvent(payload).event);
    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith('payment_succeeded_email', expect.anything(), expect.anything(), expect.any(String));
  });

  it('does not ask the gateway when the payload names the product', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payR3', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);
    expect(mockPaymentRetrieve).not.toHaveBeenCalled();
  });

  it('grants nothing when the Product has no gateway product', async () => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => ({ ...product, providerProductIds: undefined }) });
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payE', ...PAID, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockGrant).not.toHaveBeenCalled();
  });

  // Dodo's payment events list products only for one-time payments. A subscription's
  // charge still gets its receipt; the subscription's own events, which name the
  // product, grant.
  it('a subscription charge that names no product sends the receipt and grants nothing', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payS', subscription_id: 'sub1', total_amount: 999, currency: 'USD', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockCountedCreate).not.toHaveBeenCalled();
    expect(mockSendEmail).toHaveBeenCalledWith('payment_succeeded_email', expect.anything(), expect.anything(), expect.any(String));
  });
});

describe('handlePaymentEvent — a subscription renewed under another gateway product', () => {
  // The Product was re-linked to prod_new, or the plan changed in Dodo: the member's
  // own subscription keeps renewing as prod_p1 or as another plan.
  const renewal = (productId: string, subscriptionId = 'sub1') => ({
    type: 'subscription.renewed',
    data: { subscription_id: subscriptionId, product_id: productId, metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
  });
  const relinked = { ...product, type: 'subscription', providerProductIds: { dodo: 'prod_new' } };

  beforeEach(() => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => relinked });
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', providerSubscriptionId: 'sub1', premiumProductId: 'p1', premiumType: 'gold' });
  });

  it('keeps renewing the subscription the member holds after the Product was re-linked', async () => {
    await (handlePaymentEvent as any)(makeEvent(renewal('prod_p1')).event);

    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrant.mock.calls[0][1]).toMatchObject({ id: 'p1' });
    expect(lastTxn().productMismatch).toBeUndefined();
    expect(mockNotifyAdmins).toHaveBeenCalledWith('admin_payment_check', expect.anything());
  });

  it('accepts a member granted before the Product was stored on them, by plan', async () => {
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', providerSubscriptionId: 'sub1', premiumType: 'gold' });
    await (handlePaymentEvent as any)(makeEvent(renewal('prod_p1')).event);
    expect(mockGrant).toHaveBeenCalledTimes(1);
  });

  it('grants the Product now linked to the plan the subscription moved to', async () => {
    const silver = { ...product, name: 'Silver', premiumType: 'silver', providerProductIds: { dodo: 'prod_silver' } };
    mockProductsByField.mockImplementation(async (field: string, value: string) =>
      field === 'providerProductIds.dodo' && value === 'prod_silver' ? { docs: [{ id: 'p2', data: () => silver }] } : { docs: [] });
    await (handlePaymentEvent as any)(makeEvent(renewal('prod_silver')).event);

    expect(mockGrant.mock.calls[0][1]).toMatchObject({ id: 'p2', premiumType: 'silver' });
    expect(lastTxn()).toMatchObject({ productId: 'p2' });
  });

  it('refuses a renewal of a subscription the member does not hold, and tells the admins', async () => {
    await (handlePaymentEvent as any)(makeEvent(renewal('prod_p1', 'subOther')).event);

    expect(mockGrant).not.toHaveBeenCalled();
    expect(lastTxn()).toMatchObject({ productMismatch: true });
    expect(mockNotifyAdmins).toHaveBeenCalledWith('admin_payment_check', expect.objectContaining({ body: expect.stringContaining('nothing was given') }));
  });

  it('refuses when the member holds another Product on that subscription', async () => {
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', providerSubscriptionId: 'sub1', premiumProductId: 'p9' });
    await (handlePaymentEvent as any)(makeEvent(renewal('prod_p1')).event);
    expect(mockGrant).not.toHaveBeenCalled();
  });

  it('alerts once: a redelivery finds its Transaction and stays quiet', async () => {
    mockTxnGet.mockResolvedValue({ empty: false });
    await (handlePaymentEvent as any)(makeEvent(renewal('prod_p1', 'subOther')).event);
    expect(mockNotifyAdmins).not.toHaveBeenCalledWith('admin_payment_check', expect.anything());
  });
});

describe('handlePaymentEvent — subscription.plan_changed', () => {
  const planChanged = (productId: string) => ({
    type: 'subscription.plan_changed',
    data: { subscription_id: 'sub1', product_id: productId, status: 'active', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
  });
  const silver = { ...product, premiumType: 'silver', tierRank: 1, providerProductIds: { dodo: 'prod_silver' } };

  beforeEach(() => {
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', providerSubscriptionId: 'sub1', premiumProductId: 'p1' });
    mockProductsByField.mockImplementation(async (field: string, value: string) =>
      field === 'providerProductIds.dodo' && value === 'prod_silver' ? { docs: [{ id: 'p2', data: () => silver }] } : { docs: [] });
  });

  it('grants the Product linked to the new plan, with no Transaction or email', async () => {
    await (handlePaymentEvent as any)(makeEvent(planChanged('prod_silver')).event);

    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockGrant.mock.calls[0][1]).toMatchObject({ id: 'p2' });
    expect(mockGrant.mock.calls[0][2]).toMatchObject({ subscriptionId: 'sub1' });
    expect(mockTxnAdd).not.toHaveBeenCalled();
    expect(mockSendEmail).not.toHaveBeenCalled();
  });

  it('changes nothing and tells the admins when no Product is linked to the new plan', async () => {
    await (handlePaymentEvent as any)(makeEvent(planChanged('prod_unknown')).event);
    expect(mockGrant).not.toHaveBeenCalled();
    expect(mockNotifyAdmins).toHaveBeenCalledWith('admin_payment_check', expect.anything());
  });

  it('changes nothing for a subscription the member does not hold', async () => {
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', providerSubscriptionId: 'subOther' });
    await (handlePaymentEvent as any)(makeEvent(planChanged('prod_silver')).event);
    expect(mockGrant).not.toHaveBeenCalled();
  });
});

describe('handlePaymentEvent — a refund ends only the access it paid for', () => {
  const refund = (fields: Record<string, unknown> = {}) => ({
    type: 'refund.succeeded',
    data: { refund_id: 'refQ', payment_id: 'payQ', amount: 500, currency: 'USD', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' }, ...fields },
  });

  beforeEach(() => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => ({ ...product, creditsGranted: 50 }) });
  });

  it('revokes when the refunded payment granted the member\'s access', async () => {
    chargeOf({ providerPaymentId: 'payQ' });
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', premiumType: 'gold', premiumPaymentId: 'payQ' });
    await (handlePaymentEvent as any)(makeEvent(refund()).event);

    expect(mockRevoke).toHaveBeenCalledTimes(1);
    expect(mockRefundCredits).toHaveBeenCalledTimes(1);
  });

  it('leaves access from another purchase alone', async () => {
    chargeOf({ providerPaymentId: 'payQ' });
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', premiumType: 'platinum', premiumPaymentId: 'payNewer' });
    await (handlePaymentEvent as any)(makeEvent(refund()).event);

    expect(mockRevoke).not.toHaveBeenCalled();
    // The refunded charge's own credits still go back.
    expect(mockRefundCredits).toHaveBeenCalledTimes(1);
  });

  it('leaves a subscription alone when a one-time payment is refunded', async () => {
    chargeOf({ providerPaymentId: 'payQ' });
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', premiumType: 'gold', providerSubscriptionId: 'subLive' });
    await (handlePaymentEvent as any)(makeEvent(refund()).event);
    expect(mockRevoke).not.toHaveBeenCalled();
  });

  it('takes no access or credits from whoever the metadata names when no charge of theirs was refunded', async () => {
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', premiumType: 'gold', premiumPaymentId: 'payTheirs' });
    await (handlePaymentEvent as any)(makeEvent(refund()).event);

    expect(mockRevoke).not.toHaveBeenCalled();
    expect(mockRefundCredits).not.toHaveBeenCalled();
  });

  it('takes nothing from a member when the charge was another member\'s', async () => {
    chargeOf({ providerPaymentId: 'payQ', userId: 'u2' });
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', premiumType: 'gold' });
    await (handlePaymentEvent as any)(makeEvent(refund()).event);
    expect(mockRefundCredits).not.toHaveBeenCalled();
  });

  it('finds the subscription of a refunded renewal charge from its Transaction', async () => {
    chargeOf({ providerPaymentId: 'payQ', providerSubscriptionId: 'subQ' });
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', premiumType: 'gold', providerSubscriptionId: 'subQ' });
    await (handlePaymentEvent as any)(makeEvent(refund()).event);
    expect(mockRevoke).toHaveBeenCalledWith({ id: 'userRef' }, 'subQ', 'expired', undefined);
  });

  it('revokes a one-time grant made before the payment was stored, matched by the charge', async () => {
    chargeOf({ providerPaymentId: 'payQ' });
    mockCurrent.mockResolvedValue({ isPro: true, uid: 'u1', premiumType: 'gold' });
    await (handlePaymentEvent as any)(makeEvent(refund()).event);
    expect(mockRevoke).toHaveBeenCalledTimes(1);
  });
});

describe('handlePaymentEvent — an old test checkout link', () => {
  const TOKEN = `t_${'d'.repeat(32)}`;
  const day = 24 * 60 * 60 * 1000;
  const keptAt = (msAgo: number, extra: Record<string, unknown> = {}) =>
    mockTestCheckoutGet.mockResolvedValue({ exists: true, data: () => ({ productId: 'p1', createdAt: { toMillis: () => Date.now() - msAgo }, ...extra }) });

  it('is a real purchase once the link is over a week old and unused', async () => {
    keptAt(8 * day);
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payOld', ...PAID, metadata: { productId: 'p1', userId: 'u1', test: TOKEN }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);
    expect(lastTxn().isTest).toBeUndefined();
  });

  it('keeps a renewal of a test subscription a test, however old the link', async () => {
    keptAt(40 * day, { subscriptionIds: ['subT'] });
    const payload = {
      type: 'subscription.renewed',
      data: { subscription_id: 'subT', ...PAID, metadata: { productId: 'p1', userId: 'admin1', test: TOKEN }, customer: { email: 'admin@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);
    expect(lastTxn()).toMatchObject({ isTest: true });
    expect(mockGrant).not.toHaveBeenCalled();
  });
});
