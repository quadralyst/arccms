/**
 * Tests for the announcement fan-out (functions/src/email-core/announcements.ts) — verify #5.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const {
  mockAnnUpdate, mockUsersGet, mockCreateNotif, mockGetConsent,
} = vi.hoisted(() => ({
  mockAnnUpdate: vi.fn().mockResolvedValue(undefined),
  mockUsersGet: vi.fn(),
  mockCreateNotif: vi.fn().mockResolvedValue('n1'),
  mockGetConsent: vi.fn().mockResolvedValue('subscribed'),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'Announcements') return { add: vi.fn().mockResolvedValue({ id: 'ann1', update: mockAnnUpdate }) };
      if (name === 'users') {
        const chain: any = { where: vi.fn(() => chain), limit: vi.fn(() => chain), get: mockUsersGet };
        return chain;
      }
      return {};
    }),
  },
}));

vi.mock('../email-core/notifications', () => ({ createNotification: mockCreateNotif }));
vi.mock('../email-core/contacts', () => ({ getContactConsent: mockGetConsent }));
vi.mock('../constant', () => ({ constant: { isProduction: false, live_url: 'https://x/', local_url: 'http://l/' } }));
vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: vi.fn(() => ({ seconds: 0 })) } }));
vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((h: any) => h),
  HttpsError: class extends Error { code: string; constructor(c: string, m: string) { super(m); this.code = c; } },
}));

import { sendAnnouncement } from '../email-core/announcements.js';

const handler = sendAnnouncement as unknown as (r: any) => Promise<any>;
const adminReq = (data: any) => ({ auth: { uid: 'admin1', token: { role: 'admin' } }, data });

describe('sendAnnouncement', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConsent.mockResolvedValue('subscribed');
    mockUsersGet.mockResolvedValue({
      docs: [
        { data: () => ({ uid: 'u1', email: 'a@x.com' }) },
        { data: () => ({ uid: 'u2', email: 'b@x.com' }) },
        { data: () => ({ uid: 'u3', email: 'c@x.com' }) },
      ],
    });
  });

  it('rejects non-admins', async () => {
    await expect(handler({ auth: { token: { role: 'user' } }, data: {} })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('fans out to all users with counts (email on)', async () => {
    const res = await handler(adminReq({ title: 'Hi', body: 'News', sendEmail: true, audience: { kind: 'all' } }));
    expect(mockCreateNotif).toHaveBeenCalledTimes(3);
    expect(res).toMatchObject({ targeted: 3, notified: 3, emailed: 3 });
  });

  it('excludes unsubscribed contacts from the emailed count', async () => {
    mockGetConsent.mockImplementation(async (hash: string) => (hash ? 'subscribed' : 'subscribed'));
    // Make the second recipient unsubscribed.
    let call = 0;
    mockGetConsent.mockImplementation(async () => (++call === 2 ? 'unsubscribed' : 'subscribed'));
    const res = await handler(adminReq({ title: 'Hi', body: 'News', sendEmail: true, audience: { kind: 'all' } }));
    expect(res.notified).toBe(3);
    expect(res.emailed).toBe(2);
  });

  it('email off ⇒ notifications created with suppressEmail, emailed 0', async () => {
    const res = await handler(adminReq({ title: 'Hi', body: 'News', sendEmail: false, audience: { kind: 'all' } }));
    expect(mockCreateNotif).toHaveBeenCalledWith(expect.objectContaining({ suppressEmail: true }));
    expect(res.emailed).toBe(0);
  });
});
