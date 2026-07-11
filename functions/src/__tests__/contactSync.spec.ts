/**
 * Tests for the Contacts sync triggers (functions/src/email-core/contactSync.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockUpsertContact,
  mockUnlinkUserContact,
  mockEnsureSystemLists,
  mockEnsureList,
  mockWaitlistGet,
} = vi.hoisted(() => ({
  mockUpsertContact: vi.fn().mockResolvedValue({ emailHash: 'h', created: true }),
  mockUnlinkUserContact: vi.fn().mockResolvedValue(undefined),
  mockEnsureSystemLists: vi.fn().mockResolvedValue(undefined),
  mockEnsureList: vi.fn().mockResolvedValue(undefined),
  mockWaitlistGet: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
}));

vi.mock('../email-core/contacts', () => ({
  upsertContact: mockUpsertContact,
  unlinkUserContact: mockUnlinkUserContact,
  ensureSystemLists: mockEnsureSystemLists,
  ensureList: mockEnsureList,
  SYSTEM_LISTS: { ALL_USERS: 'all-users', ALL_CUSTOMERS: 'all-customers' },
  waitlistListId: (id: string) => `waitlist-${id}`,
}));

vi.mock('../init', () => ({
  db: { collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockWaitlistGet })) })) },
}));

vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((_p: string, h: any) => h),
  onDocumentDeleted: vi.fn((_p: string, h: any) => h),
  onDocumentUpdated: vi.fn((_p: string, h: any) => h),
}));

import { onUserCreateContact, onUserDeleteContact, onWaitlistVerifiedContact } from '../email-core/contactSync.js';

const createH = onUserCreateContact as unknown as (e: any) => Promise<void>;
const deleteH = onUserDeleteContact as unknown as (e: any) => Promise<void>;
const wlH = onWaitlistVerifiedContact as unknown as (e: any) => Promise<void>;

describe('contactSync triggers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('user create → contact (signup) joining all-users', async () => {
    await createH({ data: { data: () => ({ email: 'a@b.com', name: 'A', uid: 'u1' }) } });
    expect(mockEnsureSystemLists).toHaveBeenCalled();
    expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({
      email: 'a@b.com',
      userId: 'u1',
      source: 'signup',
      addLists: ['all-users'],
    }));
  });

  it('user create with no email is a no-op', async () => {
    await createH({ data: { data: () => ({ name: 'A' }) } });
    expect(mockUpsertContact).not.toHaveBeenCalled();
  });

  it('user delete → unlink contact', async () => {
    await deleteH({ data: { data: () => ({ email: 'a@b.com' }) } });
    expect(mockUnlinkUserContact).toHaveBeenCalledWith('a@b.com');
  });

  it('waitlist verify (false→true) → contact (waitlist) joining waitlist-{id}', async () => {
    await wlH({
      params: { waitlistId: 'wl1' },
      data: {
        before: { data: () => ({ email: 'a@b.com', emailVerified: false }) },
        after: { data: () => ({ email: 'a@b.com', emailVerified: true }) },
      },
    });
    expect(mockEnsureList).toHaveBeenCalledWith('waitlist-wl1', expect.anything());
    expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({
      source: 'waitlist',
      addLists: ['waitlist-wl1'],
    }));
  });

  it('waitlist update that does not flip verification is a no-op', async () => {
    await wlH({
      params: { waitlistId: 'wl1' },
      data: {
        before: { data: () => ({ email: 'a@b.com', emailVerified: true }) },
        after: { data: () => ({ email: 'a@b.com', emailVerified: true, name: 'A' }) },
      },
    });
    expect(mockUpsertContact).not.toHaveBeenCalled();
  });

  it('waitlist verify maps isSubscribed:false to unsubscribed consent', async () => {
    await wlH({
      params: { waitlistId: 'wl1' },
      data: {
        before: { data: () => ({ email: 'a@b.com', emailVerified: false }) },
        after: { data: () => ({ email: 'a@b.com', emailVerified: true, isSubscribed: false }) },
      },
    });
    expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({ consent: 'unsubscribed' }));
  });
});
