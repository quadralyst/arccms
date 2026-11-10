/**
 * The form ticket (waitlists/formTicket.ts) and the public form input caps
 * (waitlists/formInput.ts).
 *
 * joinForm answers for any address, an existing member's included, so it hands
 * back a sealed ticket rather than the member id. These pin that a ticket hides
 * the id, works only for its own form and only for an hour, cannot be altered,
 * and cannot be mistaken for an unsubscribe token.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, secret } = vi.hoisted(() => ({ store: new Map<string, any>(), secret: { value: 'a'.repeat(64) } }));

vi.mock('../init', () => ({
  db: {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: store.has(`${col}/${id}`), data: () => store.get(`${col}/${id}`) }),
        collection: (sub: string) => ({
          doc: (sid: string) => {
            const path = `${col}/${id}/${sub}/${sid}`;
            return { path, get: async () => ({ exists: store.has(path), data: () => store.get(path) }) };
          },
        }),
      }),
    }),
  },
}));
vi.mock('../email-core/unsubscribeSecret', () => ({ getUnsubscribeSecret: async () => secret.value }));
vi.mock('firebase-functions/v2/https', () => ({
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

const { issueFormTicket, openFormTicket, memberFromTicket, FORM_TICKET_TTL_MS } = await import('../waitlists/formTicket.js');
const { buildUnsubscribeToken, verifyUnsubscribeToken, computeEmailHash } = await import('../email-core/unsubscribeToken.js');
const {
  readFormId, readEmail, readShortText, readFormData, trimSignupMetadata, requireActiveForm,
} = await import('../waitlists/formInput.js');

describe('form ticket', () => {
  beforeEach(() => {
    store.clear();
    secret.value = 'a'.repeat(64);
  });

  it('opens to the member id for its own form', async () => {
    const ticket = await issueFormTicket('wl-1', 'member-123');
    expect(await openFormTicket(ticket, 'wl-1')).toBe('member-123');
  });

  it('does not carry the member id in readable form', async () => {
    const ticket = await issueFormTicket('wl-1', 'member-123');
    expect(ticket).not.toContain('member-123');
    for (const part of ticket.split('.')) {
      expect(Buffer.from(part, 'base64url').toString('utf8')).not.toContain('member-123');
    }
  });

  it('does not work for another form', async () => {
    const ticket = await issueFormTicket('wl-1', 'member-123');
    expect(await openFormTicket(ticket, 'wl-2')).toBeNull();
  });

  it('stops working after an hour', async () => {
    const now = Date.now();
    const ticket = await issueFormTicket('wl-1', 'm', now);
    expect(await openFormTicket(ticket, 'wl-1', now + FORM_TICKET_TTL_MS - 1)).toBe('m');
    expect(await openFormTicket(ticket, 'wl-1', now + FORM_TICKET_TTL_MS)).toBeNull();
  });

  it('refuses a ticket whose tag was cut short (only the full 16-byte tag counts)', async () => {
    const ticket = await issueFormTicket('wl-1', 'member-123');
    const parts = ticket.split('.');
    const tag = Buffer.from(parts[2], 'base64url');
    expect(tag.length).toBe(16);
    for (const length of [4, 8, 12, 15]) {
      const cut = [...parts];
      cut[2] = tag.subarray(0, length).toString('base64url');
      expect(await openFormTicket(cut.join('.'), 'wl-1')).toBeNull();
    }
  });

  it('refuses a ticket with any part changed', async () => {
    const ticket = await issueFormTicket('wl-1', 'member-123');
    const parts = ticket.split('.');
    for (let i = 1; i < parts.length; i++) {
      const bytes = Buffer.from(parts[i], 'base64url');
      bytes[0] ^= 1;
      const changed = [...parts];
      changed[i] = bytes.toString('base64url');
      expect(await openFormTicket(changed.join('.'), 'wl-1')).toBeNull();
    }
  });

  it('refuses rubbish, a raw member id and a ticket sealed under another secret', async () => {
    for (const bad of [undefined, null, 42, '', 'member-123', 'ft1.a.b.c', 'x'.repeat(2000)]) {
      expect(await openFormTicket(bad, 'wl-1')).toBeNull();
    }
    secret.value = 'b'.repeat(64);
    const other = await issueFormTicket('wl-1', 'member-123');
    secret.value = 'a'.repeat(64);
    expect(await openFormTicket(other, 'wl-1')).toBeNull();
  });

  it('can never serve as an unsubscribe token, nor an unsubscribe token as a ticket', async () => {
    const hash = computeEmailHash('a@x.com');
    const ticket = await issueFormTicket('wl-1', hash);
    expect(verifyUnsubscribeToken(hash, ticket, secret.value)).toBe(false);
    expect(await openFormTicket(buildUnsubscribeToken(hash, secret.value), 'wl-1')).toBeNull();
  });

  it('refuses to issue when the secret cannot be had', async () => {
    secret.value = '';
    await expect(issueFormTicket('wl-1', 'm')).rejects.toMatchObject({ code: 'unavailable' });
  });

  describe('memberFromTicket', () => {
    it('reads the member the ticket names, with its address lower-cased', async () => {
      store.set('Waitlists/wl-1/users/m1', { email: 'A@X.com', firstName: 'A' });
      const member = await memberFromTicket('wl-1', await issueFormTicket('wl-1', 'm1'));
      expect(member).toMatchObject({ id: 'm1', email: 'a@x.com' });
      expect(member.data.firstName).toBe('A');
    });

    it('refuses alike a bad ticket and a member that is gone', async () => {
      const bad = memberFromTicket('wl-1', 'm1');
      const gone = memberFromTicket('wl-1', await issueFormTicket('wl-1', 'm1'));
      await expect(bad).rejects.toMatchObject({ code: 'permission-denied' });
      await expect(gone).rejects.toMatchObject({ code: 'permission-denied' });
    });
  });
});

describe('public form input', () => {
  beforeEach(() => store.clear());

  it('takes a form id with no slash', () => {
    expect(readFormId(' launch ')).toBe('launch');
    for (const bad of [undefined, 3, '', 'a/b', '..', '__x__', 'x'.repeat(201)]) {
      expect(() => readFormId(bad)).toThrow();
    }
  });

  it('takes a plausible address only as text', () => {
    expect(readEmail(' A@X.com ')).toBe('a@x.com');
    for (const bad of [undefined, ['a@x.com'], { email: 'a@x.com' }, 'nope', 'a'.repeat(250) + '@x.com']) {
      expect(() => readEmail(bad)).toThrow();
    }
  });

  it('caps a name at 100 characters and refuses what is not text', () => {
    expect(readShortText(undefined, 'm')).toBe('');
    expect(readShortText(' Asha ', 'm')).toBe('Asha');
    expect(readShortText('x'.repeat(100), 'm')).toHaveLength(100);
    expect(() => readShortText('x'.repeat(101), 'Please use a shorter name.')).toThrow('Please use a shorter name.');
    expect(() => readShortText({ toString: () => 'x' }, 'm')).toThrow();
  });

  describe('form data: refused when too big, since the person typed it', () => {
    it('keeps text, numbers and yes/no', () => {
      expect(readFormData({ company: 'Acme', seats: 3, agree: true, none: null })).toEqual({ company: 'Acme', seats: 3, agree: true, none: null });
      expect(readFormData(undefined)).toEqual({});
    });

    it('refuses a list, nested values, too many fields, long values and too much in all', () => {
      const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`f${i}`, 'x']));
      const big = Object.fromEntries(Array.from({ length: 5 }, (_, i) => [`f${i}`, 'x'.repeat(4500)]));
      for (const bad of [['a'], 'text', { a: { b: 1 } }, { a: ['x'] }, many, { a: 'x'.repeat(5001) }, big, { ['k'.repeat(101)]: 'x' }]) {
        expect(() => readFormData(bad)).toThrow(/too much/);
      }
    });
  });

  describe('signup metadata: trimmed, since the page gathered it', () => {
    it('keeps the usual fields as they are', () => {
      const meta = { utmSource: 'news', visitCount: 2, isTouchDevice: false, queryParams: { a: '1' } };
      expect(trimSignupMetadata(meta)).toEqual(meta);
    });

    it('cuts long text, drops lists, deep values and extra keys, and never refuses', () => {
      const meta: Record<string, unknown> = {
        referrerUrl: 'x'.repeat(2000),
        list: [1, 2],
        deep: { a: { b: 1 } },
        fn: undefined,
        nan: Number.NaN,
        queryParams: Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`p${i}`, 'y'.repeat(300)])),
      };
      for (let i = 0; i < 100; i++) meta[`k${i}`] = i;
      const out = trimSignupMetadata(meta);
      expect((out['referrerUrl'] as string).length).toBe(500);
      expect(out).not.toHaveProperty('list');
      expect(out['deep']).toEqual({});
      expect(out).not.toHaveProperty('nan');
      const params = out['queryParams'] as Record<string, string>;
      expect(Object.keys(params)).toHaveLength(20);
      expect(params['p0']).toHaveLength(200);
      expect(Object.keys(out).length).toBeLessThanOrEqual(60);
      expect(trimSignupMetadata('rubbish')).toEqual({});
    });
  });

  it('requires the form to exist and be open', async () => {
    await expect(requireActiveForm('ghost')).rejects.toMatchObject({ code: 'not-found' });
    store.set('Waitlists/closed', { isActive: false });
    await expect(requireActiveForm('closed')).rejects.toMatchObject({ code: 'failed-precondition' });
    store.set('Waitlists/open', { name: 'Open' });
    await expect(requireActiveForm('open')).resolves.toBeTruthy();
  });
});
