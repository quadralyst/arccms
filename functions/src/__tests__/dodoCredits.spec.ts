/**
 * Tests for functions/src/dodo-payments/credits.ts
 *
 * Covers: idempotent grants, refund clamping (balance never < 0), consume
 * rejection on insufficient balance, and that the ledger delta always matches the
 * balance change (so the balance stays rebuildable from the ledger).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockRunTransaction, mockLedgerDoc } = vi.hoisted(() => ({
  mockRunTransaction: vi.fn(),
  mockLedgerDoc: vi.fn(),
}));

vi.mock('firebase-admin/firestore', () => ({ Timestamp: { now: () => ({ __now: true }) } }));
vi.mock('../init', () => ({
  db: {
    collection: () => ({ doc: mockLedgerDoc }),
    runTransaction: mockRunTransaction,
  },
}));

import { grantCredits, refundCredits, spendCredits } from '../dodo-payments/credits.js';

const userRef = { __kind: 'user' } as any;

/** Wire a fake transaction: user has `balance`, ledger doc exists per `ledgerExists`. */
function wire({ balance, ledgerExists = false }: { balance: number; ledgerExists?: boolean }) {
  const ledgerRef = { __kind: 'ledger' };
  mockLedgerDoc.mockReturnValue(ledgerRef);
  const sets: Array<{ ref: any; data: any }> = [];
  const tx = {
    get: vi.fn((ref: any) =>
      ref.__kind === 'ledger'
        ? Promise.resolve({ exists: ledgerExists })
        : Promise.resolve({ data: () => ({ creditBalance: balance }) }),
    ),
    set: vi.fn((ref: any, data: any) => sets.push({ ref, data })),
  };
  mockRunTransaction.mockImplementation(async (fn: any) => fn(tx));
  return { sets, tx };
}

beforeEach(() => vi.clearAllMocks());

describe('grantCredits', () => {
  it('adds credits and writes a matching ledger entry', async () => {
    const { sets } = wire({ balance: 5 });
    const res = await grantCredits(userRef, 'u1', 10, { ledgerId: 'grant:pay:1', reason: 'purchase' });

    expect(res).toMatchObject({ applied: 10, balance: 15 });
    const userSet = sets.find((s) => s.ref.__kind === 'user');
    const ledgerSet = sets.find((s) => s.ref.__kind === 'ledger');
    expect(userSet?.data.creditBalance).toBe(15);
    expect(ledgerSet?.data).toMatchObject({ delta: 10, reason: 'purchase', balanceAfter: 15, userId: 'u1' });
  });

  it('is idempotent when the deterministic ledger id already exists', async () => {
    const { sets } = wire({ balance: 5, ledgerExists: true });
    const res = await grantCredits(userRef, 'u1', 10, { ledgerId: 'grant:pay:1' });

    expect(res).toMatchObject({ applied: 0, balance: 5, skipped: true });
    expect(sets.length).toBe(0); // nothing written
  });

  it('no-ops for a non-positive amount', async () => {
    const res = await grantCredits(userRef, 'u1', 0, { ledgerId: 'x' });
    expect(res.skipped).toBe(true);
    expect(mockRunTransaction).not.toHaveBeenCalled();
  });
});

describe('refundCredits', () => {
  it('claws back credits', async () => {
    const { sets } = wire({ balance: 10 });
    const res = await refundCredits(userRef, 'u1', 4, { ledgerId: 'refund:1' });
    expect(res).toMatchObject({ applied: -4, balance: 6 });
    expect(sets.find((s) => s.ref.__kind === 'ledger')?.data.delta).toBe(-4);
  });

  it('clamps so the balance never goes below zero', async () => {
    const { sets } = wire({ balance: 3 });
    const res = await refundCredits(userRef, 'u1', 10, { ledgerId: 'refund:2' });
    expect(res).toMatchObject({ applied: -3, balance: 0 });
    expect(sets.find((s) => s.ref.__kind === 'ledger')?.data.balanceAfter).toBe(0);
  });
});

describe('spendCredits', () => {
  it('debits when the balance is sufficient', async () => {
    const { sets } = wire({ balance: 5 });
    const res = await spendCredits(userRef, 'u1', 3, { note: 'used a feature' });
    expect(res).toMatchObject({ applied: -3, balance: 2 });
    expect(sets.find((s) => s.ref.__kind === 'ledger')?.data).toMatchObject({ reason: 'consume', note: 'used a feature' });
  });

  it('rejects when the balance is insufficient', async () => {
    wire({ balance: 2 });
    await expect(spendCredits(userRef, 'u1', 5)).rejects.toThrow('insufficient-credits');
  });
});
