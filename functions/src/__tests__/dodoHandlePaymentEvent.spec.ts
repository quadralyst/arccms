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
  mockFindUserRef,
  mockGrant,
  mockRevoke,
  mockMarkPastDue,
  mockSendEmail,
} = vi.hoisted(() => ({
  mockTxnGet: vi.fn(),
  mockTxnAdd: vi.fn(),
  mockProductGet: vi.fn(),
  mockProductUpdate: vi.fn(),
  mockFindUserRef: vi.fn(),
  mockGrant: vi.fn(),
  mockRevoke: vi.fn(),
  mockMarkPastDue: vi.fn(),
  mockSendEmail: vi.fn(),
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
  mockFindUserRef.mockResolvedValue({ id: 'userRef' });
  mockGrant.mockResolvedValue(undefined);
  mockRevoke.mockResolvedValue(undefined);
  mockSendEmail.mockResolvedValue(undefined);
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

  it('subscription.cancelled revokes the entitlement', async () => {
    const payload = {
      type: 'subscription.cancelled',
      data: { subscription_id: 'sub1', metadata: { userId: 'u1' }, customer: { email: 'a@b.com' } },
    };
    await (handlePaymentEvent as any)(makeEvent(payload).event);

    expect(mockRevoke).toHaveBeenCalledWith({ id: 'userRef' }, 'sub1', 'cancelled');
    expect(mockSendEmail).toHaveBeenCalledWith('subscription_lifecycle_email', expect.anything(), expect.anything());
  });
});
