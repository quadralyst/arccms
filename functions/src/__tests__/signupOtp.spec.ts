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
  mockOtpDelete,
  mockTemplateGet,
  mockQueueEmail,
  mockEnsureDefaults,
  mockEmailSettingsGet,
} = vi.hoisted(() => ({
  mockOtpGet: vi.fn(),
  mockOtpSet: vi.fn().mockResolvedValue(undefined),
  mockOtpUpdate: vi.fn().mockResolvedValue(undefined),
  mockOtpDelete: vi.fn().mockResolvedValue(undefined),
  mockTemplateGet: vi.fn(),
  mockQueueEmail: vi.fn().mockResolvedValue({ id: 'log-1', status: 'pending' }),
  mockEnsureDefaults: vi.fn().mockResolvedValue({ created: [], skipped: [] }),
  mockEmailSettingsGet: vi.fn(),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'signup_otps') {
        return {
          doc: vi.fn().mockReturnValue({ get: mockOtpGet, set: mockOtpSet, update: mockOtpUpdate, delete: mockOtpDelete }),
        };
      }
      if (name === 'EmailTemplate') {
        return { where: vi.fn().mockReturnValue({ limit: vi.fn().mockReturnValue({ get: mockTemplateGet }) }) };
      }
      if (name === 'Settings') {
        return { doc: vi.fn().mockReturnValue({ get: mockEmailSettingsGet }) };
      }
      return {};
    }),
    // A transaction that reads and writes through the same document mocks.
    runTransaction: vi.fn((fn: (tx: any) => Promise<unknown>) => fn({
      get: (ref: any) => ref.get(),
      set: (ref: any, data: unknown) => ref.set(data),
      update: (ref: any, data: unknown) => ref.update(data),
      delete: (ref: any) => ref.delete?.(),
    })),
  },
}));

const { mockRateLimit, mockRelease } = vi.hoisted(() => ({
  mockRateLimit: vi.fn().mockResolvedValue(undefined),
  mockRelease: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../auth/accounts', () => ({
  callerKey: () => 'caller', consumeRateLimit: mockRateLimit, releaseRateLimit: mockRelease, pinPepper: async () => 'test-pepper',
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
    details: unknown;
    constructor(code: string, message: string, details?: unknown) {
      super(message);
      this.code = code;
      this.details = details;
    }
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: vi.fn(() => ({ seconds: 0, nanoseconds: 0 })),
    fromMillis: vi.fn((ms: number) => ({ toMillis: () => ms })),
  },
}));

import { issueEmailOtp, requestSignupOtp, verifySignupOtp } from '../auth/signupOtp.js';
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
    mockEmailSettingsGet.mockResolvedValue({ data: () => ({ isEnabled: true, activeProvider: 'resend' }) });
  });

  it('limits codes per caller and per address (review F)', async () => {
    await reqHandler({ data: { email: EMAIL } });
    expect(mockRateLimit).toHaveBeenCalledWith('email-otp-ip-caller', 20, 3_600_000, expect.any(String));
    expect(mockRateLimit).toHaveBeenCalledWith(`email-otp-${HASH}`, 5, 3_600_000, expect.any(String), 'too-many-codes');
  });

  it('checks the one-minute wait before counting, so a refused send uses up nothing (SC-D3)', async () => {
    mockOtpGet.mockResolvedValue({ exists: true, data: () => ({ lastSentAt: { toMillis: () => Date.now() - 21_000 } }) });
    const refused = await reqHandler({ data: { email: EMAIL } }).catch((e: any) => e);
    expect(refused).toMatchObject({ code: 'resource-exhausted', details: { reason: 'wait' } });
    expect(refused.details.wait).toBeGreaterThanOrEqual(38);
    expect(refused.details.wait).toBeLessThanOrEqual(40);
    expect(mockRateLimit).not.toHaveBeenCalled();
  });

  it('gives the counts back when the code could not be sent (SC-D4)', async () => {
    mockTemplateGet.mockResolvedValue({ empty: true, docs: [] });
    await expect(reqHandler({ data: { email: EMAIL } })).rejects.toMatchObject({ details: { reason: 'email-failed' } });
    expect(mockRelease).toHaveBeenCalledWith('email-otp-ip-caller');
    expect(mockRelease).toHaveBeenCalledWith(`email-otp-${HASH}`);
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
      // sent by this call, not after the email trigger's cold start
      sendNow: true,
    }));
  });

  it('answers a warm-up call at once, before any limit, read or email', async () => {
    await expect(reqHandler({ data: { warmUp: true } })).resolves.toEqual({ warm: true });
    await expect(verifyHandler({ data: { warmUp: true } })).resolves.toEqual({ warm: true });
    expect(mockRateLimit).not.toHaveBeenCalled();
    expect(mockOtpGet).not.toHaveBeenCalled();
    expect(mockQueueEmail).not.toHaveBeenCalled();
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

  describe('with the Simulated provider, which sends nothing', () => {
    const simulated = () => mockEmailSettingsGet.mockResolvedValue({ data: () => ({ isEnabled: true, activeProvider: 'debug_log' }) });

    it('hands the sign-up code back, so the page can show it', async () => {
      simulated();
      const res = await reqHandler({ data: { email: EMAIL } });
      const emailed = mockQueueEmail.mock.calls[0][0].data.otp;
      expect(res).toEqual({ sent: true, status: 'pending', testMode: true, testCode: emailed });
      expect(mockOtpSet.mock.calls[0][0].codeHash).toBe(hashCode(emailed));
    });

    it('never hands back a link code: it would let anyone add any address to their account', async () => {
      simulated();
      const res = await issueEmailOtp(EMAIL, 'link', { uid: 'uid-a' });
      expect(res).toEqual({ sent: true, status: 'pending', testMode: true });
    });

    it('hands back nothing when the email was not queued, and leaves no code that was never sent (F22)', async () => {
      simulated();
      mockQueueEmail.mockResolvedValue({ id: 'log-1', status: 'skipped' });
      expect(await reqHandler({ data: { email: EMAIL } })).toEqual({ sent: false, status: 'skipped' });
      expect(mockOtpDelete).toHaveBeenCalledTimes(1);
    });

    it('hands back nothing while email is switched off', async () => {
      mockEmailSettingsGet.mockResolvedValue({ data: () => ({ isEnabled: false, activeProvider: 'debug_log' }) });
      expect(await reqHandler({ data: { email: EMAIL } })).toEqual({ sent: true, status: 'pending' });
    });
  });

  it('hands back no code with a real provider', async () => {
    const res = await reqHandler({ data: { email: EMAIL } });
    expect(res).toEqual({ sent: true, status: 'pending' });
    expect(res.testCode).toBeUndefined();
  });

  describe('one code at a time (specs/sign-in-codes-spec.md, SC4)', () => {
    // Fixed when made, not when read: a time read later would be younger than asked, and
    // "30 minutes ago" would fall a few milliseconds inside the 30-minute limit.
    const minutesAgo = (m: number) => { const at = Date.now() - m * 60_000; return { toMillis: () => at }; };
    /** Send once, then let the next read see what was stored, a minute later. */
    async function sendFirst(fields: Record<string, unknown> = {}): Promise<string> {
      await reqHandler({ data: { email: EMAIL } });
      const stored = mockOtpSet.mock.calls[0][0];
      mockOtpGet.mockResolvedValue({ exists: true, data: () => ({ ...stored, lastSentAt: minutesAgo(2), ...fields }) });
      return mockQueueEmail.mock.calls[0][0].data.otp;
    }

    it('emails the same code again while it still works, its tries kept (SC-D9, SC-D11)', async () => {
      const code = await sendFirst({ attempts: 2 });
      const res = await reqHandler({ data: { email: EMAIL } });
      expect(res).toEqual({ sent: true, status: 'pending', sameCode: true });
      expect(mockQueueEmail.mock.calls[1][0].data.otp).toBe(code);
      expect(mockOtpSet).toHaveBeenCalledTimes(1);
      const update = mockOtpUpdate.mock.calls[0][0];
      expect(Object.keys(update).sort()).toEqual(['expiresAt', 'lastSentAt']);
      expect(update.expiresAt.toMillis() - Date.now()).toBeGreaterThan(9 * 60_000);
    });

    it('stores the code sealed, never as it is (SC-D10)', async () => {
      const code = await sendFirst();
      const stored = mockOtpSet.mock.calls[0][0];
      expect(stored.codeSealed).toMatch(/^v1\./);
      expect(JSON.stringify(stored)).not.toContain(code);
    });

    it.each([
      ['expired', { expiresAt: minutesAgo(1) }],
      ['out of tries', { attempts: 5 }],
      ['verified', { verified: true }],
      ['made 30 minutes ago', { issuedAt: minutesAgo(30) }],
      ['a link code', { purpose: 'link', uid: 'uid-a' }],
    ])('emails a new code when the old one is %s', async (_, fields) => {
      await sendFirst(fields);
      const res = await reqHandler({ data: { email: EMAIL } });
      expect(res.sameCode).toBeUndefined();
      expect(mockOtpSet).toHaveBeenCalledTimes(2);
      expect(mockOtpSet.mock.calls[1][0].attempts).toBe(0);
    });

    it('answers a request inside the minute with the code already sent, emailing and counting nothing (F22)', async () => {
      mockEmailSettingsGet.mockResolvedValue({ data: () => ({ isEnabled: true, activeProvider: 'debug_log' }) });
      const code = await sendFirst({ lastSentAt: minutesAgo(1 / 3) });
      mockRateLimit.mockClear();
      const res = await reqHandler({ data: { email: EMAIL } });
      expect(res).toEqual({ sent: true, status: 'pending', testMode: true, testCode: code, alreadySent: true, wait: expect.any(Number) });
      expect(res.wait).toBeGreaterThanOrEqual(39);
      expect(res.wait).toBeLessThanOrEqual(40);
      expect(mockQueueEmail).toHaveBeenCalledTimes(1);
      expect(mockRateLimit).not.toHaveBeenCalled();
    });

    it('a same code that could not be sent keeps its old times, so nobody is told it went (F22)', async () => {
      await sendFirst();
      mockQueueEmail.mockResolvedValueOnce({ id: 'log-2', status: 'skipped' });
      const res = await reqHandler({ data: { email: EMAIL } });
      expect(res).toEqual({ sent: false, status: 'skipped', sameCode: true });
      const restored = mockOtpUpdate.mock.calls.at(-1)![0];
      expect(Object.keys(restored).sort()).toEqual(['expiresAt', 'lastSentAt']);
      expect(Date.now() - restored.lastSentAt.toMillis()).toBeGreaterThanOrEqual(2 * 60_000 - 1000);
      expect(mockOtpDelete).not.toHaveBeenCalled();
    });

    it('a link code sent inside the minute never holds back a sign-up code (F22)', async () => {
      await sendFirst({ purpose: 'link', uid: 'uid-a', lastSentAt: minutesAgo(1 / 6) });
      const res = await reqHandler({ data: { email: EMAIL } });
      expect(res).toEqual({ sent: true, status: 'pending' });
      expect(mockOtpSet).toHaveBeenCalledTimes(2);
      expect(mockOtpSet.mock.calls[1][0].purpose).toBe('signup');
    });

    it('keeps a link code for the account that asked for it', async () => {
      await issueEmailOtp(EMAIL, 'link', { uid: 'uid-a' });
      const stored = mockOtpSet.mock.calls[0][0];
      mockOtpGet.mockResolvedValue({ exists: true, data: () => ({ ...stored, lastSentAt: minutesAgo(2) }) });
      expect(await issueEmailOtp(EMAIL, 'link', { uid: 'uid-a' })).toMatchObject({ sameCode: true });
      expect(await issueEmailOtp(EMAIL, 'link', { uid: 'uid-b' })).not.toHaveProperty('sameCode');
    });
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
    mockOtpGet.mockResolvedValue({ exists: false, data: () => undefined });
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
    // The ticket goes back to this browser; only its hash is stored (review F).
    expect(res).toEqual({ verified: true, ticket: expect.stringMatching(/^[\w-]{32}$/) });
    expect(mockOtpUpdate).toHaveBeenCalledWith(expect.objectContaining({
      verified: true, attempts: 1, ticketHash: createHash('sha256').update(res.ticket).digest('hex'),
    }));
  });
});
