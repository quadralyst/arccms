import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db, owner } from '../init.js';
import { getDodoClient } from './dodoClient.js';
import { ProductDoc, providerProductId } from './types.js';

/**
 * Callable (admin only): generate a Dodo checkout URL for a SPECIFIC tier's
 * discount code, so an admin can copy/open it to verify that tier's price.
 *
 * Unlike createCheckoutSession (which auto-resolves the tier from purchaseCount
 * for real buyers), this lets the admin test any tier directly by passing its
 * discount code. The session carries `test: 'true'` metadata.
 */
export const createTestCheckoutLink = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }
  const userRecord = await owner.getUser(request.auth.uid);
  if (userRecord.customClaims?.['role'] !== 'admin') {
    throw new HttpsError('permission-denied', 'Admin access required.');
  }

  const productId = request.data?.productId;
  const discountCode: string | undefined = request.data?.discountCode || undefined;
  if (!productId || typeof productId !== 'string') {
    throw new HttpsError('invalid-argument', 'productId is required.');
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

  const email = userRecord.email || request.auth.token?.email as string | undefined;

  try {
    const { client, settings } = await getDodoClient();

    const checkoutParams: Record<string, unknown> = {
      product_cart: [{ product_id: dodoProductId, quantity: 1 }],
      return_url: settings.successUrl,
      metadata: {
        test: 'true',
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
    logger.error('createTestCheckoutLink failed', error);
    throw new HttpsError('internal', 'Failed to create test checkout link.');
  }
});
