/**
 * Tests for the U1 template doc-id normalization callable
 * (functions/src/email-core/normalizeWaitlistTemplateIds.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { store } = vi.hoisted(() => ({ store: new Map<string, any>() }));

function docRef(path: string) {
  return { path, id: path.split('/').slice(1).join('/') };
}

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((col: string) => ({
      doc: (id: string) => docRef(`${col}/${id}`),
      get: async () => {
        const docs = [...store.entries()]
          .filter(([path]) => path.startsWith(`${col}/`))
          .map(([path, data]) => ({ id: path.slice(col.length + 1), data: () => data }));
        return { empty: docs.length === 0, size: docs.length, docs };
      },
    })),
    batch: () => {
      const ops: Array<() => void> = [];
      return {
        set: (ref: any, data: any) => ops.push(() => store.set(ref.path, data)),
        delete: (ref: any) => ops.push(() => store.delete(ref.path)),
        commit: async () => ops.forEach((op) => op()),
      };
    },
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

import { normalizeWaitlistTemplateIds } from '../email-core/normalizeWaitlistTemplateIds.js';

const admin = { auth: { token: { role: 'admin' } } } as any;
const call = (data: any = {}) => (normalizeWaitlistTemplateIds as any)({ ...admin, data });

const WELCOME = 'waitlist_welcome_email';

describe('normalizeWaitlistTemplateIds', () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it('rejects non-admins', async () => {
    await expect(
      (normalizeWaitlistTemplateIds as any)({ auth: { token: { role: 'user' } }, data: {} }),
    ).rejects.toThrow(/Admin role required/);
  });

  it('leaves an already-canonical collection untouched', async () => {
    store.set(`EmailTemplate/wl-1_${WELCOME}`, { waitlistId: 'wl-1', type: WELCOME, subject: 'Hi' });

    const res = await call();

    expect(res).toMatchObject({ normalized: 0, deleted: 0, skipped: 1 });
    expect(store.has(`EmailTemplate/wl-1_${WELCOME}`)).toBe(true);
  });

  it('moves a legacy-id doc onto the canonical id', async () => {
    store.set(`EmailTemplate/${WELCOME}_wl-1`, { waitlistId: 'wl-1', type: WELCOME, subject: 'Hi' });

    const res = await call();

    expect(res).toMatchObject({ normalized: 1, deleted: 1, skipped: 0 });
    expect(store.has(`EmailTemplate/${WELCOME}_wl-1`)).toBe(false);
    expect(store.get(`EmailTemplate/wl-1_${WELCOME}`)).toMatchObject({
      id: `wl-1_${WELCOME}`,
      waitlistId: 'wl-1',
      type: WELCOME,
      subject: 'Hi',
    });
  });

  it('keeps the admin-edited copy when a seeded duplicate exists', async () => {
    // Seeded by the old trigger id scheme...
    store.set(`EmailTemplate/${WELCOME}_wl-1`, {
      waitlistId: 'wl-1', type: WELCOME, subject: 'Seeded default',
      createdBy: 'system', modifiedAt: new Date('2026-01-01'),
    });
    // ...and edited by the admin under the canonical id.
    store.set(`EmailTemplate/wl-1_${WELCOME}`, {
      waitlistId: 'wl-1', type: WELCOME, subject: 'Admin copy',
      updatedAt: new Date('2025-06-01'), // older, but human-authored
    });

    const res = await call();

    expect(res.normalized).toBe(1);
    expect(store.get(`EmailTemplate/wl-1_${WELCOME}`).subject).toBe('Admin copy');
    expect(store.has(`EmailTemplate/${WELCOME}_wl-1`)).toBe(false);
  });

  it('promotes an admin-edited legacy doc over a seeded canonical one', async () => {
    store.set(`EmailTemplate/${WELCOME}_wl-1`, {
      waitlistId: 'wl-1', type: WELCOME, subject: 'Admin copy', updatedAt: new Date('2026-02-01'),
    });
    store.set(`EmailTemplate/wl-1_${WELCOME}`, {
      waitlistId: 'wl-1', type: WELCOME, subject: 'Seeded default', createdBy: 'system',
    });

    await call();

    expect(store.get(`EmailTemplate/wl-1_${WELCOME}`).subject).toBe('Admin copy');
    expect(store.has(`EmailTemplate/${WELCOME}_wl-1`)).toBe(false);
  });

  it('falls back to most-recently-modified when both copies are seeded', async () => {
    store.set(`EmailTemplate/${WELCOME}_wl-1`, {
      waitlistId: 'wl-1', type: WELCOME, subject: 'Newer', createdBy: 'system',
      modifiedAt: { toMillis: () => new Date('2026-05-01').getTime() },
    });
    store.set(`EmailTemplate/wl-1_${WELCOME}`, {
      waitlistId: 'wl-1', type: WELCOME, subject: 'Older', createdBy: 'system',
      modifiedAt: { toMillis: () => new Date('2026-01-01').getTime() },
    });

    await call();

    expect(store.get(`EmailTemplate/wl-1_${WELCOME}`).subject).toBe('Newer');
  });

  it('never touches global templates', async () => {
    store.set('EmailTemplate/signup_otp_email', { type: 'signup_otp_email', scope: 'global' });

    const res = await call();

    expect(res).toMatchObject({ groups: 0, normalized: 0 });
    expect(store.get('EmailTemplate/signup_otp_email')).toMatchObject({ scope: 'global' });
  });

  it('normalizes each (form, type) pair independently', async () => {
    store.set(`EmailTemplate/${WELCOME}_wl-1`, { waitlistId: 'wl-1', type: WELCOME });
    store.set('EmailTemplate/waitlist_verify_otp_email_wl-1', {
      waitlistId: 'wl-1', type: 'waitlist_verify_otp_email',
    });
    store.set(`EmailTemplate/wl-2_${WELCOME}`, { waitlistId: 'wl-2', type: WELCOME });

    const res = await call();

    expect(res).toMatchObject({ groups: 3, normalized: 2, skipped: 1 });
    expect(store.has(`EmailTemplate/wl-1_${WELCOME}`)).toBe(true);
    expect(store.has('EmailTemplate/wl-1_waitlist_verify_otp_email')).toBe(true);
  });

  it('dryRun reports the plan without writing', async () => {
    store.set(`EmailTemplate/${WELCOME}_wl-1`, { waitlistId: 'wl-1', type: WELCOME, subject: 'Hi' });

    const res = await call({ dryRun: true });

    expect(res).toMatchObject({ dryRun: true, normalized: 1, deleted: 1 });
    expect(res.details[0]).toMatchObject({
      formId: 'wl-1', type: WELCOME, keptFrom: `${WELCOME}_wl-1`, removed: [`${WELCOME}_wl-1`],
    });
    // Nothing moved.
    expect(store.has(`EmailTemplate/${WELCOME}_wl-1`)).toBe(true);
    expect(store.has(`EmailTemplate/wl-1_${WELCOME}`)).toBe(false);
  });

  it('is idempotent — a second run is all-skipped', async () => {
    store.set(`EmailTemplate/${WELCOME}_wl-1`, { waitlistId: 'wl-1', type: WELCOME, subject: 'Hi' });

    await call();
    const second = await call();

    expect(second).toMatchObject({ normalized: 0, deleted: 0, skipped: 1 });
  });
});
