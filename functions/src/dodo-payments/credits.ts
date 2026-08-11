import { Timestamp, DocumentReference } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { CreditLedgerDoc, CreditLedgerReason, PAYMENT_PROVIDER } from './types.js';

const LEDGER = 'CreditLedger';

export interface CreditResult {
  /** Signed amount actually applied to the balance (may be clamped for refunds). */
  applied: number;
  /** Balance after the operation. */
  balance: number;
  /** True when a deterministic-id entry already existed (idempotent no-op). */
  skipped?: boolean;
}

interface ApplyOpts {
  reason: CreditLedgerReason;
  /** Deterministic ledger doc id → idempotent (grants/refunds). Omit for consume (auto-id). */
  ledgerId?: string;
  productId?: string;
  providerPaymentId?: string;
  providerSubscriptionId?: string;
  /** Gateway behind a grant/refund; omitted for in-app consume. */
  provider?: typeof PAYMENT_PROVIDER;
  note?: string;
  /** Clamp a negative delta so the balance never drops below zero (refunds). */
  clamp?: boolean;
  /** Throw 'insufficient-credits' instead of clamping when the balance is too low (consume). */
  rejectIfInsufficient?: boolean;
}

/**
 * Atomically apply a signed credit delta to a user and append a matching ledger
 * entry, so `creditBalance` always equals the sum of the ledger. When `ledgerId`
 * is provided the write is idempotent (a redelivered webhook won't double-apply).
 */
async function applyCreditDelta(
  userRef: DocumentReference,
  userId: string,
  delta: number,
  opts: ApplyOpts,
): Promise<CreditResult> {
  return db.runTransaction(async (tx) => {
    const ledgerRef = opts.ledgerId ? db.collection(LEDGER).doc(opts.ledgerId) : db.collection(LEDGER).doc();

    // All reads must precede writes in a Firestore transaction.
    const existing = opts.ledgerId ? await tx.get(ledgerRef) : null;
    const userSnap = await tx.get(userRef);

    if (existing && existing.exists) {
      const bal = readBalance(userSnap.data());
      return { applied: 0, balance: bal, skipped: true };
    }

    const current = readBalance(userSnap.data());

    let applied = delta;
    if (delta < 0) {
      const need = -delta;
      if (opts.rejectIfInsufficient && current < need) {
        throw new Error('insufficient-credits');
      }
      if (opts.clamp) applied = -Math.min(current, need);
    }

    const newBalance = current + applied;
    tx.set(userRef, { creditBalance: newBalance, modifiedAt: Timestamp.now() }, { merge: true });

    const entry: CreditLedgerDoc = {
      userId,
      delta: applied,
      reason: opts.reason,
      balanceAfter: newBalance,
      ...(opts.provider ? { provider: opts.provider } : {}),
      ...(opts.productId ? { productId: opts.productId } : {}),
      ...(opts.providerPaymentId ? { providerPaymentId: opts.providerPaymentId } : {}),
      ...(opts.providerSubscriptionId ? { providerSubscriptionId: opts.providerSubscriptionId } : {}),
      ...(opts.note ? { note: opts.note } : {}),
      createdAt: Timestamp.now(),
    };
    tx.set(ledgerRef, entry);

    return { applied, balance: newBalance };
  });
}

function readBalance(data: Record<string, unknown> | undefined): number {
  const v = data?.['creditBalance'];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Idempotently grant credits (purchase or renewal allowance). No-op for amount ≤ 0. */
export function grantCredits(
  userRef: DocumentReference,
  userId: string,
  amount: number,
  opts: { ledgerId: string; reason?: 'purchase' | 'renewal'; productId?: string; providerPaymentId?: string; providerSubscriptionId?: string },
): Promise<CreditResult> {
  if (!(amount > 0)) return Promise.resolve({ applied: 0, balance: 0, skipped: true });
  return applyCreditDelta(userRef, userId, amount, {
    reason: opts.reason ?? 'purchase',
    ledgerId: opts.ledgerId,
    provider: PAYMENT_PROVIDER,
    productId: opts.productId,
    providerPaymentId: opts.providerPaymentId,
    providerSubscriptionId: opts.providerSubscriptionId,
  });
}

/** Idempotently claw back credits on refund, clamped so the balance never goes negative. */
export function refundCredits(
  userRef: DocumentReference,
  userId: string,
  amount: number,
  opts: { ledgerId: string; productId?: string; providerPaymentId?: string },
): Promise<CreditResult> {
  if (!(amount > 0)) return Promise.resolve({ applied: 0, balance: 0, skipped: true });
  return applyCreditDelta(userRef, userId, -amount, {
    reason: 'refund',
    ledgerId: opts.ledgerId,
    clamp: true,
    provider: PAYMENT_PROVIDER,
    productId: opts.productId,
    providerPaymentId: opts.providerPaymentId,
  });
}

/**
 * How many credits a refunded charge should claw back.
 *
 * Reads the allowance that charge actually granted rather than assuming the
 * product's current per-charge figure: a subscription refunded after several
 * renewals granted its allowance once per charge, so `product.creditsGranted`
 * describes one period, not the balance — and if the product's allowance was
 * edited since purchase, it no longer describes even that.
 *
 * A one-time purchase resolves exactly (its grant has a deterministic ledger id
 * keyed on the payment). Subscription payloads carry no payment id on the grant,
 * so the refunded charge maps to the most recent allowance for that subscription.
 * Falls back to the product figure when no ledger entry can be found.
 */
export async function refundableCreditAmount(opts: {
  providerPaymentId?: string;
  providerSubscriptionId?: string;
  fallback: number;
}): Promise<number> {
  if (opts.providerPaymentId) {
    const direct = await db.collection(LEDGER).doc(`grant:pay:${opts.providerPaymentId}`).get();
    const delta = direct.exists ? (direct.data()?.['delta'] as number | undefined) : undefined;
    if (typeof delta === 'number' && delta > 0) return delta;
  }

  if (opts.providerSubscriptionId) {
    const recent = await db
      .collection(LEDGER)
      .where('providerSubscriptionId', '==', opts.providerSubscriptionId)
      .orderBy('createdAt', 'desc')
      .limit(GRANT_LOOKBACK)
      .get();
    const grant = recent.docs
      .map((d) => d.data() as CreditLedgerDoc)
      .find((e) => e.delta > 0 && (e.reason === 'purchase' || e.reason === 'renewal'));
    if (grant) return grant.delta;
  }

  return opts.fallback;
}

/** Ledger entries scanned back from a subscription's newest entry to find its last grant. */
const GRANT_LOOKBACK = 20;

/**
 * Spend credits (app usage). Rejects with Error('insufficient-credits') when the
 * balance is too low. Not idempotent — each call is a distinct debit.
 */
export function spendCredits(
  userRef: DocumentReference,
  userId: string,
  amount: number,
  opts?: { note?: string },
): Promise<CreditResult> {
  return applyCreditDelta(userRef, userId, -amount, {
    reason: 'consume',
    rejectIfInsufficient: true,
    note: opts?.note,
  });
}
