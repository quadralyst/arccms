import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db, owner } from '../init.js';
import { getDodoClient } from './dodoClient.js';
import { resolveTier } from './tiers.js';
import { ProductDoc } from './types.js';

/**
 * Callable: create a Dodo hosted-checkout session for the authenticated user.
 *
 * Flow: resolve the active pricing tier from the product's confirmed-purchase
 * count, apply that tier's discount code, attach the buyer's identity in
 * metadata, and return the Dodo checkout URL for the client to redirect to.
 *
 * Note: we read `purchaseCount` for tier selection but do NOT reserve a slot
 * here — the count is only incremented on a confirmed payment. The authoritative
 * redemption cap for a tier is the Dodo discount code's own usage limit.
 */
export const createCheckoutSession = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Authentication required.');
  }

  const uid = request.auth.uid;
  const productId = request.data?.productId;
  if (!productId || typeof productId !== 'string') {
    throw new HttpsError('invalid-argument', 'productId is required.');
  }

  // Load product and a consistent purchaseCount snapshot in a transaction.
  const productRef = db.collection('Products').doc(productId);
  const product = await db.runTransaction(async (tx) => {
    const snap = await tx.get(productRef);
    if (!snap.exists) {
      throw new HttpsError('not-found', 'Product not found.');
    }
    return { id: snap.id, ...(snap.data() as ProductDoc) };
  });

  if (!product.active) {
    throw new HttpsError('failed-precondition', 'Product is not available for purchase.');
  }
  if (!product.dodoProductId) {
    throw new HttpsError('failed-precondition', 'Product is not linked to a Dodo product.');
  }

  const tier = resolveTier(product.tiers, product.purchaseCount ?? 0);

  // Resolve the buyer's email from Firebase Auth.
  let email: string | undefined = request.auth.token?.email as string | undefined;
  let name: string | undefined = request.auth.token?.name as string | undefined;
  if (!email) {
    try {
      const userRecord = await owner.getUser(uid);
      email = userRecord.email;
      name = userRecord.displayName ?? name;
    } catch (e) {
      logger.error('Failed to resolve user email for checkout', e);
    }
  }
  if (!email) {
    throw new HttpsError('failed-precondition', 'Your account has no email address.');
  }

  try {
    const { client, settings } = await getDodoClient();

    const checkoutParams: Record<string, unknown> = {
      product_cart: [{ product_id: product.dodoProductId, quantity: 1 }],
      customer: { email, ...(name ? { name } : {}) },
      return_url: settings.successUrl,
      metadata: {
        userId: uid,
        productId: product.id,
        premiumType: product.premiumType,
        tierRank: String(product.tierRank ?? 0),
        tierLabel: tier?.label ?? '',
        // Snapshot the applied discount code so the webhook can record the locked-in deal.
        discountCode: tier?.discountCode ?? '',
      },
    };

    if (settings.cancelUrl) {
      checkoutParams['cancel_url'] = settings.cancelUrl;
    }
    if (tier?.discountCode) {
      checkoutParams['discount_codes'] = [tier.discountCode];
    }
    if (product.type === 'subscription' && product.trialDays && product.trialDays > 0) {
      checkoutParams['subscription_data'] = { trial_period_days: product.trialDays };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const session = await client.checkoutSessions.create(checkoutParams as any);

    return {
      checkoutUrl: session.checkout_url,
      sessionId: (session as { session_id?: string }).session_id,
      tierApplied: tier?.label ?? null,
    };
  } catch (error) {
    logger.error('createCheckoutSession failed', error);
    throw new HttpsError('internal', 'Failed to create checkout session.');
  }
});
