/**
 * Tests for the U2 pending-contact backfill callable
 * (functions/src/email-core/backfillPendingContacts.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { waitlists, members, mockEnsureFormList, mockUpsertContact } = vi.hoisted(() => ({
  /** waitlistId → form doc data */
  waitlists: new Map<string, any>(),
  /** waitlistId → member docs */
  members: new Map<string, any[]>(),
  mockEnsureFormList: vi.fn(),
  mockUpsertContact: vi.fn(),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((col: string) => {
      if (col !== 'Waitlists') throw new Error(`unexpected collection ${col}`);
      return {
        get: async () => {
          const docs = [...waitlists.entries()].map(([id, data]) => ({
            id,
            data: () => data,
            ref: {
              collection: (sub: string) => {
                if (sub !== 'users') throw new Error(`unexpected subcollection ${sub}`);
                return {
                  get: async () => {
                    const docs = (members.get(id) || []).map((m, i) => ({
                      data: () => m,
                      ref: { path: `Waitlists/${id}/users/m${i}` },
                    }));
                    return { docs, size: docs.length, empty: docs.length === 0 };
                  },
                };
              },
            },
          }));
          return { size: docs.length, docs, empty: docs.length === 0 };
        },
      };
    }),
  },
}));

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

vi.mock('../email-core/contacts.js', () => ({
  ensureFormList: (...args: any[]) => mockEnsureFormList(...args),
  upsertContact: (...args: any[]) => mockUpsertContact(...args),
}));

import { backfillPendingContacts } from '../email-core/backfillPendingContacts.js';

const call = (data: any = {}) =>
  (backfillPendingContacts as any)({ auth: { token: { role: 'admin' } }, data });

describe('backfillPendingContacts', () => {
  beforeEach(() => {
    waitlists.clear();
    members.clear();
    vi.clearAllMocks();
    mockEnsureFormList.mockResolvedValue('waitlist-wl-1');
    mockUpsertContact.mockResolvedValue({ emailHash: 'h', created: true });
  });

  it('rejects non-admins', async () => {
    await expect(
      (backfillPendingContacts as any)({ auth: { token: { role: 'user' } }, data: {} }),
    ).rejects.toThrow(/Admin role required/);
  });

  it('creates pending contacts for unverified members', async () => {
    waitlists.set('wl-1', { name: 'Alpha' });
    members.set('wl-1', [
      { email: 'a@b.com', emailVerified: false },
      { email: 'c@d.com', emailVerified: false },
    ]);

    const res = await call();

    expect(res).toMatchObject({ forms: 1, scanned: 2, created: 2, errors: [] });
    expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({
      email: 'a@b.com',
      source: 'waitlist',
      addLists: ['waitlist-wl-1'],
      consent: 'pending',
    }));
  });

  it('backfills legacy members with no emailVerified field at all', async () => {
    // Firestore's `!=` filter would skip these; they are the whole point of the
    // backfill, so the filter runs in memory instead.
    waitlists.set('wl-1', { name: 'Alpha' });
    members.set('wl-1', [{ email: 'a@b.com' }]);

    const res = await call();

    expect(res).toMatchObject({ scanned: 1, created: 1 });
    expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({ consent: 'pending' }));
  });

  it('skips verified members — they already have a contact', async () => {
    waitlists.set('wl-1', { name: 'Alpha' });
    members.set('wl-1', [
      { email: 'a@b.com', emailVerified: true },
      { email: 'c@d.com', emailVerified: false },
    ]);

    const res = await call();

    expect(res).toMatchObject({ scanned: 1, created: 1 });
    expect(mockUpsertContact).toHaveBeenCalledTimes(1);
    expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({ email: 'c@d.com' }));
  });

  it('maps an unverified opt-out to unsubscribed, not pending', async () => {
    waitlists.set('wl-1', { name: 'Alpha' });
    members.set('wl-1', [{ email: 'a@b.com', emailVerified: false, isSubscribed: false }]);

    await call();

    expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({ consent: 'unsubscribed' }));
  });

  it('reports contacts that already existed separately from created ones', async () => {
    // Re-running must not double-count: upsertContact reports created:false and
    // leaves an existing contact's consent untouched.
    waitlists.set('wl-1', { name: 'Alpha' });
    members.set('wl-1', [{ email: 'a@b.com', emailVerified: false }]);
    mockUpsertContact.mockResolvedValue({ emailHash: 'h', created: false });

    const res = await call();

    expect(res).toMatchObject({ scanned: 1, created: 0, existing: 1 });
  });

  it('skips members with no email', async () => {
    waitlists.set('wl-1', { name: 'Alpha' });
    members.set('wl-1', [{ emailVerified: false }, { email: 'a@b.com', emailVerified: false }]);

    const res = await call();

    expect(res).toMatchObject({ scanned: 2, created: 1, skippedNoEmail: 1 });
  });

  it('dryRun reports what it would do without writing', async () => {
    waitlists.set('wl-1', { name: 'Alpha' });
    members.set('wl-1', [{ email: 'a@b.com', emailVerified: false }]);

    const res = await call({ dryRun: true });

    expect(res).toMatchObject({ dryRun: true, scanned: 1, created: 1 });
    expect(mockUpsertContact).not.toHaveBeenCalled();
  });

  it('keeps going when one member fails, reporting its path', async () => {
    waitlists.set('wl-1', { name: 'Alpha' });
    members.set('wl-1', [
      { email: 'a@b.com', emailVerified: false },
      { email: 'c@d.com', emailVerified: false },
    ]);
    mockUpsertContact.mockRejectedValueOnce(new Error('boom'));

    const res = await call();

    expect(res).toMatchObject({ scanned: 2, created: 1, errors: ['Waitlists/wl-1/users/m0'] });
  });

  it('records the form and moves on when its list cannot be ensured', async () => {
    waitlists.set('wl-1', { name: 'Alpha' });
    members.set('wl-1', [{ email: 'a@b.com', emailVerified: false }]);
    mockEnsureFormList.mockRejectedValueOnce(new Error('boom'));

    const res = await call();

    expect(res).toMatchObject({ created: 0, errors: ['wl-1'] });
    expect(mockUpsertContact).not.toHaveBeenCalled();
  });

  it('does not touch forms whose members are all verified', async () => {
    waitlists.set('wl-1', { name: 'Alpha' });
    members.set('wl-1', [{ email: 'a@b.com', emailVerified: true }]);

    const res = await call();

    expect(res).toMatchObject({ forms: 1, scanned: 0, created: 0 });
    expect(mockEnsureFormList).not.toHaveBeenCalled();
  });

  it('handles a project with no waitlists', async () => {
    const res = await call();
    expect(res).toMatchObject({ forms: 0, scanned: 0, created: 0 });
  });
});
