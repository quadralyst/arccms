import { randomBytes } from 'node:crypto';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../init.js';
import { DodoWebhookData } from './types.js';

/**
 * Admin test checkouts ("test this tier" on the Products page).
 *
 * A test charge is recorded with no side effects (handlePaymentEvent.ts). Checkout
 * metadata is not proof of anything: a gateway's own payment links let a buyer put
 * their own metadata on a checkout, so a plain `test: 'true'` could be typed by
 * anyone. Instead createTestCheckoutLink puts a random token in `metadata.test` and
 * keeps it here, with the product it was made for; only an event whose token is
 * here, for the same product, counts as a test. Anything else is handled as a real
 * purchase, with every check a real purchase gets.
 *
 * A token is good for a week from when it was made: an unused link older than that
 * is no test any more. The first events of a test checkout bind the token to their
 * payment and subscription, so a later renewal or refund of that same test stays a
 * test however old the token is.
 *
 * `TestCheckouts/{token}`: written and read only by the functions.
 */
export const TEST_CHECKOUTS_COLLECTION = 'TestCheckouts';

/** How long a new test checkout link counts as a test: 7 days. */
export const TEST_CHECKOUT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Make and keep a token for one admin test checkout. */
export async function createTestCheckoutToken(productId: string, adminUid: string): Promise<string> {
  const token = `t_${randomBytes(16).toString('hex')}`;
  await db.collection(TEST_CHECKOUTS_COLLECTION).doc(token).set({ productId, adminUid, createdAt: Timestamp.now() });
  return token;
}

/** Forget a token whose checkout was never made (the gateway call failed). */
export async function deleteTestCheckoutToken(token: string): Promise<void> {
  await db.collection(TEST_CHECKOUTS_COLLECTION).doc(token).delete();
}

const ids = (value: unknown): string[] => (Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : []);

/** Whether an event came from an admin test checkout made by createTestCheckoutLink. */
export async function isAdminTestCheckout(data: DodoWebhookData, now = Date.now()): Promise<boolean> {
  const token = data?.metadata?.test;
  if (typeof token !== 'string' || !/^t_[0-9a-f]{32}$/.test(token)) return false;
  const ref = db.collection(TEST_CHECKOUTS_COLLECTION).doc(token);
  const snap = await ref.get();
  const kept = snap.exists ? snap.data() ?? {} : null;
  if (!kept || kept['productId'] !== data.metadata?.productId) return false;

  const paymentIds = ids(kept['paymentIds']);
  const subscriptionIds = ids(kept['subscriptionIds']);
  const bound = (!!data.payment_id && paymentIds.includes(data.payment_id))
    || (!!data.subscription_id && subscriptionIds.includes(data.subscription_id));
  if (bound) return true;

  const createdAt = kept['createdAt'] as { toMillis?: () => number } | undefined;
  const madeAt = typeof createdAt?.toMillis === 'function' ? createdAt.toMillis() : 0;
  if (now - madeAt > TEST_CHECKOUT_TTL_MS) return false;

  // Bind the token to this checkout's own ids, so its later events stay a test.
  const patch: Record<string, string[]> = {};
  if (data.payment_id) patch['paymentIds'] = [...paymentIds, data.payment_id];
  if (data.subscription_id) patch['subscriptionIds'] = [...subscriptionIds, data.subscription_id];
  if (Object.keys(patch).length) await ref.set(patch, { merge: true });
  return true;
}
