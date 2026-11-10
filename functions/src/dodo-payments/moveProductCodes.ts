import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import { ProductDoc } from './types.js';
import { PRODUCT_CODES_COLLECTION, hasCodesOnProduct, mergeProductCodes, tiersWithoutCodes } from './productCodes.js';

/**
 * Callable (admin only): move the tier discount codes older versions kept on the
 * public Products documents into the admin-only ProductCodes documents, and take
 * them off the products (productCodes.ts).
 *
 * The admin calls it quietly once a session (src/app/pages/admin/(products)/
 * product-codes-upkeep.ts), and the Products page calls it when it opens, so any
 * admin visit after an update closes the codes. Each product moves in its own
 * transaction: a product edited meanwhile is read again, never overwritten, and
 * there is no limit on how many products move.
 *
 * Returns `{ moved }`, the number of products it changed.
 */
export const moveProductCodes = onCall(async (request) => {
  await requireAdmin(request);
  return { moved: await moveAllProductCodes() };
});

/** Move every product's leftover codes; the number of products changed. */
export async function moveAllProductCodes(): Promise<number> {
  const products = await db.collection('Products').get();
  let moved = 0;
  for (const doc of products.docs) {
    if (!hasCodesOnProduct((doc.data() as ProductDoc).tiers)) continue;
    try {
      if (await moveProductCodesOf(doc.id)) moved++;
    } catch (error) {
      logger.error(`Moving the tier codes of Products/${doc.id} failed`, error);
    }
  }
  return moved;
}

/** Move one product's codes in a transaction. False when it had none left. */
export async function moveProductCodesOf(productId: string): Promise<boolean> {
  const productRef = db.collection('Products').doc(productId);
  const codesRef = db.collection(PRODUCT_CODES_COLLECTION).doc(productId);
  return db.runTransaction(async (tx) => {
    const [productSnap, codesSnap] = [await tx.get(productRef), await tx.get(codesRef)];
    const tiers = productSnap.exists ? (productSnap.data() as ProductDoc).tiers : undefined;
    if (!hasCodesOnProduct(tiers)) return false;
    const storedRaw = codesSnap.exists ? codesSnap.data()?.['discountCodes'] : undefined;
    const stored = Array.isArray(storedRaw) ? storedRaw.map((code) => (typeof code === 'string' ? code : '')) : [];
    tx.set(codesRef, { discountCodes: mergeProductCodes(tiers, stored), updatedAt: new Date() }, { merge: true });
    tx.update(productRef, { tiers: tiersWithoutCodes(tiers) });
    return true;
  });
}
