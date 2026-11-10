import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db, owner } from '../init.js';
import { getDodoClient } from './dodoClient.js';
import { ProductDoc, providerProductId } from './types.js';
import { isArcAdmin } from '../users/claims.js';
import { loadProductCodes, tierDiscountCode } from './productCodes.js';
import { createTestCheckoutToken, deleteTestCheckoutToken } from './testCheckouts.js';

/**
 * Callable (admin only): generate a Dodo checkout URL for a SPECIFIC tier, so an
 * admin can copy/open it to verify that tier's price.
 *
 * Unlike createCheckoutSession (which auto-resolves the tier from purchaseCount
 * for real buyers), this lets the admin test any tier directly by passing its
 * position (`tierIndex`); the code comes from the admin-only ProductCodes
 * document. The session carries a `test` token that only this function makes
 * (testCheckouts.ts), so the webhook can tell an admin's test from a buyer who
 * typed `test` into a checkout link's metadata.
 */
export const createTestCheckoutLink = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const userRecord = await owner.getUser(request.auth.uid);
  if (!isArcAdmin(userRecord.customClaims)) {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  const productId = request.data?.productId;
  const tierIndex = request.data?.tierIndex;
  if (!productId || typeof productId !== 'string') {
    throw new HttpsError('invalid-argument', 'productId is required.');
  }
  if (tierIndex !== undefined && tierIndex !== null && (!Number.isInteger(tierIndex) || tierIndex < 0)) {
    throw new HttpsError('invalid-argument', 'tierIndex must be a tier position.');
  }

  const snap = await db.collection('Products').doc(productId).get();
  if (!snap.exists) {
    throw new HttpsError('not-found', 'Product not found.');
  }
  const product = { id: snap.id, ...(snap.data() as ProductDoc) };
  const dodoProductId = providerProductId(product);
  if (!dodoProductId) {
    throw new HttpsError('failed-precondition', 'Product is not linked to a Dodo product.');
  }

  const tier = typeof tierIndex === 'number' ? product.tiers?.[tierIndex] ?? null : null;
  if (typeof tierIndex === 'number' && !tier) {
    throw new HttpsError('invalid-argument', 'This product has no such tier.');
  }
  // An admin page from before the codes moved sends the code itself; the caller is an admin.
  const legacyCode = typeof request.data?.discountCode === 'string' ? request.data.discountCode.trim() : '';
  const discountCode = tier ? tierDiscountCode(product.tiers, tier, await loadProductCodes(product.id)) : legacyCode;

  const email = userRecord.email || request.auth.token?.email as string | undefined;

  let testToken = '';
  try {
    const { client, settings } = await getDodoClient();
    testToken = await createTestCheckoutToken(product.id, request.auth.uid);

    const checkoutParams: Record<string, unknown> = {
      product_cart: [{ product_id: dodoProductId, quantity: 1 }],
      return_url: settings.successUrl,
      metadata: {
        test: testToken,
        userId: request.auth.uid,
        productId: product.id,
        premiumType: product.premiumType,
        tierLabel: discountCode ? `code:${discountCode}` : 'full-price',
      },
    };
    if (email) checkoutParams['customer'] = { email };
    if (settings.cancelUrl) checkoutParams['cancel_url'] = settings.cancelUrl;
    if (discountCode) checkoutParams['discount_codes'] = [discountCode];
    if (product.type === 'subscription' && product.trialDays && product.trialDays > 0) {
      checkoutParams['subscription_data'] = { trial_period_days: product.trialDays };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await client.checkoutSessions.create(checkoutParams as any);
    return { checkoutUrl: session.checkout_url };
  } catch (error) {
    // No checkout was made, so its token must not wait around to be used.
    if (testToken) await deleteTestCheckoutToken(testToken).catch((err) => logger.warn('Could not delete an unused test checkout token', err));
    logger.error('createTestCheckoutLink failed', error);
    throw new HttpsError('internal', 'Failed to create test checkout link.');
  }
});
