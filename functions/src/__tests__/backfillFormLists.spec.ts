/**
 * Tests for the U1 form→list backfill callable
 * (functions/src/email-core/backfillFormLists.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { waitlists, existingLists, mockEnsureFormList } = vi.hoisted(() => ({
  waitlists: new Map<string, any>(),
  existingLists: new Set<string>(),
  mockEnsureFormList: vi.fn(),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((col: string) => {
      if (col === 'Waitlists') {
        return {
          get: async () => {
            const docs = [...waitlists.entries()].map(([id, data]) => ({ id, data: () => data }));
            return { size: docs.length, docs, empty: docs.length === 0 };
          },
        };
      }
      // Lists
      return {
        doc: (id: string) => ({ get: async () => ({ exists: existingLists.has(id) }) }),
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
  waitlistListId: (id: string) => `waitlist-${id}`,
}));

import { backfillFormLists } from '../email-core/backfillFormLists.js';

const call = () => (backfillFormLists as any)({ auth: { token: { role: 'admin' } }, data: {} });

describe('backfillFormLists', () => {
  beforeEach(() => {
    waitlists.clear();
    existingLists.clear();
    vi.clearAllMocks();
    mockEnsureFormList.mockResolvedValue('list-id');
  });

  it('rejects non-admins', async () => {
    await expect(
      (backfillFormLists as any)({ auth: { token: { role: 'user' } }, data: {} }),
    ).rejects.toThrow(/Admin role required/);
  });

  it('creates a list for every waitlist that has none', async () => {
    waitlists.set('wl-1', { name: 'Alpha' });
    waitlists.set('wl-2', { name: 'Beta' });

    const res = await call();

    expect(res).toMatchObject({ forms: 2, created: 2, repaired: 0, errors: [] });
    expect(mockEnsureFormList).toHaveBeenCalledWith('wl-1', 'Alpha');
    expect(mockEnsureFormList).toHaveBeenCalledWith('wl-2', 'Beta');
  });

  it('counts pre-existing lists as repaired, not created', async () => {
    waitlists.set('wl-1', { name: 'Alpha' });
    waitlists.set('wl-2', { name: 'Beta' });
    existingLists.add('waitlist-wl-1');

    const res = await call();

    expect(res).toMatchObject({ forms: 2, created: 1, repaired: 1 });
  });

  it('falls back to a placeholder name for an unnamed waitlist', async () => {
    waitlists.set('wl-1', {});

    await call();

    expect(mockEnsureFormList).toHaveBeenCalledWith('wl-1', 'Waitlist wl-1');
  });

  it('keeps going when one waitlist fails, reporting it', async () => {
    waitlists.set('wl-1', { name: 'Alpha' });
    waitlists.set('wl-2', { name: 'Beta' });
    mockEnsureFormList.mockRejectedValueOnce(new Error('boom'));

    const res = await call();

    expect(res).toMatchObject({ forms: 2, created: 1, errors: ['wl-1'] });
  });

  it('handles a project with no waitlists', async () => {
    const res = await call();
    expect(res).toMatchObject({ forms: 0, created: 0, repaired: 0 });
  });
});
