/**
 * Tests for the duplicate-EmailTemplate cleanup callable
 * (functions/src/email-core/dedupeEmailTemplates.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockCollectionGet, mockBatchDelete, mockBatchCommit } = vi.hoisted(() => ({
  mockCollectionGet: vi.fn(),
  mockBatchDelete: vi.fn(),
  mockBatchCommit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn(() => ({ get: mockCollectionGet })),
    batch: vi.fn(() => ({ delete: mockBatchDelete, commit: mockBatchCommit })),
  },
}));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((h: any) => h),
  HttpsError: class extends Error {
    code: string;
    constructor(c: string, m: string) { super(m); this.code = c; }
  },
}));

import { dedupeEmailTemplates } from '../email-core/dedupeEmailTemplates.js';

const handler = dedupeEmailTemplates as unknown as (r: any) => Promise<any>;
const adminReq = { auth: { token: { role: 'admin' } } };

/** Build a fake QueryDocumentSnapshot. */
function docOf(id: string, data: Record<string, unknown>) {
  return { id, ref: { id }, data: () => data };
}

describe('dedupeEmailTemplates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects non-admins', async () => {
    await expect(handler({ auth: { token: { role: 'user' } } })).rejects.toMatchObject({ code: 'permission-denied' });
    expect(mockCollectionGet).not.toHaveBeenCalled();
  });

  it('deletes duplicates, keeping the deterministic-id doc per (type, waitlist)', async () => {
    const docs = [
      docOf('auto1', { type: 'waitlist_welcome_email', waitlistId: 'w1', createdAt: { toMillis: () => 100 } }),
      docOf('auto2', { type: 'waitlist_welcome_email', waitlistId: 'w1', createdAt: { toMillis: () => 200 } }),
      docOf('waitlist_welcome_email_w1', { type: 'waitlist_welcome_email', waitlistId: 'w1', createdAt: { toMillis: () => 300 } }),
      docOf('signup_otp_email', { type: 'signup_otp_email', createdAt: { toMillis: () => 50 } }),
      docOf('typeless', {}),
    ];
    mockCollectionGet.mockResolvedValue({ size: docs.length, docs });

    const res = await handler(adminReq);

    expect(res).toEqual({ duplicateGroups: 1, deleted: 2, scanned: 5 });
    // The two auto-id docs are deleted; the deterministic-id doc is kept.
    const deletedIds = mockBatchDelete.mock.calls.map(([ref]: any[]) => ref.id).sort();
    expect(deletedIds).toEqual(['auto1', 'auto2']);
    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('keeps the oldest doc when no deterministic-id doc is present', async () => {
    const docs = [
      docOf('newer', { type: 'waitlist_welcome_email', waitlistId: 'w2', createdAt: { toMillis: () => 500 } }),
      docOf('older', { type: 'waitlist_welcome_email', waitlistId: 'w2', createdAt: { toMillis: () => 100 } }),
    ];
    mockCollectionGet.mockResolvedValue({ size: docs.length, docs });

    const res = await handler(adminReq);

    expect(res).toEqual({ duplicateGroups: 1, deleted: 1, scanned: 2 });
    expect(mockBatchDelete.mock.calls.map(([r]: any[]) => r.id)).toEqual(['newer']);
  });

  it('is a no-op on an already-deduped collection', async () => {
    const docs = [
      docOf('signup_otp_email', { type: 'signup_otp_email' }),
      docOf('waitlist_welcome_email_w1', { type: 'waitlist_welcome_email', waitlistId: 'w1' }),
    ];
    mockCollectionGet.mockResolvedValue({ size: docs.length, docs });

    const res = await handler(adminReq);

    expect(res).toEqual({ duplicateGroups: 0, deleted: 0, scanned: 2 });
    expect(mockBatchDelete).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });
});
