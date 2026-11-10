/**
 * unsubscribeLegacyLink (email-core/unsubscribeLegacyLink.ts): the old
 * /unsubscribe/:waitlistId/:userId links carry only a document id, which proves
 * nothing. The page now asks for the address, and the callable emails it the
 * signed one-click link. It never unsubscribes from an id, answers the same
 * whatever happened, and is limited per caller and per address.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, mockQueueEmail, mockConsume, mockUnsubscribe } = vi.hoisted(() => ({
  store: new Map<string, any>(),
  mockQueueEmail: vi.fn(),
  mockConsume: vi.fn(),
  mockUnsubscribe: vi.fn(),
}));

function docApi(path: string): any {
  return {
    get: async () => ({ exists: store.has(path), data: () => store.get(path) }),
    collection: (sub: string) => ({ doc: (id: string) => docApi(`${path}/${sub}/${id}`) }),
  };
}

vi.mock('../init', () => ({
  db: {
    collection: (col: string) => ({
      doc: (id: string) => docApi(`${col}/${id}`),
      where: (field: string, _op: string, value: any) => ({
        limit: () => ({
          get: async () => ({
            empty: ![...store.entries()].some(([p, d]) => p.startsWith(`${col}/`) && d?.[field] === value),
          }),
        }),
      }),
    }),
  },
}));
vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));
vi.mock('../email-core/handleUnsubscribe', () => ({ unsubscribeByEmailHash: mockUnsubscribe }));
vi.mock('../email-core/emailLayout', () => ({
  readEmailBrand: async () => ({}),
  wrapInEmailLayout: (inner: string) => `<layout>${inner}</layout>`,
}));
vi.mock('../auth/accounts', () => ({ callerKey: () => 'ip-hash', consumeRateLimits: mockConsume }));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));
vi.mock('../constant', () => ({ constant: { isProduction: false, live_url: '', local_url: 'http://l/' } }));

const { unsubscribeLegacyLink, replyTiming, MIN_REPLY_MS } = await import('../email-core/unsubscribeLegacyLink.js');
const { computeEmailHash } = await import('../email-core/unsubscribeToken.js');

const EMAIL = 'reader@example.com';
const HASH = computeEmailHash(EMAIL);
const call = (data: any) => (unsubscribeLegacyLink as any)({ data, rawRequest: { headers: {}, ip: '1.2.3.4' } });

describe('unsubscribeLegacyLink', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
    mockConsume.mockResolvedValue([]);
    mockQueueEmail.mockResolvedValue({ id: 'log', status: 'pending' });
    replyTiming.minMs = 0;
  });

  it('emails the signed one-click link to an address the site has emailed', async () => {
    store.set('EmailLogs/l1', { emailHash: HASH, toEmail: EMAIL });

    await expect(call({ email: ' Reader@Example.com ' })).resolves.toEqual({ ok: true });

    expect(mockQueueEmail).toHaveBeenCalledTimes(1);
    const sent = mockQueueEmail.mock.calls[0][0];
    // An account email: switching the forms' emails off must not hold back the way out.
    expect(sent).toMatchObject({ toEmail: EMAIL, source: 'auth', category: 'transactional', type: 'unsubscribe_link_email' });
    // The same signed link every email footer carries, filled in when it is sent.
    expect(sent.template).toContain('href="##UNSUBSCRIBE_LINK##"');
    expect(sent.template).toMatch(/^<layout>/);
  });

  it('recognises a contact, and the address the old link\'s member record holds', async () => {
    store.set(`Contacts/${HASH}`, { email: EMAIL });
    await call({ email: EMAIL });
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);

    store.clear();
    mockQueueEmail.mockClear();
    store.set('Waitlists/w1/users/u1', { email: 'Reader@example.com' });
    await call({ email: EMAIL, waitlistId: 'w1', userId: 'u1' });
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);

    store.clear();
    mockQueueEmail.mockClear();
    store.set('WaitlistedUsers/g1', { email: EMAIL });
    await call({ email: EMAIL, userId: 'g1' });
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);
  });

  it('sends nothing to an unknown address, or for an id that holds another address, and answers the same', async () => {
    store.set('Waitlists/w1/users/u1', { email: 'someone-else@example.com' });

    await expect(call({ email: EMAIL })).resolves.toEqual({ ok: true });
    await expect(call({ email: EMAIL, waitlistId: 'w1', userId: 'u1' })).resolves.toEqual({ ok: true });

    expect(mockQueueEmail).not.toHaveBeenCalled();
  });

  it('sends nothing to an address already suppressed', async () => {
    store.set('EmailLogs/l1', { emailHash: HASH });
    store.set(`Suppression/${HASH}`, { reason: 'unsubscribe' });
    await expect(call({ email: EMAIL })).resolves.toEqual({ ok: true });
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });

  it('never unsubscribes anyone itself, from an id or an address', async () => {
    store.set('EmailLogs/l1', { emailHash: HASH });
    store.set('Waitlists/w1/users/u1', { email: EMAIL });
    await call({ email: EMAIL, waitlistId: 'w1', userId: 'u1' });
    expect(mockUnsubscribe).not.toHaveBeenCalled();
    expect(store.has(`Suppression/${HASH}`)).toBe(false);
  });

  it('answers the same when the send fails', async () => {
    store.set('EmailLogs/l1', { emailHash: HASH });
    mockQueueEmail.mockRejectedValue(new Error('queue down'));
    await expect(call({ email: EMAIL })).resolves.toEqual({ ok: true });
  });

  it('needs an address; an old link\'s ids alone do nothing', async () => {
    for (const data of [{ userId: 'u1', waitlistId: 'w1' }, { email: 'nope' }, { email: ['a@b.com'] }]) {
      await expect(call(data)).rejects.toMatchObject({ code: 'invalid-argument' });
    }
    expect(mockConsume).not.toHaveBeenCalled();
  });

  it('counts each request against the caller (10 an hour) and the address (3 a day), known or not', async () => {
    await call({ email: EMAIL });
    expect(mockConsume).toHaveBeenCalledWith([
      expect.objectContaining({ key: 'legacy-unsub-ip-ip-hash', max: 10, windowMs: 3600000 }),
      expect.objectContaining({ key: `legacy-unsub-${HASH}`, max: 3, windowMs: 86400000 }),
    ]);

    store.set('EmailLogs/l1', { emailHash: HASH });
    mockConsume.mockRejectedValueOnce(Object.assign(new Error('Too many attempts. Please try again later.'), { code: 'resource-exhausted' }));
    await expect(call({ email: EMAIL })).rejects.toMatchObject({ code: 'resource-exhausted' });
    expect(mockQueueEmail).not.toHaveBeenCalled();
  });

  it('takes as long for an unknown address as for a known one: no answer before the floor', async () => {
    expect(MIN_REPLY_MS).toBeGreaterThanOrEqual(1000);
    replyTiming.minMs = 120;
    // The send is slow; the unknown address has no send at all.
    mockQueueEmail.mockImplementation(() => new Promise((r) => setTimeout(() => r({ id: 'log', status: 'pending' }), 60)));
    store.set('EmailLogs/l1', { emailHash: HASH });
    const timed = async (data: any) => { const t = Date.now(); await call(data); return Date.now() - t; };
    const known = await timed({ email: EMAIL });
    const unknown = await timed({ email: 'nobody@example.com' });
    expect(mockQueueEmail).toHaveBeenCalledTimes(1);
    expect(known).toBeGreaterThanOrEqual(115);
    expect(unknown).toBeGreaterThanOrEqual(115);
  });
});
