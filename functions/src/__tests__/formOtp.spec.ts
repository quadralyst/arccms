/**
 * U5 server-authoritative form OTP. These tests are the guard on a security fix:
 * codes used to be generated in the browser, stored in plaintext on a
 * publicly-readable doc, and compared client-side.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, mockQueueEmail, mockGetTemplate } = vi.hoisted(() => ({
  store: new Map<string, any>(),
  mockQueueEmail: vi.fn(),
  mockGetTemplate: vi.fn(),
}));

function docRef(path: string) {
  return {
    path,
    get: vi.fn(async () => ({ exists: store.has(path), data: () => store.get(path) })),
    set: vi.fn(async (data: any, opts?: any) => {
      store.set(path, opts?.merge ? { ...(store.get(path) || {}), ...data } : data);
    }),
    update: vi.fn(async (data: any) => {
      store.set(path, { ...(store.get(path) || {}), ...data });
    }),
  };
}

function collectionApi(col: string): any {
  return {
    doc: (id: string) => ({
      ...docRef(`${col}/${id}`),
      collection: (sub: string) => collectionApi(`${col}/${id}/${sub}`),
    }),
    where: (field: string, _op: string, value: any) => ({
      limit: () => ({
        get: async () => {
          const docs = [...store.entries()]
            .filter(([path]) => path.startsWith(`${col}/`) && !path.slice(col.length + 1).includes('/'))
            .filter(([, data]) => data?.[field] === value)
            .map(([path]) => ({ id: path.split('/').pop(), ref: docRef(path), data: () => store.get(path) }));
          return { empty: docs.length === 0, docs };
        },
      }),
    }),
  };
}

vi.mock('../init', () => ({ db: { collection: vi.fn((col: string) => collectionApi(col)) } }));
vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));
vi.mock('../utils/emailTemplateHelper', () => ({ getEmailTemplate: mockGetTemplate }));
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
import { computeEmailHash } from '../email-core/unsubscribeToken.js';

const WL = 'wl-1';
const EMAIL = 'a@x.com';
const HASH = computeEmailHash(EMAIL);
const OTP_DOC = `form_otps/${WL}_${HASH}`;

const request = (data: any) => ({ data } as any);
const sentCode = (): string => mockQueueEmail.mock.calls.at(-1)![0].data.otp;

describe('form OTP (U5)', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    mockQueueEmail.mockResolvedValue({ id: 'log-1', status: 'pending' });
    mockGetTemplate.mockResolvedValue({
      senderEmail: 's@x.com', senderName: 'Site', subject: 'Verify',
      template: '<p>##OTP##</p>', isActive: true,
    });
  });

  describe('requestFormOtp', () => {
    it('sends a code and stores it hashed, never in plaintext', async () => {
      const res = await (requestFormOtp as any)(request({ waitlistId: WL, email: EMAIL }));

      expect(res).toEqual({ sent: true, status: 'pending' });
      const doc = store.get(OTP_DOC);
      const code = sentCode();
      expect(code).toMatch(/^\d{6}$/);
      // The whole point: the doc must not contain the code itself.
      expect(JSON.stringify(doc)).not.toContain(code);
      expect(doc.codeHash).toMatch(/^[a-f0-9]{64}$/);
    });

    it('uses the form-specific template', async () => {
      await (requestFormOtp as any)(request({ waitlistId: WL, email: EMAIL }));
      expect(mockGetTemplate).toHaveBeenCalledWith(WL, 'waitlist_verify_otp_email');
    });

    it('throttles a resend within 60s', async () => {
      await (requestFormOtp as any)(request({ waitlistId: WL, email: EMAIL }));
      await expect(
        (requestFormOtp as any)(request({ waitlistId: WL, email: EMAIL })),
      ).rejects.toThrow(/wait \d+s/);
    });

    it('scopes codes per form, so one form cannot verify another', async () => {
      await (requestFormOtp as any)(request({ waitlistId: WL, email: EMAIL }));
      const codeA = sentCode();
      // A different form is a different doc, so no throttle collision either.
      await (requestFormOtp as any)(request({ waitlistId: 'wl-2', email: EMAIL }));

      expect(store.has(OTP_DOC)).toBe(true);
      expect(store.has(`form_otps/wl-2_${HASH}`)).toBe(true);

      // Form A's code must not verify on form B.
      await expect(
        (verifyFormOtp as any)(request({ waitlistId: 'wl-2', email: EMAIL, code: codeA })),
      ).rejects.toThrow(/Invalid verification code/);
    });

    it('rejects a missing form or bad email', async () => {
      await expect((requestFormOtp as any)(request({ email: EMAIL }))).rejects.toThrow(/waitlistId/);
      await expect((requestFormOtp as any)(request({ waitlistId: WL, email: 'nope' }))).rejects.toThrow(/valid email/);
    });

    it('reports sent:false (not an error) when email is switched off', async () => {
      mockQueueEmail.mockResolvedValue({ id: 'log', status: 'skipped', skipReason: 'email_disabled' });

      const res = await (requestFormOtp as any)(request({ waitlistId: WL, email: EMAIL }));

      expect(res).toEqual({ sent: false, status: 'skipped' });
    });

    it('fails clearly when the form has no template', async () => {
      mockGetTemplate.mockRejectedValue(new Error('no template'));
      await expect(
        (requestFormOtp as any)(request({ waitlistId: WL, email: EMAIL })),
      ).rejects.toThrow(/no verification email template/i);
    });
  });

  describe('verifyFormOtp', () => {
    beforeEach(async () => {
      await (requestFormOtp as any)(request({ waitlistId: WL, email: EMAIL }));
    });

    it('accepts the right code and marks the record verified', async () => {
      const res = await (verifyFormOtp as any)(request({ waitlistId: WL, email: EMAIL, code: sentCode() }));

      expect(res.verified).toBe(true);
      expect(store.get(OTP_DOC).verified).toBe(true);
    });

    it('flips the member doc server-side and clears the legacy plaintext field', async () => {
      store.set(`Waitlists/${WL}/users/u1`, { email: EMAIL, emailVerified: false, verificationCode: '123456' });

      const res = await (verifyFormOtp as any)(request({ waitlistId: WL, email: EMAIL, code: sentCode() }));

      expect(res.memberVerified).toBe(true);
      const member = store.get(`Waitlists/${WL}/users/u1`);
      expect(member.emailVerified).toBe(true);
      expect(member.verificationCode).toBe('');
    });

    it('rejects a wrong code and counts the attempt', async () => {
      await expect(
        (verifyFormOtp as any)(request({ waitlistId: WL, email: EMAIL, code: '000000' })),
      ).rejects.toThrow(/Invalid verification code/);
      expect(store.get(OTP_DOC).attempts).toBe(1);
      expect(store.get(OTP_DOC).verified).toBe(false);
    });

    it('locks out after 5 attempts', async () => {
      for (let i = 0; i < 5; i++) {
        await expect(
          (verifyFormOtp as any)(request({ waitlistId: WL, email: EMAIL, code: '000000' })),
        ).rejects.toThrow(/Invalid verification code/);
      }
      // Even the CORRECT code is refused once the cap is hit.
      await expect(
        (verifyFormOtp as any)(request({ waitlistId: WL, email: EMAIL, code: sentCode() })),
      ).rejects.toThrow(/Too many attempts/);
    });

    it('rejects an expired code', async () => {
      store.set(OTP_DOC, { ...store.get(OTP_DOC), expiresAt: { toMillis: () => Date.now() - 1000 } });
      await expect(
        (verifyFormOtp as any)(request({ waitlistId: WL, email: EMAIL, code: sentCode() })),
      ).rejects.toThrow(/expired/);
    });

    it('rejects when no code was ever requested', async () => {
      await expect(
        (verifyFormOtp as any)(request({ waitlistId: WL, email: 'other@x.com', code: '123456' })),
      ).rejects.toThrow(/No verification code found/);
    });

    it('requires all three arguments', async () => {
      await expect((verifyFormOtp as any)(request({ waitlistId: WL, email: EMAIL }))).rejects.toThrow(/required/);
      await expect((verifyFormOtp as any)(request({ email: EMAIL, code: '1' }))).rejects.toThrow(/required/);
    });

    it('succeeds even when there is no member doc yet', async () => {
      // The caller may verify before the member doc exists; that must not fail
      // the verification itself.
      const res = await (verifyFormOtp as any)(request({ waitlistId: WL, email: EMAIL, code: sentCode() }));
      expect(res).toMatchObject({ verified: true, memberVerified: false });
    });
  });
});
