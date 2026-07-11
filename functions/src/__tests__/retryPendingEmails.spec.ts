/**
 * Tests for the retry scheduler (functions/src/email-core/retryPendingEmails.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockSendMail, statusQueries, mockGetFactory } = vi.hoisted(() => {
  const statusQueries: Record<string, any[]> = { retrying: [], deferred: [] };
  return {
    mockSendMail: vi.fn().mockResolvedValue(undefined),
    statusQueries,
    mockGetFactory: vi.fn(),
  };
});

vi.mock('../mail-config/mailConfig', () => ({
  sendMail: mockSendMail,
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn(() => {
      // Chain: .where('status','==',X).where('nextAttemptAt','<=',now).limit(n).get()
      let capturedStatus = '';
      const chain: any = {
        where: vi.fn((field: string, _op: string, value: any) => {
          if (field === 'status') capturedStatus = value;
          return chain;
        }),
        limit: vi.fn(() => chain),
        get: vi.fn(async () => ({ docs: statusQueries[capturedStatus] || [] })),
      };
      return chain;
    }),
  },
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: vi.fn(() => ({ seconds: 100, nanoseconds: 0 })) },
}));

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((_opts: any, handler: any) => handler),
}));

import { retryPendingEmails } from '../email-core/retryPendingEmails.js';

const handler = retryPendingEmails as unknown as () => Promise<void>;

function doc(id: string) {
  return { id, data: () => ({ toEmail: `${id}@x.com`, status: 'retrying' }) };
}

describe('retryPendingEmails', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    statusQueries.retrying = [];
    statusQueries.deferred = [];
    mockSendMail.mockResolvedValue(undefined);
  });

  it('re-runs sendMail for each due retrying + deferred doc', async () => {
    statusQueries.retrying = [doc('a'), doc('b')];
    statusQueries.deferred = [doc('c')];

    await handler();

    expect(mockSendMail).toHaveBeenCalledTimes(3);
    const ids = mockSendMail.mock.calls.map((c) => c[1]);
    expect(ids).toEqual(['a', 'b', 'c']);
  });

  it('does nothing when no docs are due', async () => {
    await handler();
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it('continues past a sendMail failure', async () => {
    statusQueries.retrying = [doc('a'), doc('b')];
    mockSendMail.mockRejectedValueOnce(new Error('boom'));

    await expect(handler()).resolves.toBeUndefined();
    expect(mockSendMail).toHaveBeenCalledTimes(2);
  });

  it('schedules every 5 minutes (source check)', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const { dirname, resolve } = await import('node:path');
    const dir = dirname(fileURLToPath(import.meta.url));
    const src = readFileSync(resolve(dir, '../email-core/retryPendingEmails.ts'), 'utf-8');
    expect(src).toContain("schedule: 'every 5 minutes'");
    expect(src).toContain("from 'firebase-functions/v2/scheduler'");
  });
});
