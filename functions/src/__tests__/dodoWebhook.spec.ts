/**
 * Tests for functions/src/dodo-payments/dodoWebhook.ts
 *
 * Covers: missing headers → 400; invalid signature → 401; valid event recorded
 * with create() → 200; duplicate delivery (create rejects ALREADY_EXISTS) → 200.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUnwrap, mockCreate, mockDoc, mockCollection, mockGetSettings, mockBuildClient } = vi.hoisted(() => ({
  mockUnwrap: vi.fn(),
  mockCreate: vi.fn(),
  mockDoc: vi.fn(),
  mockCollection: vi.fn(),
  mockGetSettings: vi.fn(),
  mockBuildClient: vi.fn(),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onRequest: (handler: unknown) => handler,
  onCall: (handler: unknown) => handler,
  HttpsError: class extends Error {},
}));

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../init', () => ({
  db: { collection: mockCollection },
}));

vi.mock('../dodo-payments/dodoClient', () => ({
  getDodoSettings: mockGetSettings,
  buildDodoClient: mockBuildClient,
}));

import { dodoWebhook } from '../dodo-payments/dodoWebhook.js';

function makeRes() {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.send = vi.fn().mockReturnValue(res);
  return res;
}

const validHeaders = {
  'webhook-id': 'evt_123',
  'webhook-signature': 'v1,sig',
  'webhook-timestamp': '1700000000',
};

beforeEach(() => {
  vi.clearAllMocks();
  mockDoc.mockReturnValue({ create: mockCreate });
  mockCollection.mockReturnValue({ doc: mockDoc });
  mockGetSettings.mockResolvedValue({ webhookSecret: 'whsec', mode: 'test' });
  mockBuildClient.mockReturnValue({ webhooks: { unwrap: mockUnwrap } });
});

describe('dodoWebhook', () => {
  it('returns 400 when required headers are missing', async () => {
    const res = makeRes();
    await (dodoWebhook as any)({ headers: {}, body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(mockUnwrap).not.toHaveBeenCalled();
  });

  it('returns 401 when signature verification fails', async () => {
    mockUnwrap.mockImplementation(() => {
      throw new Error('bad signature');
    });
    const res = makeRes();
    await (dodoWebhook as any)({ headers: validHeaders, rawBody: Buffer.from('{}'), body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('records a verified event and returns 200', async () => {
    mockUnwrap.mockReturnValue({ type: 'payment.succeeded', data: { payment_id: 'pay_1' } });
    mockCreate.mockResolvedValue(undefined);
    const res = makeRes();
    await (dodoWebhook as any)({ headers: validHeaders, rawBody: Buffer.from('{}'), body: {} }, res);

    expect(mockCollection).toHaveBeenCalledWith('WebhookEvents');
    expect(mockDoc).toHaveBeenCalledWith('evt_123');
    expect(mockCreate).toHaveBeenCalledTimes(1);
    const written = mockCreate.mock.calls[0][0];
    expect(written.eventType).toBe('payment.succeeded');
    expect(written.signatureValid).toBe(true);
    expect(written.processed).toBe(false);
    expect(res.status).toHaveBeenCalledWith(200);
  });

  it('is idempotent — duplicate delivery returns 200 without error', async () => {
    mockUnwrap.mockReturnValue({ type: 'payment.succeeded', data: {} });
    mockCreate.mockRejectedValue(new Error('ALREADY_EXISTS'));
    const res = makeRes();
    await (dodoWebhook as any)({ headers: validHeaders, rawBody: Buffer.from('{}'), body: {} }, res);
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.send).toHaveBeenCalledWith('Already processed');
  });
});
