/**
 * U6 step 3: move historical referral records off the retiring WaitlistedUsers registry.
 *
 * The trap this guards is double-counting. `totalReferrals` was already dual-written onto
 * the member doc when each referral originally completed, so the aggregates are correct
 * before the migration runs. But copying a completed referral to the new path fires
 * `onReferralCreate`, which credits the member — so a naive copy would silently double
 * every historical count. Hence `migratedAt` on every copy, and the trigger skipping it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

/** Immediate children of a collection path (no deeper nesting). */
function childrenOf(col: string): [string, any][] {
  return [...store.entries()].filter(
    ([path]) => path.startsWith(`${col}/`) && !path.slice(col.length + 1).includes('/'),
  );
}

function docRef(path: string): any {
  return {
    id: path.split('/').pop(),
    path,
    ref: null as any,
    get: vi.fn(async () => ({ exists: store.has(path), id: path.split('/').pop(), data: () => store.get(path) })),
    set: vi.fn(async (data: any) => { store.set(path, data); }),
    collection: (sub: string) => collectionApi(`${path}/${sub}`),
  };
}

/** A QueryDocumentSnapshot: id + data() + a ref you can navigate from. */
function snapDoc(path: string) {
  const ref = docRef(path);
  return { id: ref.id, ref, data: () => store.get(path) };
}

function collectionApi(col: string): any {
  const build = (filters: [string, any][]): any => ({
    where: (field: string, _op: string, value: any) => build([...filters, [field, value]]),
    limit: () => ({
      get: async () => {
        const docs = childrenOf(col)
          .filter(([, d]) => filters.every(([f, v]) => d?.[f] === v))
          .map(([p]) => snapDoc(p));
        return { empty: docs.length === 0, docs, size: docs.length };
      },
    }),
    get: async () => {
      const docs = childrenOf(col)
        .filter(([, d]) => filters.every(([f, v]) => d?.[f] === v))
        .map(([p]) => snapDoc(p));
      return { empty: docs.length === 0, docs, size: docs.length };
    },
  });
  return { doc: (id: string) => docRef(`${col}/${id}`), ...build([]) };
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

const { migrateWaitlistedUsers } = await import('../email-core/migrateWaitlistedUsers.js');

const admin = { auth: { token: { role: 'admin' } } };
const call = (data: any = {}) => (migrateWaitlistedUsers as any)({ ...admin, data });

/** A registry doc, its member back-reference, and one referral under the old path. */
function seedLegacyReferral(opts: {
  uid: string; formId: string; memberId: string; referralId: string;
  status?: string; withWaitlistId?: boolean; withMember?: boolean;
}) {
  const { uid, formId, memberId, referralId } = opts;
  store.set(`WaitlistedUsers/${uid}`, { email: `${uid}@x.com`, totalReferrals: 1 });
  if (opts.withMember !== false) {
    store.set(`Waitlists/${formId}/users/${memberId}`, {
      email: `${uid}@x.com`, waitlistedUserId: uid, totalReferrals: 1, isConfirmed: true,
    });
  }
  store.set(`WaitlistedUsers/${uid}/referrals/${referralId}`, {
    referredEmail: 'friend@x.com',
    referredUserId: 'friend-uid',
    status: opts.status ?? 'completed',
    ...(opts.withWaitlistId === false ? {} : { waitlistId: formId }),
  });
}

describe('migrateWaitlistedUsers', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('requires an admin caller', async () => {
    await expect(
      (migrateWaitlistedUsers as any)({ auth: { token: { role: 'user' } }, data: {} }),
    ).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('copies a legacy referral under the member that earned it', async () => {
    seedLegacyReferral({ uid: 'u1', formId: 'f1', memberId: 'm1', referralId: 'r1' });

    const res = await call();

    expect(res.referralsCopied).toBe(1);
    expect(store.has('Waitlists/f1/users/m1/referrals/r1')).toBe(true);
    expect(store.get('Waitlists/f1/users/m1/referrals/r1').referredEmail).toBe('friend@x.com');
  });

  it('stamps every copy so onReferralCreate cannot re-count it', async () => {
    // The whole reason this marker exists: the copy is a create on the new path, and
    // the crediting trigger fires on exactly that.
    seedLegacyReferral({ uid: 'u1', formId: 'f1', memberId: 'm1', referralId: 'r1' });

    await call();

    const copied = store.get('Waitlists/f1/users/m1/referrals/r1');
    expect(copied.migratedAt).toBeDefined();
    expect(copied.migratedFrom).toBe('WaitlistedUsers/u1/referrals/r1');
  });

  it('never touches totalReferrals — the aggregates were already dual-written', async () => {
    seedLegacyReferral({ uid: 'u1', formId: 'f1', memberId: 'm1', referralId: 'r1' });

    await call();

    expect(store.get('Waitlists/f1/users/m1').totalReferrals).toBe(1);
    expect(store.get('WaitlistedUsers/u1').totalReferrals).toBe(1);
  });

  it('is idempotent — a second run copies nothing', async () => {
    seedLegacyReferral({ uid: 'u1', formId: 'f1', memberId: 'm1', referralId: 'r1' });

    await call();
    const second = await call();

    expect(second.referralsCopied).toBe(0);
    expect(second.referralsAlreadyPresent).toBe(1);
  });

  it('keeps the source doc id, so re-running cannot duplicate a record', async () => {
    seedLegacyReferral({ uid: 'u1', formId: 'f1', memberId: 'm1', referralId: 'r-abc' });

    await call();

    expect(store.has('Waitlists/f1/users/m1/referrals/r-abc')).toBe(true);
    expect(childrenOf('Waitlists/f1/users/m1/referrals')).toHaveLength(1);
  });

  it('migrates pending referrals too, so they can still complete later', async () => {
    seedLegacyReferral({
      uid: 'u1', formId: 'f1', memberId: 'm1', referralId: 'r1', status: 'pending',
    });

    await call();

    expect(store.get('Waitlists/f1/users/m1/referrals/r1').status).toBe('pending');
  });

  describe('records it cannot place', () => {
    it('reports a referral with no waitlistId rather than guessing a form', async () => {
      seedLegacyReferral({
        uid: 'u1', formId: 'f1', memberId: 'm1', referralId: 'r1', withWaitlistId: false,
      });

      const res = await call();

      expect(res.referralsCopied).toBe(0);
      expect(res.unresolved).toEqual([
        { uid: 'u1', referralId: 'r1', reason: 'no waitlistId on the record' },
      ]);
    });

    it('reports a referral whose member back-reference is gone', async () => {
      seedLegacyReferral({
        uid: 'u1', formId: 'f1', memberId: 'm1', referralId: 'r1', withMember: false,
      });

      const res = await call();

      expect(res.referralsCopied).toBe(0);
      expect(res.unresolved[0].reason).toMatch(/no member in f1/);
    });

    it('does not let one unplaceable record stop the rest', async () => {
      seedLegacyReferral({
        uid: 'u1', formId: 'f1', memberId: 'm1', referralId: 'r1', withWaitlistId: false,
      });
      seedLegacyReferral({ uid: 'u2', formId: 'f1', memberId: 'm2', referralId: 'r2' });

      const res = await call();

      expect(res.referralsCopied).toBe(1);
      expect(res.unresolved).toHaveLength(1);
      expect(store.has('Waitlists/f1/users/m2/referrals/r2')).toBe(true);
    });
  });

  describe('dry run', () => {
    it('reports exactly what the real run would do, and writes nothing', async () => {
      seedLegacyReferral({ uid: 'u1', formId: 'f1', memberId: 'm1', referralId: 'r1' });

      const dry = await call({ dryRun: true });

      expect(dry).toMatchObject({ dryRun: true, referralsFound: 1, referralsCopied: 1 });
      expect(store.has('Waitlists/f1/users/m1/referrals/r1')).toBe(false);
    });

    it('agrees with the real run on the unresolved set', async () => {
      seedLegacyReferral({
        uid: 'u1', formId: 'f1', memberId: 'm1', referralId: 'r1', withMember: false,
      });

      const dry = await call({ dryRun: true });
      const real = await call();

      expect(dry.unresolved).toEqual(real.unresolved);
    });
  });

  it('reports zero cleanly when there is nothing to migrate', async () => {
    const res = await call();

    expect(res).toMatchObject({
      success: true, registryDocsScanned: 0, referralsFound: 0, referralsCopied: 0,
    });
  });
});
