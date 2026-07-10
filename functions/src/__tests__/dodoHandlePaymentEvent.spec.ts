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
}));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: (_path: string, handler: unknown) => handler,
}));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'Transactions') {
        return {
          where: () => ({ limit: () => ({ get: mockTxnGet }) }),
          add: mockTxnAdd,
        };
      }
      if (name === 'Products') {
        return { doc: () => ({ get: mockProductGet, update: mockProductUpdate }) };
      }
      if (name === 'CountedBuyers') {
        return { doc: () => ({ create: mockCountedCreate }) };
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
}));

vi.mock('../dodo-payments/credits', () => ({
  grantCredits: mockGrantCredits,
  refundCredits: mockRefundCredits,
}));

vi.mock('../dodo-payments/paymentEmailHelper', () => ({ sendPaymentEmail: mockSendEmail }));

import { handlePaymentEvent } from '../dodo-payments/handlePaymentEvent.js';

const product = { id: 'p1', type: 'one_time', premiumType: 'gold', tierRank: 2, purchaseCount: 5 };

function makeEvent(payload: unknown) {
  const update = vi.fn();
  return {
    event: { params: { eventId: 'e1' }, data: { data: () => ({ rawPayload: payload }), ref: { update } } },
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
});

describe('handlePaymentEvent', () => {
  it('payment.succeeded records txn, increments counter once, grants, emails', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'pay1', total_amount: 4999, currency: 'USD', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    const { event, update } = makeEvent(payload);
    await (handlePaymentEvent as any)(event);

    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockTxnAdd.mock.calls[0][0]).toMatchObject({ status: 'succeeded', amount: 49.99, currency: 'USD', userId: 'u1' });
    expect(mockProductUpdate).toHaveBeenCalledTimes(1); // counter incremented
    expect(mockGrant).toHaveBeenCalledTimes(1);
    expect(mockSendEmail).toHaveBeenCalledWith('payment_succeeded_email', expect.anything(), expect.anything());
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ processed: true }));
  });

  it('duplicate payment id is a no-op (no double txn / no increment)', async () => {
    mockTxnGet.mockResolvedValue({ empty: false }); // existing transaction found
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'pay1', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).not.toHaveBeenCalled();
    expect(mockProductUpdate).not.toHaveBeenCalled();
  });

  it('subscription.renewed records a txn but does NOT increment the buyer counter', async () => {
    const payload = {
      type: 'subscription.renewed',
      data: { payment_id: 'pay2', subscription_id: 'sub1', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).not.toHaveBeenCalled(); // renewals don't add buyers
  });

  it('subscription.active increments the buyer counter once (keyed on subscription)', async () => {
    const payload = {
      type: 'subscription.active',
      data: { subscription_id: 'sub1', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockCountedCreate).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).toHaveBeenCalledTimes(1);
  });

  it('recurring payment.succeeded carrying a subscription_id does NOT add a buyer', async () => {
    // A renewal charge arrives as payment.succeeded WITH a subscription id — must not count.
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payR', subscription_id: 'sub1', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
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
      data: { subscription_id: 'sub1', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockCountedCreate).toHaveBeenCalledTimes(1);
    expect(mockProductUpdate).not.toHaveBeenCalled(); // create failed → no increment
  });

  it('subscription.active with no payment_id still dedups (transaction idempotencyKey)', async () => {
    mockTxnGet.mockResolvedValue({ empty: false }); // same activation already recorded
    const payload = {
      type: 'subscription.active',
      data: { subscription_id: 'sub1', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockTxnAdd).not.toHaveBeenCalled();
    expect(mockCountedCreate).not.toHaveBeenCalled();
  });

  it('records the discount code and passes the locked-in deal to grantEntitlement', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: {
        payment_id: 'payD',
        total_amount: 1500,
        currency: 'USD',
        metadata: { productId: 'p1', userId: 'u1', tierLabel: 'First 100', discountCode: 'EARLY' },
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
      data: { payment_id: 'pay9', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
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
      data: { payment_id: 'payC', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
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
      data: { subscription_id: 'sub1', next_billing_date: '2026-09-10', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockGrantCredits).toHaveBeenCalledTimes(1);
    expect(mockGrantCredits.mock.calls[0][2]).toBe(50);
    expect(mockGrantCredits.mock.calls[0][3]).toMatchObject({ ledgerId: 'grant:sub:sub1:renew:2026-09-10', reason: 'renewal' });
  });

  it('does NOT grant credits for a non-credit product', async () => {
    const payload = {
      type: 'payment.succeeded',
      data: { payment_id: 'payX', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);
    expect(mockGrantCredits).not.toHaveBeenCalled();
  });

  it('claws back credits on refund of a credit product', async () => {
    mockProductGet.mockResolvedValue({ exists: true, id: 'p1', data: () => ({ ...product, creditsGranted: 100 }) });
    const payload = {
      type: 'refund.succeeded',
      data: { payment_id: 'payR', metadata: { productId: 'p1', userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockRefundCredits).toHaveBeenCalledTimes(1);
    expect(mockRefundCredits.mock.calls[0]).toMatchObject([{ id: 'userRef' }, 'u1', 100, { ledgerId: 'refund:payR' }]);
  });

  it('subscription.cancelled revokes the entitlement', async () => {
    const payload = {
      type: 'subscription.cancelled',
      data: { subscription_id: 'sub1', metadata: { userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockRevoke).toHaveBeenCalledWith({ id: 'userRef' }, 'sub1', 'cancelled', undefined);
    expect(mockSendEmail).toHaveBeenCalledWith('subscription_lifecycle_email', expect.anything(), expect.anything());
  });
});
