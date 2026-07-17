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
  mockGetContactConsent,
  mockSetContactConsent,
  mockAddTagsToContact,
} = vi.hoisted(() => ({
  mockUpsertContact: vi.fn().mockResolvedValue({ emailHash: 'h', created: true }),
  mockUnlinkUserContact: vi.fn().mockResolvedValue(undefined),
  mockEnsureSystemLists: vi.fn().mockResolvedValue(undefined),
  mockEnsureList: vi.fn().mockResolvedValue(undefined),
  mockWaitlistGet: vi.fn().mockResolvedValue({ exists: false, data: () => ({}) }),
  mockGetContactConsent: vi.fn().mockResolvedValue('pending'),
  mockSetContactConsent: vi.fn().mockResolvedValue(undefined),
  mockAddTagsToContact: vi.fn().mockResolvedValue([]),
}));

vi.mock('../email-core/contactTags', () => ({
  addTagsToContact: mockAddTagsToContact,
}));

vi.mock('../email-core/contacts', () => ({
  upsertContact: mockUpsertContact,
  unlinkUserContact: mockUnlinkUserContact,
  ensureSystemLists: mockEnsureSystemLists,
  ensureList: mockEnsureList,
  getContactConsent: mockGetContactConsent,
  setContactConsent: mockSetContactConsent,
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

import {
  onUserCreateContact,
  onUserDeleteContact,
  onWaitlistUserCreateContact,
  onWaitlistVerifiedContact,
} from '../email-core/contactSync.js';

const createH = onUserCreateContact as unknown as (e: any) => Promise<void>;
const deleteH = onUserDeleteContact as unknown as (e: any) => Promise<void>;
const wlH = onWaitlistVerifiedContact as unknown as (e: any) => Promise<void>;
const signupH = onWaitlistUserCreateContact as unknown as (e: any) => Promise<void>;

/** A form signup event (member doc just created under Waitlists/{id}/users). */
const signupEvent = (member: Record<string, unknown>, waitlistId = 'wl1') => ({
  params: { waitlistId },
  data: { data: () => member },
});

/** A member-doc update event (before → after). */
const updateEvent = (before: Record<string, unknown>, after: Record<string, unknown>, waitlistId = 'wl1') => ({
  params: { waitlistId },
  data: { before: { data: () => before }, after: { data: () => after } },
});

describe('contactSync triggers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUpsertContact.mockResolvedValue({ emailHash: 'h', created: true });
    mockGetContactConsent.mockResolvedValue('pending');
  });

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

  it('app-user signup keeps its existing consent — pending is form-signups only (U2 scope guard)', async () => {
    // U2 makes *form* signups pending. Registering an app account must keep the
    // pre-U2 behavior: no consent override, so upsertContact's 'subscribed'
    // default stands.
    await createH({ data: { data: () => ({ email: 'a@b.com', name: 'A', uid: 'u1' }) } });

    const params = mockUpsertContact.mock.calls[0][0];
    expect(params.consent).toBeUndefined();
    expect(params.source).toBe('signup');
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

  // --- U2: contact exists from the moment of signup ---

  describe('U2 pending contact at signup', () => {
    it('unverified signup → pending contact on the form list', async () => {
      await signupH(signupEvent({ email: 'a@b.com', name: 'A', emailVerified: false }));

      expect(mockEnsureList).toHaveBeenCalledWith('waitlist-wl1', expect.anything());
      expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({
        email: 'a@b.com',
        source: 'waitlist',
        addLists: ['waitlist-wl1'],
        consent: 'pending',
      }));
    });

    it('signup with no emailVerified field yet is still pending', async () => {
      await signupH(signupEvent({ email: 'a@b.com' }));

      expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({ consent: 'pending' }));
    });

    it('direct-join signup (verified at creation) starts subscribed', async () => {
      // Direct-join forms skip OTP, so there is no later verify edge to promote on.
      await signupH(signupEvent({ email: 'a@b.com', emailVerified: true, isDirectJoined: true }));

      expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({ consent: 'subscribed' }));
    });

    it('explicit isSubscribed:false at signup beats pending', async () => {
      await signupH(signupEvent({ email: 'a@b.com', emailVerified: false, isSubscribed: false }));

      expect(mockUpsertContact).toHaveBeenCalledWith(expect.objectContaining({ consent: 'unsubscribed' }));
    });

    it('signup with no email is a no-op', async () => {
      await signupH(signupEvent({ name: 'A' }));

      expect(mockUpsertContact).not.toHaveBeenCalled();
    });

    it('a failing upsert is swallowed so the signup write still stands', async () => {
      mockUpsertContact.mockRejectedValueOnce(new Error('boom'));

      await expect(signupH(signupEvent({ email: 'a@b.com' }))).resolves.toBeUndefined();
    });

    it("applies the form's default tag to the new contact (U2)", async () => {
      mockWaitlistGet.mockResolvedValueOnce({
        exists: true, data: () => ({ name: 'Alpha', defaultTagId: 'early-bird' }),
      });

      await signupH(signupEvent({ email: 'a@b.com' }));

      expect(mockAddTagsToContact).toHaveBeenCalledWith('h', ['early-bird']);
    });

    it('no default tag configured → no tagging call', async () => {
      mockWaitlistGet.mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Alpha' }) });

      await signupH(signupEvent({ email: 'a@b.com' }));

      expect(mockAddTagsToContact).not.toHaveBeenCalled();
    });

    it('names the form list from the form doc', async () => {
      mockWaitlistGet.mockResolvedValueOnce({ exists: true, data: () => ({ name: 'Alpha' }) });

      await signupH(signupEvent({ email: 'a@b.com' }));

      expect(mockEnsureList).toHaveBeenCalledWith('waitlist-wl1', { name: 'Alpha', type: 'system' });
    });
  });

  describe('U2 verification promotes pending → subscribed', () => {
    it('promotes a pending contact on the verify edge', async () => {
      // upsertContact ignores `consent` on an existing doc, so without this
      // explicit set the contact would stay pending forever and never be mailable.
      mockGetContactConsent.mockResolvedValue('pending');

      await wlH(updateEvent({ email: 'a@b.com', emailVerified: false }, { email: 'a@b.com', emailVerified: true }));

      expect(mockSetContactConsent).toHaveBeenCalledWith('h', 'subscribed', 'a@b.com');
    });

    it('leaves an already-subscribed contact alone (no downgrade)', async () => {
      // A returning subscriber joining a second form must not be touched.
      mockGetContactConsent.mockResolvedValue('subscribed');

      await wlH(updateEvent({ email: 'a@b.com', emailVerified: false }, { email: 'a@b.com', emailVerified: true }));

      expect(mockSetContactConsent).not.toHaveBeenCalled();
    });

    it('never resurrects an unsubscribed contact by verifying an address', async () => {
      mockGetContactConsent.mockResolvedValue('unsubscribed');

      await wlH(updateEvent({ email: 'a@b.com', emailVerified: false }, { email: 'a@b.com', emailVerified: true }));

      expect(mockSetContactConsent).not.toHaveBeenCalled();
    });

    it('honours an explicit opt-out recorded on the member doc', async () => {
      mockGetContactConsent.mockResolvedValue('subscribed');

      await wlH(updateEvent(
        { email: 'a@b.com', emailVerified: false },
        { email: 'a@b.com', emailVerified: true, isSubscribed: false },
      ));

      expect(mockSetContactConsent).toHaveBeenCalledWith('h', 'unsubscribed', 'a@b.com');
    });
  });
});
