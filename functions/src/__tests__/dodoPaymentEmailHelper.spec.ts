/**
 * Tests for functions/src/dodo-payments/paymentEmailHelper.ts
 *
 * The payment trigger now retries on failure, so a retry must never enqueue a
 * second copy of an email it already sent. Covers the deterministic-id path and
 * the unchanged auto-id path for one-shot sends.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockAdd, mockCreate, mockDoc, mockTemplateGet, mockSettingsGet, FakeTimestamp } = vi.hoisted(() => {
  class FakeTimestamp {
    constructor(public ms: number) {}
    static now() {
      return new FakeTimestamp(0);
    }
  }
  return {
    mockAdd: vi.fn(),
    mockCreate: vi.fn(),
    mockDoc: vi.fn(),
    mockTemplateGet: vi.fn(),
    mockSettingsGet: vi.fn(),
    FakeTimestamp,
  };
});

vi.mock('firebase-admin/firestore', () => ({ Timestamp: FakeTimestamp }));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock('../init', () => ({
  db: {
    collection: (name: string) => {
      if (name === 'EmailTemplate') return { where: () => ({ limit: () => ({ get: mockTemplateGet }) }) };
      if (name === 'EmailLogs') return { add: mockAdd, doc: mockDoc };
      return { doc: () => ({ get: mockSettingsGet }) }; // Settings
    },
  },
}));

import { sendPaymentEmail } from '../dodo-payments/paymentEmailHelper.js';

const template = {
  senderEmail: 'billing@example.com',
  senderName: 'Billing',
  subject: 'Receipt',
  template: '<p>##PAYMENT_AMOUNT##</p>',
  previewText: '',
};

const recipient = { email: 'a@b.com', name: 'Ada' };

beforeEach(() => {
  vi.clearAllMocks();
  mockTemplateGet.mockResolvedValue({ empty: false, docs: [{ data: () => template }] });
  mockSettingsGet.mockResolvedValue({ exists: false });
  mockDoc.mockReturnValue({ create: mockCreate });
  mockCreate.mockResolvedValue(undefined);
  mockAdd.mockResolvedValue({ id: 'log1' });
});

describe('sendPaymentEmail — dedupe key', () => {
  it('writes to a deterministic doc id derived from type + key', async () => {
    await sendPaymentEmail('payment_succeeded_email', recipient, { amount: 49.99 }, 'pay:pay1:payment.succeeded');

    expect(mockDoc).toHaveBeenCalledWith('payment_succeeded_email__pay:pay1:payment.succeeded');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('scopes the id by email type so one event can send two different emails', async () => {
    await sendPaymentEmail('payment_succeeded_email', recipient, {}, 'k1');
    await sendPaymentEmail('subscription_lifecycle_email', recipient, {}, 'k1');

    expect(mockDoc.mock.calls[0][0]).not.toBe(mockDoc.mock.calls[1][0]);
  });

  it('is a silent no-op when the email was already enqueued for this event', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('ALREADY_EXISTS'), { code: 6 }));

    await expect(sendPaymentEmail('payment_succeeded_email', recipient, {}, 'k1')).resolves.toBeUndefined();
  });

  // A real write failure has to propagate, or the trigger would mark the event
  // processed while the receipt was never queued.
  it('rethrows a genuine write failure', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('UNAVAILABLE'), { code: 14 }));

    await expect(sendPaymentEmail('payment_succeeded_email', recipient, {}, 'k1')).rejects.toThrow('UNAVAILABLE');
  });

  it('strips slashes, which are illegal in a Firestore doc id', async () => {
    await sendPaymentEmail('payment_succeeded_email', recipient, {}, 'evt:a/b/c');

    expect(mockDoc.mock.calls[0][0]).not.toContain('/');
  });

  it('falls back to an auto-id when no key is given', async () => {
    await sendPaymentEmail('payment_succeeded_email', recipient, { amount: 10 });

    expect(mockAdd).toHaveBeenCalledTimes(1);
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('sendPaymentEmail — admin toggles still apply', () => {
  it('sends nothing when no template is configured', async () => {
    mockTemplateGet.mockResolvedValue({ empty: true, docs: [] });
    await sendPaymentEmail('payment_succeeded_email', recipient, {}, 'k1');

    expect(mockCreate).not.toHaveBeenCalled();
    expect(mockAdd).not.toHaveBeenCalled();
  });

  it('sends nothing when the template is disabled', async () => {
    mockTemplateGet.mockResolvedValue({ empty: false, docs: [{ data: () => ({ ...template, isActive: false }) }] });
    await sendPaymentEmail('payment_succeeded_email', recipient, {}, 'k1');

    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('sends nothing when the event carries no recipient email', async () => {
    await sendPaymentEmail('payment_succeeded_email', { email: '' }, {}, 'k1');

    expect(mockCreate).not.toHaveBeenCalled();
  });
});
