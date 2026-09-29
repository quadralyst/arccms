/**
 * Tests for the one-click unsubscribe HTTP function
 * (functions/src/email-core/handleUnsubscribe.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../constant', () => ({
  constant: { isProduction: false, live_url: 'https://app.example.com/', local_url: 'http://localhost:5173/' },
}));

const {
  mockSettingsGet,
  mockEmailLogsGet,
  mockSuppressionSet,
  mockWaitlistedGet,
  mockCollectionGroupGet,
  waitlistUpdate,
} = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockEmailLogsGet: vi.fn(),
  mockSuppressionSet: vi.fn().mockResolvedValue(undefined),
  mockWaitlistedGet: vi.fn(),
  mockCollectionGroupGet: vi.fn(),
  waitlistUpdate: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'Settings') return { doc: vi.fn().mockReturnValue({ get: mockSettingsGet }) };
      if (name === 'EmailLogs') {
        return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockEmailLogsGet }) }) };
      }
      if (name === 'Suppression') return { doc: vi.fn().mockReturnValue({ set: mockSuppressionSet }) };
      if (name === 'WaitlistedUsers') {
        return { where: vi.fn().mockReturnValue({ get: mockWaitlistedGet }) };
      }
      return {};
    }),
    collectionGroup: vi.fn().mockReturnValue({ where: vi.fn().mockReturnValue({ get: mockCollectionGroupGet }) }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: vi.fn(() => ({ seconds: 0, nanoseconds: 0 })) },
}));

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('firebase-functions/v2/https', () => ({
  onRequest: vi.fn((handler: any) => handler),
}));

// Every feature on unless a test turns some off (docs/feature-flags-spec.md).
const featuresOff = vi.hoisted(() => new Set<string>());
vi.mock('../feature-flags.js', () => ({ isFeatureOn: (id: string) => !featuresOff.has(id) }));
const { mockSetRecipientConsent, mockExitAllEnrollments } = vi.hoisted(() => ({
  mockSetRecipientConsent: vi.fn().mockResolvedValue(undefined),
  mockExitAllEnrollments: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../email-core/recipientConsent.js', () => ({ setRecipientConsent: mockSetRecipientConsent }));
vi.mock('../email-core/dripEnrollment.js', () => ({ exitAllEnrollments: mockExitAllEnrollments }));

import { handleUnsubscribe } from '../email-core/handleUnsubscribe.js';
import { computeEmailHash, buildUnsubscribeToken } from '../email-core/unsubscribeToken.js';

const handler = handleUnsubscribe as unknown as (req: any, res: any) => Promise<void>;

const SECRET = 'unsub-secret';
const EMAIL = 'user@example.com';
const HASH = computeEmailHash(EMAIL);
const TOKEN = buildUnsubscribeToken(HASH, SECRET);

function makeRes() {
  const res: any = {
    statusCode: 200,
    body: '',
    status: vi.fn(function (this: any, code: number) { res.statusCode = code; return res; }),
    send: vi.fn(function (this: any, body: string) { res.body = body; return res; }),
  };
  return res;
}

describe('handleUnsubscribe', () => {
  beforeEach(() => {
    // No host app here, whatever an earlier test file in this worker set.
    delete process.env.ARC_APP_USERS_PATH;
    delete process.env.ARC_APP_USERS_DATABASE;
    vi.clearAllMocks();
    featuresOff.clear();
    mockSettingsGet.mockResolvedValue({ data: () => ({ unsubscribeSecret: SECRET }) });
    mockEmailLogsGet.mockResolvedValue({ empty: false, docs: [{ data: () => ({ toEmail: EMAIL }) }] });
    mockWaitlistedGet.mockResolvedValue({ docs: [{ ref: { update: waitlistUpdate } }] });
    mockCollectionGroupGet.mockResolvedValue({ docs: [] });
    mockSuppressionSet.mockResolvedValue(undefined);
  });

  it('GET with a valid token unsubscribes and returns the success page', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { e: HASH, t: TOKEN }, body: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toContain('Successfully Unsubscribed');

    // Suppression doc written with the recovered email + reason.
    expect(mockSuppressionSet).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, emailHash: HASH, reason: 'unsubscribe' }),
      { merge: true },
    );
    // Legacy waitlist flag flipped.
    expect(waitlistUpdate).toHaveBeenCalledWith({ isSubscribed: false });
  });

  it('updates contacts, sequences and form records when those features are on', async () => {
    await handler({ method: 'GET', query: { e: HASH, t: TOKEN }, body: {} }, makeRes());
    expect(mockSetRecipientConsent).toHaveBeenCalledWith(HASH, 'unsubscribed', EMAIL);
    expect(mockExitAllEnrollments).toHaveBeenCalledWith(HASH, 'unsubscribed');
    expect(waitlistUpdate).toHaveBeenCalled();
  });

  it('only suppresses when audience, email marketing and forms are off', async () => {
    featuresOff.add('audience').add('email-marketing').add('forms');
    const res = makeRes();
    await handler({ method: 'GET', query: { e: HASH, t: TOKEN }, body: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(mockSuppressionSet).toHaveBeenCalledWith(
      expect.objectContaining({ email: EMAIL, emailHash: HASH, reason: 'unsubscribe' }),
      { merge: true },
    );
    expect(mockSetRecipientConsent).not.toHaveBeenCalled();
    expect(mockExitAllEnrollments).not.toHaveBeenCalled();
    expect(mockWaitlistedGet).not.toHaveBeenCalled();
    expect(mockCollectionGroupGet).not.toHaveBeenCalled();
  });

  it('GET with an invalid token returns 400 and does NOT suppress', async () => {
    const res = makeRes();
    await handler({ method: 'GET', query: { e: HASH, t: 'bad-token' }, body: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toContain('Invalid Unsubscribe Link');
    expect(mockSuppressionSet).not.toHaveBeenCalled();
  });

  it('POST one-click with a valid token returns 200 plain (no page)', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {}, body: { e: HASH, t: TOKEN } }, res);

    expect(res.statusCode).toBe(200);
    expect(res.body).toBe('unsubscribed');
    expect(mockSuppressionSet).toHaveBeenCalled();
  });

  it('POST with an invalid token returns 400 plain', async () => {
    const res = makeRes();
    await handler({ method: 'POST', query: {}, body: { e: HASH, t: 'nope' } }, res);

    expect(res.statusCode).toBe(400);
    expect(res.body).toBe('invalid token');
  });

  it('still writes suppression when the email cannot be recovered', async () => {
    mockEmailLogsGet.mockResolvedValue({ empty: true, docs: [] });
    const res = makeRes();
    await handler({ method: 'GET', query: { e: HASH, t: TOKEN }, body: {} }, res);

    expect(res.statusCode).toBe(200);
    expect(mockSuppressionSet).toHaveBeenCalledWith(
      expect.objectContaining({ email: '', emailHash: HASH, reason: 'unsubscribe' }),
      { merge: true },
    );
    // No email → no waitlist flip attempted.
    expect(waitlistUpdate).not.toHaveBeenCalled();
  });

  it('returns 400 when no unsubscribeSecret is configured', async () => {
    mockSettingsGet.mockResolvedValue({ data: () => ({}) });
    const res = makeRes();
    await handler({ method: 'GET', query: { e: HASH, t: TOKEN }, body: {} }, res);

    expect(res.statusCode).toBe(400);
    expect(mockSuppressionSet).not.toHaveBeenCalled();
  });
});
