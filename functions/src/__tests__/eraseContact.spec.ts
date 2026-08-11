/**
 * Tests for the right-to-erasure sweep (functions/src/email-core/eraseContact.ts).
 *
 * The interesting cases are not "does it delete the contact" but the two ways an
 * erasure can be quietly wrong: leaving the address readable somewhere else, or
 * reaching too far and deleting a real user account (`users` is both a top-level
 * collection and the name of the form member subcollection).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

/** Path-based doc ref, so `ref.parent.parent` behaves like the real thing. */
function docRef(path: string): any {
  return {
    path,
    id: path.split('/').pop(),
    parent: collectionRef(path.split('/').slice(0, -1).join('/')),
    get: vi.fn(async () => ({ exists: store.has(path), data: () => store.get(path) })),
    set: vi.fn(async (data: any) => { store.set(path, data); }),
    delete: vi.fn(async () => { store.delete(path); }),
  };
}

function collectionRef(path: string): any {
  const segments = path.split('/');
  return {
    path,
    id: segments[segments.length - 1],
    // A top-level collection has no parent doc — this is what distinguishes
    // `users/{uid}` from `Waitlists/{id}/users/{id}`.
    parent: segments.length > 1 ? docRef(segments.slice(0, -1).join('/')) : null,
  };
}

function matches(data: any, f: any): boolean {
  if (f.op === '==') return data?.[f.field] === f.value;
  if (f.op === 'array-contains') return Array.isArray(data?.[f.field]) && data[f.field].includes(f.value);
  return true;
}

/** `inCollection`: direct children of `col`. `groupName`: any collection so named. */
function makeQuery(opts: { col?: string; groupName?: string }, filters: any[]): any {
  return {
    where: (field: string, op: string, value: any) => makeQuery(opts, [...filters, { field, op, value }]),
    get: async () => {
      const docs = [...store.entries()]
        .filter(([path]) => {
          const segments = path.split('/');
          if (opts.groupName) return segments[segments.length - 2] === opts.groupName;
          return segments.slice(0, -1).join('/') === opts.col;
        })
        .filter(([, data]) => filters.every((f) => matches(data, f)))
        .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data, ref: docRef(path) }));
      return { empty: docs.length === 0, size: docs.length, docs };
    },
  };
}

vi.mock('../init', () => ({
  db: {
    collection: (col: string) => ({
      doc: (id: string) => docRef(`${col}/${id}`),
      where: (field: string, op: string, value: any) => makeQuery({ col }, [{ field, op, value }]),
    }),
    collectionGroup: (groupName: string) => makeQuery({ groupName }, []),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: () => ({ seconds: 1, nanoseconds: 0 }) },
}));

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const mockRemoveContactFromLists = vi.fn(async (_hash: string, ids: string[]) => ids);
const mockExitAllEnrollments = vi.fn(async (_hash: string, _reason: string) => undefined);

vi.mock('../email-core/contacts', () => ({
  removeContactFromLists: (hash: string, ids: string[]) => mockRemoveContactFromLists(hash, ids),
}));

vi.mock('../email-core/dripEnrollment', () => ({
  exitAllEnrollments: (hash: string, reason: string) => mockExitAllEnrollments(hash, reason),
}));

const { eraseContact } = await import('../email-core/eraseContact.js');

const HASH = 'abc123hash';
const EMAIL = 'erase-me@example.com';

function seedContact(extra: Record<string, unknown> = {}): void {
  store.set(`Contacts/${HASH}`, {
    email: EMAIL,
    emailHash: HASH,
    listIds: ['all-users', 'waitlist-w1'],
    ...extra,
  });
}

beforeEach(() => {
  store.clear();
  mockRemoveContactFromLists.mockClear();
  mockExitAllEnrollments.mockClear();
});

describe('eraseContact', () => {
  it('deletes the contact doc', async () => {
    seedContact();

    const result = await eraseContact(HASH, 'admin-uid');

    expect(result.existed).toBe(true);
    expect(store.has(`Contacts/${HASH}`)).toBe(false);
  });

  it('leaves every list through the membership chokepoint, not by hand', async () => {
    // A direct listIds write would skip the memberCount update and the drip exit.
    seedContact();

    await eraseContact(HASH, 'admin-uid');

    expect(mockRemoveContactFromLists).toHaveBeenCalledWith(HASH, ['all-users', 'waitlist-w1']);
  });

  it('exits remaining drip enrolments with an erased reason', async () => {
    // Covers enrolments whose list the contact had already left or that outlived it.
    seedContact();

    await eraseContact(HASH, 'admin-uid');

    expect(mockExitAllEnrollments).toHaveBeenCalledWith(HASH, 'erased');
  });

  it('deletes the form member doc that holds the same raw address', async () => {
    seedContact();
    store.set('Waitlists/w1/users/m1', { email: EMAIL, name: 'Erase Me' });

    const result = await eraseContact(HASH, 'admin-uid');

    expect(store.has('Waitlists/w1/users/m1')).toBe(false);
    expect(result.memberDocsDeleted).toBe(1);
  });

  it('deletes member docs across every form the address joined', async () => {
    seedContact();
    store.set('Waitlists/w1/users/m1', { email: EMAIL });
    store.set('Waitlists/w2/users/m2', { email: EMAIL });

    const result = await eraseContact(HASH, 'admin-uid');

    expect(result.memberDocsDeleted).toBe(2);
    expect(store.has('Waitlists/w1/users/m1')).toBe(false);
    expect(store.has('Waitlists/w2/users/m2')).toBe(false);
  });

  it('NEVER deletes a top-level user account with the same address', async () => {
    // `collectionGroup('users')` matches `users/{uid}` too. Without the parent
    // check, erasing a subscriber would delete their account.
    seedContact();
    store.set('users/real-account', { email: EMAIL, role: 'admin' });
    store.set('Waitlists/w1/users/m1', { email: EMAIL });

    const result = await eraseContact(HASH, 'admin-uid');

    expect(store.has('users/real-account')).toBe(true);
    expect(result.memberDocsDeleted).toBe(1);
  });

  it('leaves other people\'s member docs alone', async () => {
    seedContact();
    store.set('Waitlists/w1/users/m1', { email: EMAIL });
    store.set('Waitlists/w1/users/m2', { email: 'someone-else@example.com' });

    await eraseContact(HASH, 'admin-uid');

    expect(store.has('Waitlists/w1/users/m2')).toBe(true);
  });

  it('deletes pre-cutover registry docs, which still carry the address', async () => {
    seedContact();
    store.set('WaitlistedUsers/legacy1', { email: EMAIL, waitlistId: 'w1' });

    const result = await eraseContact(HASH, 'admin-uid');

    expect(store.has('WaitlistedUsers/legacy1')).toBe(false);
    expect(result.legacyRegistryDocsDeleted).toBe(1);
  });

  it('deletes in-flight signup verification docs', async () => {
    seedContact();
    store.set('form_otps/w1_abc123hash', { email: EMAIL, emailHash: HASH });

    const result = await eraseContact(HASH, 'admin-uid');

    expect(store.has('form_otps/w1_abc123hash')).toBe(false);
    expect(result.otpDocsDeleted).toBe(1);
  });

  it('removes the suppression record, which also stores the address', async () => {
    seedContact();
    store.set(`Suppression/${HASH}`, { email: EMAIL, emailHash: HASH, reason: 'unsubscribe' });

    const result = await eraseContact(HASH, 'admin-uid');

    expect(store.has(`Suppression/${HASH}`)).toBe(false);
    expect(result.suppressionDeleted).toBe(true);
  });

  it('leaves no tombstone, so an erased person can sign up again', async () => {
    seedContact();

    await eraseContact(HASH, 'admin-uid');

    const suppression = [...store.keys()].filter((k) => k.startsWith('Suppression/'));
    expect(suppression).toEqual([]);
  });

  it('records the erasure without retaining the address', async () => {
    seedContact();
    store.set('Waitlists/w1/users/m1', { email: EMAIL });

    await eraseContact(HASH, 'admin-uid');

    const log = store.get(`ErasureLog/${HASH}`);
    expect(log).toBeDefined();
    expect(log.erasedByUid).toBe('admin-uid');
    expect(log.removed).toMatchObject({ contact: true, lists: 2, memberDocs: 1 });
    // The whole point of a hash-keyed receipt: no readable address anywhere in it.
    expect(JSON.stringify(log)).not.toContain(EMAIL);
    expect(JSON.stringify(log)).not.toContain('example.com');
  });

  it('is a safe no-op sweep when the contact is already gone', async () => {
    // Re-running after a partial failure must not throw — every step is idempotent.
    store.set('Waitlists/w1/users/m1', { email: EMAIL });

    const result = await eraseContact(HASH, 'admin-uid');

    expect(result.existed).toBe(false);
    expect(result.listsRemoved).toEqual([]);
    // No contact doc means no address to match on, so satellite docs survive —
    // documented here so the limitation is visible rather than surprising.
    expect(store.has('Waitlists/w1/users/m1')).toBe(true);
    expect(store.get(`ErasureLog/${HASH}`)).toBeDefined();
  });

  it('handles a contact with no list memberships', async () => {
    store.set(`Contacts/${HASH}`, { email: EMAIL, emailHash: HASH });

    const result = await eraseContact(HASH, 'admin-uid');

    expect(mockRemoveContactFromLists).not.toHaveBeenCalled();
    expect(result.listsRemoved).toEqual([]);
    expect(store.has(`Contacts/${HASH}`)).toBe(false);
  });
});
