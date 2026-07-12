/**
 * Tests for the scheduled-broadcast activator
 * (functions/src/email-log/processScheduledBroadcasts.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockGet, mockContinueAdd, mockWhere } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockContinueAdd: vi.fn().mockResolvedValue({ id: 'c1' }),
  mockWhere: vi.fn(),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn((name: string) => {
      if (name === 'BroadcastEmails') return { where: mockWhere };
      if (name === '_broadcast_continue') return { add: mockContinueAdd };
      return {};
    }),
  },
}));

vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('firebase-functions/v2/scheduler', () => ({ onSchedule: vi.fn((_o: any, h: any) => h) }));
vi.mock('firebase-admin/firestore', () => ({
  Timestamp: { now: vi.fn(() => ({ toMillis: () => Date.now() })) },
}));

import { processScheduledBroadcasts } from '../email-log/processScheduledBroadcasts.js';

const handler = processScheduledBroadcasts as unknown as () => Promise<void>;

function due(id: string, msAgo: number) {
  const update = vi.fn().mockResolvedValue(undefined);
  return { id, ref: { update }, data: () => ({ scheduledAt: { toMillis: () => Date.now() - msAgo } }) };
}

describe('processScheduledBroadcasts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockReturnValue({ where: mockWhere, limit: vi.fn().mockReturnValue({ get: mockGet }) });
  });

  it('activates a due broadcast: flips to queued + enqueues continuation', async () => {
    const doc = due('b1', 60 * 1000); // 1 minute ago
    mockGet.mockResolvedValue({ docs: [doc] });

    await handler();

    expect(doc.ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'queued' }));
    expect(mockContinueAdd).toHaveBeenCalledWith(expect.objectContaining({ broadcastId: 'b1' }));
  });

  it('parks a stale (>24h overdue) broadcast as failed instead of firing', async () => {
    const doc = due('b2', 25 * 60 * 60 * 1000); // 25h ago
    mockGet.mockResolvedValue({ docs: [doc] });

    await handler();

    expect(doc.ref.update).toHaveBeenCalledWith(expect.objectContaining({ status: 'failed' }));
    expect(mockContinueAdd).not.toHaveBeenCalled();
  });

  it('does nothing when nothing is due', async () => {
    mockGet.mockResolvedValue({ docs: [] });
    await handler();
    expect(mockContinueAdd).not.toHaveBeenCalled();
  });
});
