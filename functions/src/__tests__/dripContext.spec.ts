/**
 * U5 per-list merge context: a welcome sent as a drip step must resolve the same
 * gamification tags the old direct welcome did.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

function collectionApi(col: string): any {
  return {
    doc: (id: string) => ({
      get: async () => ({ exists: store.has(`${col}/${id}`), data: () => store.get(`${col}/${id}`) }),
      collection: (sub: string) => collectionApi(`${col}/${id}/${sub}`),
    }),
    where: (field: string, _op: string, value: any) => ({
      limit: () => ({
        get: async () => {
          const docs = [...store.entries()]
            .filter(([path]) => path.startsWith(`${col}/`) && !path.slice(col.length + 1).includes('/'))
            .filter(([, data]) => data?.[field] === value)
            .map(([path, data]) => ({ id: path.split('/').pop(), data: () => data }));
          return { empty: docs.length === 0, docs };
        },
      }),
    }),
  };
}

vi.mock('../init', () => ({ db: { collection: vi.fn((col: string) => collectionApi(col)) } }));
vi.mock('../constant', () => ({
  constant: { isProduction: false, live_url: 'https://x/', local_url: 'http://l/' },
}));

import { resolveListContext } from '../email-core/dripContext.js';

describe('resolveListContext (U5)', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('resolves waitlist gamification context from the member funnel doc', async () => {
    store.set('Waitlists/wl-1', { name: 'Alpha' });
    store.set('Waitlists/wl-1/users/u1', {
      email: 'a@x.com',
      queuePosition: 42,
      referralLink: 'https://x/r/abc',
      leaderboardLink: 'https://x/l/wl-1',
    });

    const ctx = await resolveListContext('waitlist-wl-1', 'a@x.com');

    expect(ctx).toMatchObject({
      waitlistName: 'Alpha',
      position: 42,
      referralLink: 'https://x/r/abc',
      leaderboardLink: 'https://x/l/wl-1',
    });
  });

  it('returns the form name even when the member doc is missing', async () => {
    // A contact added to the list manually has no funnel doc; the send should
    // still go out with whatever context exists.
    store.set('Waitlists/wl-1', { name: 'Alpha' });

    const ctx = await resolveListContext('waitlist-wl-1', 'nobody@x.com');

    expect(ctx).toEqual({ waitlistName: 'Alpha' });
  });

  it('returns empty for a manual list (no resolver matches)', async () => {
    expect(await resolveListContext('newsletter', 'a@x.com')).toEqual({});
  });

  it('returns empty for a missing list id', async () => {
    expect(await resolveListContext('', 'a@x.com')).toEqual({});
  });

  it('returns empty rather than throwing when the form is gone', async () => {
    const ctx = await resolveListContext('waitlist-deleted', 'a@x.com');
    expect(ctx).toEqual({});
  });

  it('matches the member by email, not by contact id', async () => {
    // The funnel doc id is the waitlisted-user id, unrelated to emailHash.
    store.set('Waitlists/wl-1', { name: 'Alpha' });
    store.set('Waitlists/wl-1/users/some-random-id', { email: 'b@x.com', queuePosition: 7 });

    const ctx = await resolveListContext('waitlist-wl-1', 'b@x.com');

    expect(ctx['position']).toBe(7);
  });
});
