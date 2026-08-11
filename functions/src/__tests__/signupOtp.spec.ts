/**
 * Tests for the server-side signup OTP callables
 * (functions/src/auth/signupOtp.ts) — E3.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';

const {
  mockOtpGet,
  mockOtpSet,
  mockOtpUpdate,
  mockTemplateGet,
  mockQueueEmail,
  mockEnsureDefaults,
} = vi.hoisted(() => ({
  mockOtpGet: vi.fn(),
  mockOtpSet: vi.fn().mockResolvedValue(undefined),
  mockOtpUpdate: vi.fn().mockResolvedValue(undefined),
  mockTemplateGet: vi.fn(),
  mockQueueEmail: vi.fn().mockResolvedValue({ id: 'log-1', status: 'pending' }),
  mockEnsureDefaults: vi.fn().mockResolvedValue({ created: [], skipped: [] }),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'signup_otps') {
        return {
          doc: vi.fn().mockReturnValue({ get: mockOtpGet, set: mockOtpSet, update: mockOtpUpdate }),
        };
      }
      if (name === 'EmailTemplate') {
        return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockTemplateGet }) }) };
      }
      return {};
    }),
  },
}));

vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));
vi.mock('../email-core/defaultTemplates', () => ({ ensureDefaultTemplates: mockEnsureDefaults }));

vi.mock('../constant', () => ({
  constant: { isProduction: false, live_url: 'https://x/', local_url: 'http://l/' },
}));

vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((handler: any) => handler),
  HttpsError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: vi.fn(() => ({ seconds: 0, nanoseconds: 0 })),
    fromMillis: vi.fn((ms: number) => ({ toMillis: () => ms })),
  },
}));

import { requestSignupOtp, verifySignupOtp } from '../auth/signupOtp.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';

const reqHandler = requestSignupOtp as unknown as (r: any) => Promise<any>;
const verifyHandler = verifySignupOtp as unknown as (r: any) => Promise<any>;

const EMAIL = 'user@example.com';
const HASH = computeEmailHash(EMAIL);
const hashCode = (code: string) => createHash('sha256').update(`${HASH}:${code}`).digest('hex');

const activeTemplate = {
  empty: false,
  docs: [{ data: () => ({ senderEmail: 's@x.com', senderName: 'S', subject: 'Code', template: 'x ##OTP##', isActive: true }) }],
};

describe('requestSignupOtp', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockOtpGet.mockResolvedValue({ exists: false });
    mockTemplateGet.mockResolvedValue(activeTemplate);
    mockQueueEmail.mockResolvedValue({ id: 'log-1', status: 'pending' });
  });

  it('rejects an invalid email', async () => {
    await expect(reqHandler({ data: { email: 'not-an-email' } })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('stores a hashed code + expiry and queues the OTP email', async () => {
    const res = await reqHandler({ data: { email: EMAIL } });

    expect(res).toEqual({ sent: true, status: 'pending' });
    const stored = mockOtpSet.mock.calls[0][0];
    expect(stored.emailHash).toBe(HASH);
    expect(stored.attempts).toBe(0);
    expect(stored.codeHash).toMatch(/^[a-f0-9]{64}$/);
    // never stores the plaintext code
    expect(JSON.stringify(stored)).not.toMatch(/"code":/);

    expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
      source: 'auth',
      category: 'transactional',
      type: 'signup_otp_email',
      toEmail: EMAIL,
      data: expect.objectContaining({ otp: expect.stringMatching(/^\d{6}$/) }),
    }));
  });

  it('throttles resends within 60s', async () => {
    mockOtpGet.mockResolvedValue({ exists: true, data: () => ({ lastSentAt: { toMillis: () => Date.now() - 10_000 } }) });
    await expect(reqHandler({ data: { email: EMAIL } })).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });

  it('allows a resend after the throttle window', async () => {
    mockOtpGet.mockResolvedValue({ exists: true, data: () => ({ lastSentAt: { toMillis: () => Date.now() - 120_000 } }) });
    const res = await reqHandler({ data: { email: EMAIL } });
    expect(res.sent).toBe(true);
  });

  it('lazily seeds templates when the OTP template is missing', async () => {
    mockTemplateGet
      .mockResolvedValueOnce({ empty: true, docs: [] }) // first read: missing
      .mockResolvedValueOnce(activeTemplate);           // after seeding
    const res = await reqHandler({ data: { email: EMAIL } });
    expect(mockEnsureDefaults).toHaveBeenCalled();
    expect(res.sent).toBe(true);
  });

  it('fails cleanly when no template exists even after seeding', async () => {
    mockTemplateGet.mockResolvedValue({ empty: true, docs: [] });
    await expect(reqHandler({ data: { email: EMAIL } })).rejects.toMatchObject({ code: 'failed-precondition' });
  });
});

describe('verifySignupOtp', () => {
  const future = () => ({ toMillis: () => Date.now() + 60_000 });
  const past = () => ({ toMillis: () => Date.now() - 60_000 });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('requires email and code', async () => {
    await expect(verifyHandler({ data: { email: EMAIL } })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('returns not-found when there is no pending code', async () => {
    mockOtpGet.mockResolvedValue({ exists: false });
    await expect(verifyHandler({ data: { email: EMAIL, code: '123456' } })).rejects.toMatchObject({ code: 'not-found' });
  });

  it('rejects an expired code', async () => {
    mockOtpGet.mockResolvedValue({ exists: true, data: () => ({ expiresAt: past(), attempts: 0, codeHash: hashCode('123456') }) });
    await expect(verifyHandler({ data: { email: EMAIL, code: '123456' } })).rejects.toMatchObject({ code: 'deadline-exceeded' });
  });

  it('rejects after too many attempts', async () => {
    mockOtpGet.mockResolvedValue({ exists: true, data: () => ({ expiresAt: future(), attempts: 5, codeHash: hashCode('123456') }) });
    await expect(verifyHandler({ data: { email: EMAIL, code: '123456' } })).rejects.toMatchObject({ code: 'resource-exhausted' });
  });

  it('increments attempts and rejects a wrong code', async () => {
    mockOtpGet.mockResolvedValue({ exists: true, data: () => ({ expiresAt: future(), attempts: 1, codeHash: hashCode('654321') }) });
    await expect(verifyHandler({ data: { email: EMAIL, code: '000000' } })).rejects.toMatchObject({ code: 'invalid-argument' });
    expect(mockOtpUpdate).toHaveBeenCalledWith({ attempts: 2 });
  });

  it('verifies a correct code and marks the record verified', async () => {
    mockOtpGet.mockResolvedValue({ exists: true, data: () => ({ expiresAt: future(), attempts: 0, codeHash: hashCode('246810') }) });
    const res = await verifyHandler({ data: { email: EMAIL, code: '246810' } });
    expect(res).toEqual({ verified: true });
    expect(mockOtpUpdate).toHaveBeenCalledWith(expect.objectContaining({ verified: true }));
  });
});
