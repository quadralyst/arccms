/**
 * Public read models for the waitlist pages (#51).
 *
 * These exist to close a verified exposure: `allow read: if true` on
 * `Waitlists/{id}/users` meant anyone with the web API key — which ships in the
 * frontend bundle — could page every signup's raw email address. The rules were
 * permissive because the leaderboard and user-detail pages queried member docs
 * client-side.
 *
 * The allowlist is the security boundary here, so most of these tests are about what
 * does NOT come back. The code being replaced returned whole documents minus a
 * denylist of three fields, which fails open every time someone adds a field.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

function childrenOf(col: string): [string, any][] {
  return [...store.entries()].filter(
    ([path]) => path.startsWith(`${col}/`) && !path.slice(col.length + 1).includes('/'),
  );
}

function docRef(path: string): any {
  const self: any = {
    id: path.split('/').pop(),
    path,
    get: vi.fn(async () => ({
      exists: store.has(path), id: path.split('/').pop(), data: () => store.get(path), ref: self,
    })),
    collection: (sub: string) => collectionApi(`${path}/${sub}`),
  };
  return self;
}

function snapDoc(path: string) {
  const ref = docRef(path);
  return { id: ref.id, ref, data: () => store.get(path) };
}

function collectionApi(col: string): any {
  const build = (filters: [string, any][]): any => {
    const run = async () => {
      const docs = childrenOf(col)
        .filter(([, d]) => filters.every(([f, v]) => d?.[f] === v))
        .sort(([, a], [, b]) => (b?.totalReferrals || 0) - (a?.totalReferrals || 0))
        .map(([p]) => snapDoc(p));
      return { empty: docs.length === 0, docs, size: docs.length };
    };
    return {
      where: (field: string, _op: string, value: any) => build([...filters, [field, value]]),
      orderBy: () => build(filters),
      limit: () => build(filters),
      count: () => ({
        get: async () => {
          const { docs } = await run();
          return { data: () => ({ count: docs.length }) };
        },
      }),
      get: run,
    };
  };
  return { doc: (id: string) => docRef(`${col}/${id}`), ...build([]) };
}

vi.mock('../init', () => ({ db: { collection: vi.fn((col: string) => collectionApi(col)) } }));
vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

const { getPublicLeaderboard, getPublicMemberView } =
  await import('../waitlists/publicWaitlistViews.js');

const FORM = 'f1';
const board = (data: any) => (getPublicLeaderboard as any)({ data });
const view = (data: any) => (getPublicMemberView as any)({ data });

/** A member doc carrying every sensitive field a real one carries. */
function seedMember(id: string, over: Record<string, unknown> = {}) {
  store.set(`Waitlists/${FORM}/users/${id}`, {
    email: `${id}@example.com`,
    maskedEmail: `${id.slice(0, 2)}***@example.com`,
    firstName: 'Alex',
    isConfirmed: true,
    emailVerified: true,
    queuePosition: 3,
    totalReferrals: 2,
    referralCode: 'CODE1',
    signupTimestamp: { __ts: 1 },
    waitlistedUserId: `legacy-${id}`,
    // Sensitive / internal — must never be returned.
    verificationCode: '123456',
    verificationExpires: { __ts: 2 },
    ipAddress: '203.0.113.9',
    signupMetadata: { referrer: 'https://private.example' },
    formData: { company: 'Acme', salary: '100k' },
    tags: ['tag-vip'],
    notes: 'internal note',
    ...over,
  });
}

describe('getPublicLeaderboard', () => {
  beforeEach(() => { store.clear(); vi.clearAllMocks(); });

  it('requires a waitlistId', async () => {
    await expect(board({})).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('returns masked emails and never the raw address', async () => {
    seedMember('m1');

    const res = await board({ waitlistId: FORM });

    expect(res.leaderboard[0].maskedEmail).toBe('m1***@example.com');
    expect(JSON.stringify(res)).not.toContain('m1@example.com');
  });

  it('exposes only the six leaderboard fields', async () => {
    seedMember('m1');

    const res = await board({ waitlistId: FORM });

    expect(Object.keys(res.leaderboard[0]).sort()).toEqual([
      'firstName', 'id', 'maskedEmail', 'queuePosition', 'totalReferrals', 'waitlistedUserId',
    ]);
  });

  it('leaks none of the sensitive fields a member doc carries', async () => {
    seedMember('m1');

    const serialised = JSON.stringify(await board({ waitlistId: FORM }));

    for (const secret of ['123456', '203.0.113.9', 'private.example', 'Acme', '100k', 'tag-vip', 'internal note']) {
      expect(serialised).not.toContain(secret);
    }
  });

  it('counts confirmed and unconfirmed members separately', async () => {
    seedMember('m1');
    seedMember('m2', { isConfirmed: false });

    const res = await board({ waitlistId: FORM });

    expect(res.totalUsers).toBe(1);
    expect(res.unverifiedUsers).toBe(1);
    expect(res.leaderboard).toHaveLength(1); // unconfirmed are not ranked
  });

  it('masks an address itself when the stored maskedEmail is missing', async () => {
    seedMember('m1', { maskedEmail: undefined });

    const res = await board({ waitlistId: FORM });

    expect(res.leaderboard[0].maskedEmail).toMatch(/^m1\*+@example\.com$/);
  });

  it('returns an empty board for a form with no members', async () => {
    const res = await board({ waitlistId: FORM });
    expect(res).toMatchObject({ leaderboard: [], totalUsers: 0, unverifiedUsers: 0 });
  });
});

describe('getPublicMemberView', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    store.set(`Waitlists/${FORM}`, {
      name: 'Founding Circle', slug: 'founding', isActive: true, totalSignups: 9,
      // Admin-only settings living on the same doc.
      defaultTagId: 'tag-vip', targetListIds: ['waitlist-f1'], welcomeMigrated: true,
    });
  });

  it('requires both ids', async () => {
    await expect(view({ waitlistId: FORM })).rejects.toMatchObject({ code: 'invalid-argument' });
    await expect(view({ memberRef: 'm1' })).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('resolves a member-doc id', async () => {
    seedMember('m1');

    const res = await view({ waitlistId: FORM, memberRef: 'm1' });

    expect(res.member.id).toBe('m1');
  });

  it('resolves a legacy waitlistedUserId, so already-sent email links keep working', async () => {
    // leaderboardLink embeds the WaitlistedUsers doc id and those links are already out
    // in people's inboxes — they must survive U6 retiring that collection.
    seedMember('m1');

    const res = await view({ waitlistId: FORM, memberRef: 'legacy-m1' });

    expect(res.member.id).toBe('m1');
  });

  it('reports not-found for an unknown id rather than an empty view', async () => {
    await expect(view({ waitlistId: FORM, memberRef: 'nope' }))
      .rejects.toMatchObject({ code: 'not-found' });
  });

  it('returns the member their own email but none of the internal fields', async () => {
    seedMember('m1');

    const res = await view({ waitlistId: FORM, memberRef: 'm1' });

    // Their own address is theirs to see — this is a link from their own email.
    expect(res.member.email).toBe('m1@example.com');
    for (const leaked of ['verificationCode', 'verificationExpires', 'ipAddress',
                          'signupMetadata', 'formData', 'tags', 'notes']) {
      expect(res.member[leaked]).toBeUndefined();
    }
  });

  it('does not expose admin-only settings from the form document', async () => {
    seedMember('m1');

    const res = await view({ waitlistId: FORM, memberRef: 'm1' });

    expect(res.waitlist.name).toBe('Founding Circle');
    expect(res.waitlist.defaultTagId).toBeUndefined();
    expect(res.waitlist.targetListIds).toBeUndefined();
    expect(res.waitlist.welcomeMigrated).toBeUndefined();
  });

  describe('referral history', () => {
    beforeEach(() => {
      seedMember('m1');
      store.set(`Waitlists/${FORM}/users/m1/referrals/r1`, {
        referredEmail: 'friend@example.com', referredName: 'Friend', status: 'completed',
      });
      store.set(`Waitlists/${FORM}/users/m1/referrals/r2`, {
        referredEmail: 'other@example.com', status: 'pending',
      });
    });

    it('reads from the member subcollection U6 moved referrals into', async () => {
      const res = await view({ waitlistId: FORM, memberRef: 'm1' });
      expect(res.referrals).toHaveLength(2);
    });

    it('masks the referred addresses — a referrer should not harvest them', async () => {
      const res = await view({ waitlistId: FORM, memberRef: 'm1' });

      const serialised = JSON.stringify(res.referrals);
      expect(serialised).not.toContain('friend@example.com');
      expect(serialised).not.toContain('other@example.com');
      expect(res.referrals[0].referredMaskedEmail).toMatch(/@example\.com$/);
    });

    it('counts completed and pending referrals', async () => {
      const res = await view({ waitlistId: FORM, memberRef: 'm1' });
      expect(res.stats).toEqual({ successfulReferrals: 1, pendingReferrals: 1 });
    });
  });
});
