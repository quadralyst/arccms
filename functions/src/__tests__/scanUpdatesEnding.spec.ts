/**
 * Tests for the updates-ending reminder scan (E2)
 * (functions/src/dodo-payments/scanUpdatesEnding.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockUsersGet, mockSendPaymentEmail, mockWhere } = vi.hoisted(() => ({
  mockUsersGet: vi.fn(),
  mockSendPaymentEmail: vi.fn().mockResolvedValue(undefined),
  mockWhere: vi.fn(),
}));

vi.mock('../init', () => ({
  db: {
    collection: vi.fn(() => ({ where: mockWhere })),
  },
}));

vi.mock('../dodo-payments/paymentEmailHelper', () => ({ sendPaymentEmail: mockSendPaymentEmail }));

vi.mock('firebase-functions/v2', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

vi.mock('firebase-functions/v2/scheduler', () => ({
  onSchedule: vi.fn((_opts: any, handler: any) => handler),
}));

vi.mock('firebase-admin/firestore', () => ({
  Timestamp: {
    fromDate: vi.fn((d: Date) => ({ __ms: d.getTime() })),
  },
}));

import { scanUpdatesEnding } from '../dodo-payments/scanUpdatesEnding.js';

const handler = scanUpdatesEnding as unknown as () => Promise<void>;

/** A user doc whose updatesUntil is `days` from now. */
function userDoc(email: string, days: number, extra: Record<string, any> = {}) {
  const until = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  const update = vi.fn().mockResolvedValue(undefined);
  return {
    ref: { update },
    data: () => ({ email, premiumType: 'pro', updatesUntil: { toDate: () => until }, ...extra }),
  };
}

describe('scanUpdatesEnding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockReturnValue({ get: mockUsersGet });
    mockSendPaymentEmail.mockResolvedValue(undefined);
  });

  it('queries users by updatesUntil within the window', async () => {
    mockUsersGet.mockResolvedValue({ docs: [] });
    await handler();
    expect(mockWhere).toHaveBeenCalledWith('updatesUntil', '<=', expect.anything());
  });

  it('sends a reminder and sets the dedup flag for a user in-window', async () => {
    const doc = userDoc('a@b.com', 7);
    mockUsersGet.mockResolvedValue({ docs: [doc] });

    await handler();

    expect(mockSendPaymentEmail).toHaveBeenCalledWith(
      'updates_ending_email',
      expect.objectContaining({ email: 'a@b.com' }),
      expect.objectContaining({ plan: 'pro', updatesEndDate: expect.any(String) }),
    );
    expect(doc.ref.update).toHaveBeenCalledWith({ updatesEndingReminderSent: true });
  });

  it('skips users already reminded', async () => {
    const doc = userDoc('a@b.com', 7, { updatesEndingReminderSent: true });
    mockUsersGet.mockResolvedValue({ docs: [doc] });

    await handler();

    expect(mockSendPaymentEmail).not.toHaveBeenCalled();
    expect(doc.ref.update).not.toHaveBeenCalled();
  });

  it('skips users whose updates window already ended', async () => {
    const doc = userDoc('a@b.com', -3); // ended 3 days ago
    mockUsersGet.mockResolvedValue({ docs: [doc] });

    await handler();

    expect(mockSendPaymentEmail).not.toHaveBeenCalled();
  });

  it('re-running after a send produces nothing new (idempotent via flag)', async () => {
    const first = userDoc('a@b.com', 5);
    mockUsersGet.mockResolvedValueOnce({ docs: [first] });
    await handler();
    expect(mockSendPaymentEmail).toHaveBeenCalledTimes(1);

    // Second run: the flag is now set.
    const second = userDoc('a@b.com', 5, { updatesEndingReminderSent: true });
    mockUsersGet.mockResolvedValueOnce({ docs: [second] });
    await handler();
    expect(mockSendPaymentEmail).toHaveBeenCalledTimes(1);
  });
});
