import { db } from '../init.js';
import { PricingTier } from './types.js';

/**
 * Each pricing tier's discount code, kept out of the public Products document.
 *
 * `Products/{id}` is readable by anyone (the pricing page lists it), so a tier's
 * code there let a visitor read the early-bird code and use it after its tier
 * closed. The codes live in `ProductCodes/{productId}` instead, admin only:
 * `discountCodes[i]` belongs to `tiers[i]` of the product. The admin Products
 * page writes both documents together. A code an older version left on a product
 * is moved here on the server (moveProductCodes.ts), when an admin opens the admin.
 */
export const PRODUCT_CODES_COLLECTION = 'ProductCodes';

export interface ProductCodesDoc {
  /** `discountCodes[i]` is the code of the product's `tiers[i]` ('' = full price). */
  discountCodes: string[];
}

/** The product's codes, by tier position. Empty when the product has none stored. */
export async function loadProductCodes(productId: string): Promise<string[]> {
  const snap = await db.collection(PRODUCT_CODES_COLLECTION).doc(productId).get();
  const codes = snap.exists ? (snap.data() as Partial<ProductCodesDoc>)?.discountCodes : undefined;
  return Array.isArray(codes) ? codes.map((code) => (typeof code === 'string' ? code : '')) : [];
}

/**
 * The discount code for one tier: the stored code at the tier's position, else a
 * code an older admin page left on the product itself (until the admin page moves
 * it), else none.
 */
export function tierDiscountCode(tiers: PricingTier[] | undefined, tier: PricingTier | null, codes: string[]): string {
  if (!tier) return '';
  const index = (tiers ?? []).indexOf(tier);
  const stored = index >= 0 ? codes[index] : '';
  return (stored || tier.discountCode || '').trim();
}

/** Whether a product still carries a tier code on its public document. */
export function hasCodesOnProduct(tiers: PricingTier[] | undefined): boolean {
  return (tiers ?? []).some((tier) => tier && typeof tier === 'object' && 'discountCode' in tier);
}

/**
 * The codes to store for a product whose tiers still carry codes: a stored code
 * stays, and a code on the product fills a position that has none. Nothing stored
 * is ever dropped, even past the last tier.
 */
export function mergeProductCodes(tiers: PricingTier[] | undefined, stored: string[]): string[] {
  const list = tiers ?? [];
  const length = Math.max(list.length, stored.length);
  return Array.from({ length }, (_, i) => (stored[i] || list[i]?.discountCode || '').trim());
}

/** The tiers without their codes, as the public product keeps them. */
export function tiersWithoutCodes(tiers: PricingTier[] | undefined): PricingTier[] {
  return (tiers ?? []).map((tier) => {
    const { discountCode: _code, ...rest } = tier;
    return rest as PricingTier;
  });
}
