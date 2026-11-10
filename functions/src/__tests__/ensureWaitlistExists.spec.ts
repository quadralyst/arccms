/**
 * ensureWaitlistExists (waitlists/ensureWaitlistExists.ts): the public form script
 * asks for the default form when a page's form is missing, so anyone may have that
 * one created. Any other id needs an admin, and ids are kept to a safe pattern.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store, mockIsAdmin } = vi.hoisted(() => ({ store: new Map<string, any>(), mockIsAdmin: vi.fn() }));

vi.mock('../init', () => ({
  db: {
    collection: (col: string) => ({
      doc: (id: string) => ({
        get: async () => ({ exists: store.has(`${col}/${id}`), data: () => store.get(`${col}/${id}`) }),
        set: async (data: any) => { store.set(`${col}/${id}`, data); },
      }),
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
vi.mock('../search/auth', () => ({
  requireAdmin: async (request: any) => {
    if (!request.auth) throw Object.assign(new Error('Authentication required.'), { code: 'unauthenticated' });
    if (!(await mockIsAdmin(request))) throw Object.assign(new Error('Admin access required.'), { code: 'permission-denied' });
  },
}));
vi.mock('firebase-functions/v2/https', () => ({ onCall: (handler: any) => handler }));

const { ensureWaitlistExists } = await import('../waitlists/ensureWaitlistExists.js');
const anonymous = (waitlistId: unknown) => (ensureWaitlistExists as any)({ data: { waitlistId } });
const signedIn = (waitlistId: unknown) => (ensureWaitlistExists as any)({ data: { waitlistId }, auth: { uid: 'u1', token: {} } });

describe('ensureWaitlistExists', () => {
  beforeEach(() => {
    store.clear();
    mockIsAdmin.mockReset();
    mockIsAdmin.mockResolvedValue(false);
  });

  it('creates the default form for anyone, under its current or its original id', async () => {
    await expect(anonymous('waitlist-form')).resolves.toEqual({ success: true, existed: false });
    await expect(anonymous('default')).resolves.toEqual({ success: true, existed: false });
    expect(store.get('Waitlists/waitlist-form')).toMatchObject({ name: 'Waitlist', isActive: true });
    expect(store.get('Waitlists/default')).toMatchObject({ name: 'Waitlist' });
  });

  it('says the default form exists without writing it again', async () => {
    store.set('Waitlists/waitlist-form', { name: 'Mine' });
    await expect(anonymous('waitlist-form')).resolves.toEqual({ success: true, existed: true });
    expect(store.get('Waitlists/waitlist-form')).toEqual({ name: 'Mine' });
  });

  it('refuses any other id to a visitor or a member, and creates nothing', async () => {
    await expect(anonymous('launch')).rejects.toMatchObject({ code: 'unauthenticated' });
    await expect(signedIn('launch')).rejects.toMatchObject({ code: 'permission-denied' });
    expect(store.size).toBe(0);
  });

  it('creates any other form for an admin', async () => {
    mockIsAdmin.mockResolvedValue(true);
    await expect(signedIn('spring-launch')).resolves.toEqual({ success: true, existed: false });
    expect(store.get('Waitlists/spring-launch')).toMatchObject({ name: 'Spring Launch', slug: 'spring-launch' });
  });

  it('refuses ids outside the safe pattern, before anything else', async () => {
    mockIsAdmin.mockResolvedValue(true);
    for (const bad of [undefined, 42, '', 'a/b', 'waitlist-form/users/x', '../x', '-x', 'x'.repeat(101), 'has space']) {
      await expect(signedIn(bad)).resolves.toEqual({ success: false, reason: 'invalid-waitlist-id' });
    }
    expect(store.size).toBe(0);
  });
});
