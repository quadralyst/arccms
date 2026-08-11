import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { spendCredits } from './credits.js';

/**
 * Callable: spend the authenticated user's prepaid credits (app usage).
 *
 * Server-authoritative — clients cannot write `creditBalance` directly (Firestore
 * rules block it), so consumption must go through here. Debits atomically and
 * rejects when the balance is insufficient; every debit is recorded in the
 * append-only CreditLedger.
 */
export const consumeCredits = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const amount = Number(request.data?.amount);
  if (!Number.isInteger(amount) || amount <= 0) {
    throw new HttpsError('invalid-argument', 'amount must be a positive integer.');
  }
  const note = typeof request.data?.note === 'string' ? request.data.note : undefined;

  const uid = request.auth.uid;
  const snap = await db.collection('users').where('uid', '==', uid).limit(1).get();
  if (snap.empty) {
    throw new HttpsError('not-found', 'User record not found.');
  }
  const userRef = snap.docs[0].ref;

  try {
    const result = await spendCredits(userRef, uid, amount, { note });
    return { balance: result.balance, spent: -result.applied };
  } catch (error) {
    if (error instanceof Error && error.message === 'insufficient-credits') {
      throw new HttpsError('failed-precondition', 'Insufficient credits.');
    }
    logger.error('consumeCredits failed', error);
    throw new HttpsError('internal', 'Failed to consume credits.');
  }
});
