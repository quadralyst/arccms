/**
 * Tests for the admin test-send callable (functions/src/email-core/sendTestEmail.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSettingsGet, mockQueueEmail } = vi.hoisted(() => ({
  mockSettingsGet: vi.fn(),
  mockQueueEmail: vi.fn().mockResolvedValue({ id: 'log-1', status: 'pending' }),
}));

vi.mock('../init', () => ({
  db: { collection: vi.fn(() => ({ doc: vi.fn(() => ({ get: mockSettingsGet })) })) },
}));

vi.mock('../email-core/queueEmail', () => ({ queueEmail: mockQueueEmail }));

vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: vi.fn((handler: any) => handler),
  HttpsError: class extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  },
}));

import { sendTestEmail } from '../email-core/sendTestEmail.js';

const handler = sendTestEmail as unknown as (r: any) => Promise<any>;
const adminReq = (data: any) => ({ auth: { token: { role: 'admin' } }, data });

describe('sendTestEmail', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSettingsGet.mockResolvedValue({ data: () => ({ senderEmail: 's@x.com', senderName: 'Site', isEnabled: true, activeProvider: 'smtp' }) });
    mockQueueEmail.mockResolvedValue({ id: 'log-1', status: 'pending' });
  });

  it('rejects non-admins', async () => {
    await expect(handler({ auth: { token: { role: 'user' } }, data: {} })).rejects.toMatchObject({ code: 'permission-denied' });
  });

  it('rejects an invalid recipient', async () => {
    await expect(handler(adminReq({ toEmail: 'nope', html: '<p>x</p>' }))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('rejects empty content', async () => {
    await expect(handler(adminReq({ toEmail: 'a@b.com', html: '' }))).rejects.toMatchObject({ code: 'invalid-argument' });
  });

  it('queues via queueEmail with source test / transactional and a [TEST] subject', async () => {
    const res = await handler(adminReq({ toEmail: 'a@b.com', subject: 'Hello', html: '<p>hi</p>' }));
    expect(res).toEqual({ status: 'pending' });
    expect(mockQueueEmail).toHaveBeenCalledWith(expect.objectContaining({
      source: 'test',
      category: 'transactional',
      toEmail: 'a@b.com',
      subject: '[TEST] Hello',
      template: '<p>hi</p>',
    }));
  });
});
