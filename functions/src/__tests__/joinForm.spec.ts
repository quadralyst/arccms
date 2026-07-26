/**
 * Server-side find-or-create for form membership (#51 part 2).
 *
 * The browser used to query `where('email','==',…)` on member documents to avoid
 * creating a duplicate, which is why the rules had to allow public reads on a
 * collection holding raw email addresses. No rule can permit that query without also
 * permitting "list everyone", so the read moved here.
 *
 * The two properties worth pinning: it never creates a duplicate, and it reveals
 * nothing about whether the address was already known — the response shape is
 * identical either way, so it cannot be used to enumerate a list.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, added } = vi.hoisted(() => ({
  store: new Map<string, any>(),
  added: [] as { path: string; data: any }[],
}));

let autoId = 0;

function childrenOf(col: string): [string, any][] {
  return [...store.entries()].filter(
    ([path]) => path.startsWith(`${col}/`) && !path.slice(col.length + 1).includes('/'),
  );
}

function docRef(path: string): any {
  const self: any = {
    id: path.split('/').pop(),
    path,
    get: vi.fn(async () => ({ exists: store.has(path), id: self.id, data: () => store.get(path), ref: self })),
    set: vi.fn(async (data: any) => { store.set(path, data); }),
    update: vi.fn(async (data: any) => { store.set(path, { ...(store.get(path) || {}), ...data }); }),
    collection: (sub: string) => collectionApi(`${path}/${sub}`),
  };
  return self;
}

function collectionApi(col: string): any {
  const build = (filters: [string, any][]): any => ({
    where: (field: string, _op: string, value: any) => build([...filters, [field, value]]),
    limit: () => build(filters),
    get: async () => {
      const docs = childrenOf(col)
        .filter(([, d]) => filters.every(([f, v]) => d?.[f] === v))
        .map(([p]) => {
          const ref = docRef(p);
          return { id: ref.id, ref, data: () => store.get(p) };
        });
      return { empty: docs.length === 0, docs, size: docs.length };
    },
  });
  return {
    doc: (id?: string) => docRef(`${col}/${id ?? `auto-${++autoId}`}`),
    add: async (data: any) => {
      const path = `${col}/auto-${++autoId}`;
      store.set(path, data);
      added.push({ path, data });
      return docRef(path);
    },
    ...build([]),
  };
}

vi.mock('../init', () => ({ db: { collection: vi.fn((col: string) => collectionApi(col)) } }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: () => ({ __ts: true }) } }));
vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

const { joinForm } = await import('../waitlists/joinForm.js');

const FORM = 'f1';
const call = (data: any) => (joinForm as any)({ data });
const memberCount = () => childrenOf(`Waitlists/${FORM}/users`).length;

describe('joinForm', () => {
  beforeEach(() => {
    store.clear();
    added.length = 0;
    autoId = 0;
    vi.clearAllMocks();
    store.set(`Waitlists/${FORM}`, { name: 'Founding Circle' });
  });

  describe('validation', () => {
    it('requires a waitlistId', async () => {
      await expect(call({ email: 'a@b.com' })).rejects.toMatchObject({ code: 'invalid-argument' });
    });

    it('requires a plausible email', async () => {
      for (const email of ['', 'nope', 'a'.repeat(250) + '@b.com']) {
        await expect(call({ waitlistId: FORM, email })).rejects.toMatchObject({ code: 'invalid-argument' });
      }
    });

    it('refuses a form that does not exist, rather than creating orphan records', async () => {
      await expect(call({ waitlistId: 'ghost', email: 'a@b.com' }))
        .rejects.toMatchObject({ code: 'not-found' });
      expect(added).toHaveLength(0);
    });
  });

  describe('a new member', () => {
    it('creates the member and the registry record, and returns the ids', async () => {
      const res = await call({ waitlistId: FORM, email: 'new@example.com', firstName: 'New' });

      expect(memberCount()).toBe(1);
      expect(res.memberId).toBeTruthy();
      expect(res.waitlistedUserId).toBeTruthy();
      expect(res.referralCode).toMatch(/^[A-Z2-9]{8}$/);
    });

    it('starts unconfirmed and unverified', async () => {
      const res = await call({ waitlistId: FORM, email: 'new@example.com' });

      const member = store.get(`Waitlists/${FORM}/users/${res.memberId}`);
      expect(member.isConfirmed).toBe(false);
      expect(member.emailVerified).toBe(false);
      expect(member.queuePosition).toBe(0);
    });

    it('lower-cases the address so casing cannot create a second member', async () => {
      const first = await call({ waitlistId: FORM, email: 'Mixed@Example.com' });
      const second = await call({ waitlistId: FORM, email: 'mixed@example.com' });

      expect(second.memberId).toBe(first.memberId);
      expect(memberCount()).toBe(1);
    });

    it('embeds the registry id in leaderboardLink, matching the links already sent', async () => {
      const res = await call({
        waitlistId: FORM, email: 'new@example.com', origin: 'https://site.example',
      });

      expect(res.leaderboardLink).toBe(
        `https://site.example/leaderboard/${FORM}/${res.waitlistedUserId}`,
      );
    });

    it("applies the form's default tag server-side", async () => {
      store.set(`Waitlists/${FORM}`, { name: 'Founding Circle', defaultTagId: 'tag-vip' });

      const res = await call({ waitlistId: FORM, email: 'new@example.com' });

      expect(store.get(`Waitlists/${FORM}/users/${res.memberId}`).tags).toEqual(['tag-vip']);
    });

    it('records referredBy when the signup came through a referral link', async () => {
      const res = await call({ waitlistId: FORM, email: 'new@example.com', referredBy: 'CODE1' });

      expect(store.get(`Waitlists/${FORM}/users/${res.memberId}`).referredBy).toBe('CODE1');
    });

    it('masks the address for the leaderboard', async () => {
      const res = await call({ waitlistId: FORM, email: 'someone@example.com' });

      expect(store.get(`Waitlists/${FORM}/users/${res.memberId}`).maskedEmail)
        .toMatch(/^so\*+@example\.com$/);
    });
  });

  describe('a returning member', () => {
    it('never creates a duplicate — this is what the client-side read used to prevent', async () => {
      const first = await call({ waitlistId: FORM, email: 'dup@example.com', firstName: 'A' });
      const second = await call({ waitlistId: FORM, email: 'dup@example.com', firstName: 'A' });

      expect(second.memberId).toBe(first.memberId);
      expect(memberCount()).toBe(1);
    });

    it('returns the same shape as a new join, so it cannot be used to probe for members', async () => {
      // The reason this is find-or-create rather than a lookup: a caller must not be
      // able to tell whether an address is already on the list.
      const fresh = await call({ waitlistId: FORM, email: 'a@example.com' });
      const repeat = await call({ waitlistId: FORM, email: 'a@example.com' });

      expect(Object.keys(repeat).sort()).toEqual(Object.keys(fresh).sort());
      expect(repeat).not.toHaveProperty('exists');
      expect(repeat).not.toHaveProperty('isExisting');
      expect(repeat).not.toHaveProperty('verified');
    });

    it('preserves the original referral code across a re-submit', async () => {
      const first = await call({ waitlistId: FORM, email: 'dup@example.com' });
      const second = await call({ waitlistId: FORM, email: 'dup@example.com' });

      expect(second.referralCode).toBe(first.referralCode);
    });

    it('updates the name while still unconfirmed', async () => {
      const first = await call({ waitlistId: FORM, email: 'dup@example.com', firstName: 'Old' });
      await call({ waitlistId: FORM, email: 'dup@example.com', firstName: 'New' });

      expect(store.get(`Waitlists/${FORM}/users/${first.memberId}`).firstName).toBe('New');
    });

    it('keeps the confirmed name, ignoring whatever a later form fill says', async () => {
      const first = await call({ waitlistId: FORM, email: 'dup@example.com', firstName: 'Verified' });
      store.set(`Waitlists/${FORM}/users/${first.memberId}`, {
        ...store.get(`Waitlists/${FORM}/users/${first.memberId}`), isConfirmed: true,
      });

      await call({ waitlistId: FORM, email: 'dup@example.com', firstName: 'Impostor' });

      expect(store.get(`Waitlists/${FORM}/users/${first.memberId}`).firstName).toBe('Verified');
    });

    it('does not create a second registry record', async () => {
      await call({ waitlistId: FORM, email: 'dup@example.com' });
      await call({ waitlistId: FORM, email: 'dup@example.com' });

      expect(childrenOf('WaitlistedUsers')).toHaveLength(1);
    });
  });

  it('does not send the code — the caller asks for that separately', async () => {
    // Keeping the send in requestFormOtp means one throttle and one place that decides
    // whether a form verifies at all.
    const res = await call({ waitlistId: FORM, email: 'new@example.com' });

    expect(res).not.toHaveProperty('sent');
    expect(store.has(`form_otps/${FORM}_new@example.com`)).toBe(false);
  });
});
