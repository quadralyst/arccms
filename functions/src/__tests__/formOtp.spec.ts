/**
 * U5 server-authoritative form OTP. These tests are the guard on a security fix:
 * codes used to be generated in the browser, stored in plaintext on a
 * publicly-readable doc, and compared client-side.
 *
 * Both callables now take the ticket joinForm gave, not an address, need the form
 * to be open, and are limited per caller and per address. Wrong guesses are
 * counted inside a transaction, so guesses sent together cannot pass the cap.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, mockQueueEmail, mockGetTemplate, mockConsume, mockRelease, mockBeforeCheck, mockCountWrong } = vi.hoisted(() => ({
  store: new Map<string, any>(),
  mockBeforeCheck: vi.fn(),
  mockCountWrong: vi.fn(),
  mockQueueEmail: vi.fn(),
  mockGetTemplate: vi.fn(),
  mockConsume: vi.fn(),
  mockRelease: vi.fn(),
}));

function docRef(path: string): any {
  return {
    path,
    get: vi.fn(async () => ({ exists: store.has(path), data: () => store.get(path) })),
    set: vi.fn(async (data: any, opts?: any) => {
      store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data);
    }),
    update: vi.fn(async (data: any) => {
      store.set(path, { ...(store.get(path) || {}), ...data });
    }),
    collection: (sub: string) => collectionApi(`${path}/${sub}`),
  };
}

function collectionApi(col: string): any {
  return { doc: (id: string) => docRef(`${col}/${id}`) };
}

// Transactions run one at a time, as Firestore's retries make them behave: a
// transaction that read a document another one changed runs again.
let queue: Promise<unknown> = Promise.resolve();
function runTransaction(fn: (tx: any) => Promise<any>): Promise<any> {
  const run = queue.then(async () => {
    const writes: (() => void)[] = [];
    const tx = {
      get: async (ref: any) => {
        await new Promise((r) => setTimeout(r, 0));
        return ref.get();
      },
      update: (ref: any, data: any) => writes.push(() => store.set(ref.path, { ...(store.get(ref.path) || {}), ...data })),
      set: (ref: any, data: any, opts?: any) => writes.push(() => store.set(ref.path, opts?.merge ? { ...(store.get(ref.path) || {}), ...data } : data)),
    };
    const result = await fn(tx);
    writes.forEach((w) => w());
    return result;
  });
  queue = run.catch(() => undefined);
  return run;
}

vi.mock('../init', () => ({ db: { collection: vi.fn((col: string) => collectionApi(col)), runTransaction } }));
vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));
vi.mock('../utils/emailTemplateHelper', () => ({ getEmailTemplate: mockGetTemplate }));
vi.mock('../email-core/unsubscribeSecret', () => ({ getUnsubscribeSecret: async () => 's'.repeat(64) }));
vi.mock('../auth/accounts', () => ({
  callerKey: () => 'ip-hash',
  consumeRateLimits: mockConsume,
  releaseRateLimit: mockRelease,
}));
vi.mock('../auth/codeGuesses', () => ({ beforeCodeCheck: mockBeforeCheck, countWrongCode: mockCountWrong }));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));
vi.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    now: () => ({ toMillis: () => Date.now() }),
    fromMillis: (ms: number) => ({ toMillis: () => ms }),
  },
}));
vi.mock('../constant', () => ({
  constant: { isProduction: false, live_url: 'https://x/', local_url: 'http://l/' },
}));

import { requestFormOtp, verifyFormOtp } from '../waitlists/formOtp.js';
import { issueFormTicket } from '../waitlists/formTicket.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';

const WL = 'wl-1';
const EMAIL = 'a@x.com';
const HASH = computeEmailHash(EMAIL);
const OTP_DOC = `form_otps/${WL}_${HASH}`;
const MEMBER = `Waitlists/${WL}/users/m1`;

const request = (data: any) => ({ data, rawRequest: { headers: {}, ip: '1.2.3.4' } } as any);
const sentCode = (): string => mockQueueEmail.mock.calls.at(-1)![0].data.otp;
let ticket: string;
const ask = (data: any = {}) => (requestFormOtp as any)(request({ waitlistId: WL, ticket, ...data }));
const check = (code: string, data: any = {}) => (verifyFormOtp as any)(request({ waitlistId: WL, ticket, code, ...data }));

describe('form OTP (U5)', () => {
  beforeEach(async () => {
    store.clear();
    vi.clearAllMocks();
    store.set(`Waitlists/${WL}`, { name: 'Launch', isActive: true });
    store.set(`Waitlists/wl-2`, { name: 'Other' });
    store.set(MEMBER, { email: EMAIL, firstName: 'Asha', emailVerified: false });
    ticket = await issueFormTicket(WL, 'm1');
    mockConsume.mockImplementation(async (limits: { key: string }[]) => limits.map((l) => l.key));
    mockQueueEmail.mockResolvedValue({ id: 'log-1', status: 'pending' });
    mockGetTemplate.mockResolvedValue({
      senderEmail: 's@x.com', senderName: 'Site', subject: 'Verify',
      template: '<p>##OTP##</p>', isActive: true,
    });
  });

  describe('requestFormOtp', () => {
    it('sends a code and stores it hashed, never in plaintext', async () => {
      const res = await ask();

      expect(res).toEqual({ sent: true, status: 'pending' });
      const doc = store.get(OTP_DOC);
      const code = sentCode();
      expect(code).toMatch(/^\d{6}$/);
      // The whole point: the doc must not contain the code itself.
      expect(JSON.stringify(doc)).not.toContain(code);
      expect(doc.codeHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('uses the form-specific template', async () => {
      await ask();
      expect(mockGetTemplate).toHaveBeenCalledWith(WL, 'waitlist_verify_otp_email');
    });

    it('throttles a resend within 60s', async () => {
      await ask();
      await expect(
        ask(),
      ).rejects.toThrow(/wait \d+s/);
    });

    it('scopes codes per form, so one form cannot verify another', async () => {
      await ask();
      const codeA = sentCode();
      // A different form is a different doc, so no throttle collision either.
      store.set('Waitlists/wl-2/users/m2', { email: EMAIL });
      const ticketB = await issueFormTicket('wl-2', 'm2');
      await (requestFormOtp as any)(request({ waitlistId: 'wl-2', ticket: ticketB }));

      expect(store.has(OTP_DOC)).toBe(true);
      expect(store.has(`form_otps/wl-2_${HASH}`)).toBe(true);

      // Form A's code must not verify on form B.
      await expect(
        (verifyFormOtp as any)(request({ waitlistId: 'wl-2', ticket: ticketB, code: codeA })),
      ).rejects.toThrow(/Invalid verification code/);
    });

    it('rejects a missing form id', async () => {
      await expect((requestFormOtp as any)(request({ ticket }))).rejects.toThrow(/waitlistId/);
    });

    it('sends only to the member the ticket names, whatever address the caller adds', async () => {
      await ask({ email: 'victim@x.com', name: '<b>Click here</b>' });
      expect(mockQueueEmail).toHaveBeenCalledTimes(1);
      expect(mockQueueEmail.mock.calls[0][0]).toMatchObject({ toEmail: EMAIL, toName: 'Asha' });
    });

    it('refuses without a good ticket: a raw member id, another form\'s, or none', async () => {
      const other = await issueFormTicket('wl-2', 'm1');
      for (const bad of [undefined, 'm1', other]) {
        await expect(ask({ ticket: bad })).rejects.toMatchObject({ code: 'permission-denied' });
      }
      expect(mockQueueEmail).not.toHaveBeenCalled();
    });

    it('refuses on a form that is closed or gone', async () => {
      store.set(`Waitlists/${WL}`, { isActive: false });
      await expect(ask()).rejects.toMatchObject({ code: 'failed-precondition' });
      store.delete(`Waitlists/${WL}`);
      await expect(ask()).rejects.toMatchObject({ code: 'not-found' });
      expect(mockQueueEmail).not.toHaveBeenCalled();
    });

    it('counts each code against the caller (60 an hour, for shared networks) and the address (5 an hour)', async () => {
      await ask();
      expect(mockConsume).toHaveBeenCalledWith([
        expect.objectContaining({ key: 'form-otp-ip-ip-hash', max: 60, windowMs: 3600000 }),
        expect.objectContaining({ key: `form-otp-${HASH}`, max: 5, windowMs: 3600000 }),
      ]);
    });

    it('sends nothing once a limit is reached', async () => {
      mockConsume.mockRejectedValueOnce(Object.assign(new Error('Too many codes for this address. Please try again later.'), { code: 'resource-exhausted' }));
      await expect(ask()).rejects.toMatchObject({ code: 'resource-exhausted' });
      expect(mockQueueEmail).not.toHaveBeenCalled();
      expect(store.has(OTP_DOC)).toBe(false);
    });

    it('does not count a resend refused within the minute', async () => {
      await ask();
      mockConsume.mockClear();
      await expect(ask()).rejects.toThrow(/wait \d+s/);
      expect(mockConsume).not.toHaveBeenCalled();
    });

    it('gives the counts back when the code could not be queued', async () => {
      mockQueueEmail.mockRejectedValueOnce(new Error('queue down'));
      await expect(ask()).rejects.toThrow('queue down');
      expect(mockRelease.mock.calls.map((c) => c[0])).toEqual(['form-otp-ip-ip-hash', `form-otp-${HASH}`]);
    });

    it('reports sent:false (not an error) when email is switched off', async () => {
      mockQueueEmail.mockResolvedValue({ id: 'log', status: 'skipped', skipReason: 'email_disabled' });

      const res = await ask();

      expect(res).toEqual({ sent: false, status: 'skipped' });
    });

    it('sends one code for two requests at the same moment, and gives the second its counts back', async () => {
      const results = await Promise.allSettled([ask(), ask()]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason.message).toMatch(/wait \d+s/);
      expect(mockQueueEmail).toHaveBeenCalledTimes(1);
      // The stored code is the one emailed.
      const verified = await check(sentCode());
      expect(verified.verified).toBe(true);
      expect(mockRelease).toHaveBeenCalledTimes(2);
    });

    it('answers as for a sent code when the address is disabled or suppressed, so nothing about it shows', async () => {
      for (const [status, skipReason] of [['skipped', 'contact_disabled'], ['suppressed', 'suppressed'], ['skipped', 'unsubscribed']]) {
        store.delete(OTP_DOC);
        mockQueueEmail.mockResolvedValueOnce({ id: 'log', status, skipReason });
        expect(await ask()).toEqual({ sent: true, status: 'pending' });
      }
    });

    it('fails clearly when the form has no template', async () => {
      mockGetTemplate.mockRejectedValue(new Error('no template'));
      await expect(
        ask(),
      ).rejects.toThrow(/no verification email template/i);
    });
  });

  describe('verifyFormOtp', () => {
    beforeEach(async () => {
      await ask();
    });

    it('accepts the right code and marks the record verified', async () => {
      const res = await check(sentCode());

      expect(res.verified).toBe(true);
      expect(store.get(OTP_DOC).verified).toBe(true);
    });

    it('flips the member doc server-side and clears the legacy plaintext field', async () => {
      store.set(MEMBER, { ...store.get(MEMBER), verificationCode: '123456' });

      const res = await check(sentCode());

      expect(res.memberVerified).toBe(true);
      const member = store.get(MEMBER);
      expect(member.emailVerified).toBe(true);
      expect(member.verificationCode).toBe('');
    });

    it('rejects a wrong code and counts the attempt', async () => {
      await expect(
        check('000000'),
      ).rejects.toThrow(/Invalid verification code/);
      expect(store.get(OTP_DOC).attempts).toBe(1);
      expect(store.get(OTP_DOC).verified).toBe(false);
    });

    it('counts a wrong code against the address for the day, apart from its sign-in codes', async () => {
      await expect(check('000000')).rejects.toThrow(/Invalid verification code/);
      expect(mockBeforeCheck).toHaveBeenCalledWith({ via: 'form', hash: HASH }, expect.anything());
      expect(mockCountWrong).toHaveBeenCalledWith({ via: 'form', hash: HASH });
      await check(sentCode());
      expect(mockCountWrong).toHaveBeenCalledTimes(1);
    });

    it('refuses every check once the address used up its wrong codes for the day, a right one too', async () => {
      mockBeforeCheck.mockRejectedValueOnce(Object.assign(new Error('Too many wrong codes. Please try again tomorrow.'), { code: 'resource-exhausted' }));
      await expect(check(sentCode())).rejects.toThrow(/Too many wrong codes/);
      expect(store.get(OTP_DOC).verified).toBe(false);
    });

    it('locks out after 5 attempts', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(
          check('000000'),
        ).rejects.toThrow(/Invalid verification code/);
      }
      // Even the CORRECT code is refused once the cap is hit.
      await expect(
        check(sentCode()),
      ).rejects.toThrow(/Too many attempts/);
    });

    it('rejects an expired code', async () => {
      store.set(OTP_DOC, { ...store.get(OTP_DOC), expiresAt: { toMillis: () => Date.now() - 1000 } });
      await expect(
        check(sentCode()),
      ).rejects.toThrow(/expired/);
    });

    it('rejects when no code was ever requested', async () => {
      store.set('Waitlists/wl-1/users/m9', { email: 'other@x.com' });
      const other = await issueFormTicket(WL, 'm9');
      await expect(check('123456', { ticket: other })).rejects.toThrow(/No verification code found/);
    });

    it('requires a form id and a 6-digit code', async () => {
      await expect((verifyFormOtp as any)(request({ waitlistId: WL, ticket }))).rejects.toThrow(/6-digit/);
      await expect(check('12345')).rejects.toThrow(/6-digit/);
      await expect((verifyFormOtp as any)(request({ ticket, code: '123456' }))).rejects.toThrow(/waitlistId/);
    });

    it('checks the code of the member the ticket names, never an address the caller gives', async () => {
      await expect(check(sentCode(), { ticket: 'm1', email: EMAIL })).rejects.toMatchObject({ code: 'permission-denied' });
      expect(store.get(OTP_DOC).verified).toBe(false);
    });

    it('refuses on a closed form', async () => {
      store.set(`Waitlists/${WL}`, { isActive: false });
      await expect(check(sentCode())).rejects.toMatchObject({ code: 'failed-precondition' });
      expect(store.get(OTP_DOC).verified).toBe(false);
    });

    it('counts guesses sent at the same moment, so they cannot pass the cap of 5', async () => {
      const results = await Promise.allSettled(Array.from({ length: 12 }, () => check('000000')));
      const messages = results.map((r) => (r as PromiseRejectedResult).reason.message);
      expect(messages.filter((m) => /Invalid verification code/.test(m))).toHaveLength(5);
      expect(messages.filter((m) => /Too many attempts/.test(m))).toHaveLength(7);
      expect(store.get(OTP_DOC).attempts).toBe(5);
      await expect(check(sentCode())).rejects.toThrow(/Too many attempts/);
    });

    it('makes codes from the secure random source, not Math.random', async () => {
      const source = (await import('node:fs')).readFileSync(new URL('../waitlists/formOtp.ts', import.meta.url), 'utf8');
      expect(source).toContain('randomInt(100000, 1000000)');
      expect(source).not.toMatch(/Math\.random/);
    });
  });
});
