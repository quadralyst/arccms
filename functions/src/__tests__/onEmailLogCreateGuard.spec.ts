/**
 * Tests that onEmailLogCreate only sends `pending` docs and never delivers the
 * blocked docs that queueEmail() writes (skipped / suppressed / etc.).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSendMail } = vi.hoisted(() => ({ mockSendMail: vi.fn().mockResolvedValue(undefined) }));

vi.mock('../mail-config/mailConfig', () => ({ sendMail: mockSendMail }));

vi.mock('firebase-functions/v2/firestore', () => ({
  onDocumentCreated: vi.fn((_path: string, handler: any) => handler),
}));

import { onEmailLogCreate } from '../email-log/createEmailLog.js';

const handler = onEmailLogCreate as unknown as (event: any) => Promise<void>;

function event(data: any) {
  return { data: { data: () => data }, params: { EmailLogsId: 'log-1' } };
}

describe('onEmailLogCreate status guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends when status is pending', async () => {
    await handler(event({ toEmail: 'a@b.com', status: 'pending' }));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    expect(mockSendMail).toHaveBeenCalledWith(expect.objectContaining({ status: 'pending' }), 'log-1');
  });

  it('sends when status is absent (legacy/defensive)', async () => {
    await handler(event({ toEmail: 'a@b.com' }));
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it.each(['skipped', 'suppressed', 'deferred', 'retrying', 'success', 'failed'])(
    'does NOT send when status is %s',
    async (status) => {
      await handler(event({ toEmail: 'a@b.com', status }));
      expect(mockSendMail).not.toHaveBeenCalled();
    },
  );

  it('does nothing when there is no data', async () => {
    await handler({ data: undefined, params: { EmailLogsId: 'log-1' } });
    expect(mockSendMail).not.toHaveBeenCalled();
  });
});
