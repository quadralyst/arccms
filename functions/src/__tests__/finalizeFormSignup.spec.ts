/**
 * U5 item 5: server-authoritative signup completion.
 *
 * These tests guard a security fix. `emailVerified`, `isConfirmed`, `queuePosition`
 * and `verifiedAt` used to be written by the browser, which forced firestore.rules
 * to allow unauthenticated updates to them — so anyone could mark their own address
 * verified or jump the queue with a single Firestore write. The rules whitelist has
 * since been narrowed, and this function is what replaces those writes.
 *
 * The central case is `permission-denied when no verified code exists`: the caller
 * must not be able to *claim* that verification was unnecessary.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, mockGetTemplate } = vi.hoisted(() => ({
  store: new Map<string, any>(),
  mockGetTemplate: vi.fn(),
}));

/** Confirmed-member count used by the count() aggregate below. */
function membersOf(waitlistId: string) {
  const prefix = `Waitlists/${waitlistId}/users/`;
  return [...store.entries()].filter(([path]) => path.startsWith(prefix));
}

function docRef(path: string): any {
  return {
    path,
    get: vi.fn(async () => ({ exists: store.has(path), data: () => store.get(path) })),
    update: vi.fn(async (data: any) => {
      const next = { ...(store.get(path) || {}) };
      for (const [key, value] of Object.entries(data)) {
        if ((value as any)?.__delete) delete next[key];
        else if ((value as any)?.__arrayUnion) {
          next[key] = [...new Set([...(next[key] || []), ...(value as any).__arrayUnion])];
        } else next[key] = value;
      }
      store.set(path, next);
    }),
    collection: (sub: string) => collectionApi(`${path}/${sub}`),
  };
}

function collectionApi(col: string): any {
  return {
    doc: (id: string) => docRef(`${col}/${id}`),
    where: (field: string, _op: string, value: any) => ({
      count: () => ({
        get: async () => {
          const waitlistId = col.split('/')[1];
          const count = membersOf(waitlistId).filter(([, d]) => d?.[field] === value).length;
          return { data: () => ({ count }) };
        },
      }),
    }),
  };
}

vi.mock('../init', () => ({ db: { collection: vi.fn((col: string) => collectionApi(col)) } }));
vi.mock('../email-core/unsubscribeToken', () => ({
  computeEmailHash: (email: string) => `hash_${email}`,
}));
vi.mock('../utils/emailTemplateHelper', () => ({ getEmailTemplate: mockGetTemplate }));
vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));
vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: () => ({ __ts: true }) },
  FieldValue: {
    delete: () => ({ __delete: true }),
    arrayUnion: (...args: unknown[]) => ({ __arrayUnion: args }),
  },
}));

const { finalizeFormSignup } = await import('../waitlists/finalizeFormSignup.js');
const call = (data: any) => (finalizeFormSignup as any)({ data });

/** Email on, provider set, OTP template active ⇒ verification is required. */
function requireOtp() {
  store.set('Settings/email', { isEnabled: true, activeProvider: 'log', features: {} });
  mockGetTemplate.mockResolvedValue({ isActive: true });
}

describe('finalizeFormSignup', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    store.set('Waitlists/w1', { name: 'Form One', totalSignups: 0 });
    store.set('Waitlists/w1/users/u1', {
      email: 'new@example.com',
      firstName: 'New',
      isConfirmed: false,
      emailVerified: false,
    });
  });

  describe('authorization is derived, not supplied', () => {
    it('should refuse to confirm when the form requires an OTP and no verified record exists', async () => {
      requireOtp();

      await expect(call({ waitlistId: 'w1', userId: 'u1' })).rejects.toMatchObject({
        code: 'permission-denied',
      });
      // The member doc must be untouched — no position, no confirmation.
      expect(store.get('Waitlists/w1/users/u1').isConfirmed).toBe(false);
    });

    it('should refuse when a code was requested but never verified', async () => {
      requireOtp();
      store.set('form_otps/w1_hash_new@example.com', { verified: false, attempts: 2 });

      await expect(call({ waitlistId: 'w1', userId: 'u1' })).rejects.toMatchObject({
        code: 'permission-denied',
      });
    });

    it('should ignore a client-supplied claim that verification was not needed', async () => {
      requireOtp();

      // The old client passed its own verification state. Even asserting it here
      // must not unlock the write — the server re-derives it from Settings.
      await expect(
        call({ waitlistId: 'w1', userId: 'u1', emailVerified: true, otpVerified: true, skipOtp: true }),
      ).rejects.toMatchObject({ code: 'permission-denied' });
    });

    it('should confirm with emailVerified=true once a verified record exists', async () => {
      requireOtp();
      store.set('form_otps/w1_hash_new@example.com', { verified: true });

      const result = await call({ waitlistId: 'w1', userId: 'u1' });

      expect(result.emailVerified).toBe(true);
      expect(store.get('Waitlists/w1/users/u1').isConfirmed).toBe(true);
    });
  });

  describe('fails closed when the OTP template cannot be resolved (U5.5)', () => {
    it('should refuse the signup rather than confirm it unverified', async () => {
      // Email is ON, so a code should exist. The old code caught this and returned
      // "OTP not required", which confirmed the contact as unverified and let an
      // unproven address through — the wrong direction to fail in.
      requireOtp();
      mockGetTemplate.mockRejectedValue(new Error('No email template found'));

      await expect(call({ waitlistId: 'w1', userId: 'u1' })).rejects.toMatchObject({
        code: 'failed-precondition',
      });
      expect(store.get('Waitlists/w1/users/u1').isConfirmed).toBe(false);
    });

    it('should still fail closed when a verified OTP record happens to exist', async () => {
      requireOtp();
      mockGetTemplate.mockRejectedValue(new Error('No email template found'));
      store.set('form_otps/w1_hash_new@example.com', { verified: true });

      await expect(call({ waitlistId: 'w1', userId: 'u1' })).rejects.toMatchObject({
        code: 'failed-precondition',
      });
    });

    it('should NOT fail closed when email is switched off entirely', async () => {
      // Nothing could have been sent, so demanding a code would strand every
      // signup. This is the one sanctioned fail-open.
      store.set('Settings/email', { isEnabled: false });
      mockGetTemplate.mockRejectedValue(new Error('No email template found'));

      await expect(call({ waitlistId: 'w1', userId: 'u1' })).resolves.toMatchObject({
        emailVerified: false,
        alreadyConfirmed: false,
      });
    });

    it('should NOT fail closed when waitlist emails are off by feature toggle', async () => {
      store.set('Settings/email', {
        isEnabled: true, activeProvider: 'log', features: { waitlistEmails: false },
      });
      mockGetTemplate.mockRejectedValue(new Error('No email template found'));

      await expect(call({ waitlistId: 'w1', userId: 'u1' })).resolves.toMatchObject({
        emailVerified: false,
      });
    });
  });

  describe('when the form does not require an OTP', () => {
    it('should confirm but record emailVerified=false, because the address was never proven', async () => {
      store.set('Settings/email', { isEnabled: false });

      const result = await call({ waitlistId: 'w1', userId: 'u1' });

      expect(result.emailVerified).toBe(false);
      expect(store.get('Waitlists/w1/users/u1').emailVerified).toBe(false);
      expect(store.get('Waitlists/w1/users/u1').isConfirmed).toBe(true);
    });

    it('should skip verification when the OTP template has been deactivated', async () => {
      store.set('Settings/email', { isEnabled: true, activeProvider: 'log', features: {} });
      mockGetTemplate.mockResolvedValue({ isActive: false });

      const result = await call({ waitlistId: 'w1', userId: 'u1' });

      expect(result.emailVerified).toBe(false);
      expect(result.alreadyConfirmed).toBe(false);
    });

    it('should skip verification when waitlist emails are switched off by feature toggle', async () => {
      store.set('Settings/email', {
        isEnabled: true, activeProvider: 'log', features: { waitlistEmails: false },
      });

      await expect(call({ waitlistId: 'w1', userId: 'u1' })).resolves.toMatchObject({
        emailVerified: false,
      });
    });
  });

  describe('queue position', () => {
    it('should count confirmed members server-side rather than trust the caller', async () => {
      store.set('Settings/email', { isEnabled: false });
      store.set('Waitlists/w1/users/a', { email: 'a@x.com', isConfirmed: true });
      store.set('Waitlists/w1/users/b', { email: 'b@x.com', isConfirmed: true });
      store.set('Waitlists/w1/users/c', { email: 'c@x.com', isConfirmed: false });

      const result = await call({ waitlistId: 'w1', userId: 'u1', queuePosition: 1 });

      expect(result.queuePosition).toBe(3); // 2 confirmed + 1, not the requested 1
      expect(store.get('Waitlists/w1/users/u1').queuePosition).toBe(3);
    });

    it('should update the waitlist totalSignups to match', async () => {
      store.set('Settings/email', { isEnabled: false });

      await call({ waitlistId: 'w1', userId: 'u1' });

      expect(store.get('Waitlists/w1').totalSignups).toBe(1);
    });
  });

  describe('idempotency', () => {
    it('should not reshuffle the position when re-run on an already-confirmed member', async () => {
      store.set('Settings/email', { isEnabled: false });
      store.set('Waitlists/w1/users/u1', {
        email: 'new@example.com', isConfirmed: true, emailVerified: true, queuePosition: 4,
      });

      const result = await call({ waitlistId: 'w1', userId: 'u1' });

      expect(result).toMatchObject({ alreadyConfirmed: true, queuePosition: 4, emailVerified: true });
      expect(store.get('Waitlists/w1').totalSignups).toBe(0); // untouched
    });

    it('should return the same position across a double submit', async () => {
      store.set('Settings/email', { isEnabled: false });

      const first = await call({ waitlistId: 'w1', userId: 'u1' });
      const second = await call({ waitlistId: 'w1', userId: 'u1' });

      expect(second.queuePosition).toBe(first.queuePosition);
      expect(second.alreadyConfirmed).toBe(true);
    });
  });

  describe('side effects', () => {
    it('should clear any legacy plaintext verification fields', async () => {
      store.set('Settings/email', { isEnabled: false });
      store.set('Waitlists/w1/users/u1', {
        email: 'new@example.com',
        isConfirmed: false,
        verificationCode: '123456',
        verificationExpires: 'later',
      });

      await call({ waitlistId: 'w1', userId: 'u1' });

      const member = store.get('Waitlists/w1/users/u1');
      expect(member.verificationCode).toBeUndefined();
      expect(member.verificationExpires).toBeUndefined();
    });

    it("should apply the form's default tag", async () => {
      store.set('Settings/email', { isEnabled: false });
      store.set('Waitlists/w1', { name: 'Form One', defaultTagId: 'tag-vip' });

      await call({ waitlistId: 'w1', userId: 'u1' });

      expect(store.get('Waitlists/w1/users/u1').tags).toContain('tag-vip');
    });

    it('no longer mirrors onto the global registry (U6)', async () => {
      // joinForm stopped creating registry records, so for anyone signing up now there
      // is nothing to mirror to. Members created before the cutover keep their registry
      // doc; it is simply no longer written to, which is what lets the collection be
      // frozen and then retired.
      store.set('Settings/email', { isEnabled: false });
      store.set('Waitlists/w1/users/u1', {
        email: 'new@example.com', isConfirmed: false, waitlistedUserId: 'g1',
      });
      store.set('WaitlistedUsers/g1', { email: 'new@example.com', isConfirmed: false });

      await call({ waitlistId: 'w1', userId: 'u1' });

      expect(store.get('Waitlists/w1/users/u1').isConfirmed).toBe(true);
      expect(store.get('WaitlistedUsers/g1').isConfirmed).toBe(false); // untouched
    });

    it('should record referredBy when the signup came through a referral link', async () => {
      store.set('Settings/email', { isEnabled: false });

      await call({ waitlistId: 'w1', userId: 'u1', referredBy: 'REF123' });

      expect(store.get('Waitlists/w1/users/u1').referredBy).toBe('REF123');
    });
  });

  describe('input validation', () => {
    it('should reject a missing waitlistId or userId', async () => {
      await expect(call({ userId: 'u1' })).rejects.toMatchObject({ code: 'invalid-argument' });
      await expect(call({ waitlistId: 'w1' })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('should report a signup that no longer exists rather than creating one', async () => {
      await expect(call({ waitlistId: 'w1', userId: 'gone' })).rejects.toMatchObject({
        code: 'not-found',
      });
      expect(store.has('Waitlists/w1/users/gone')).toBe(false);
    });
  });
});
