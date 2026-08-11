import { IProduct, IPricingTier } from '../admin/(products)/product.model';

/**
 * Client-side mirror of the backend `resolveTier` (functions/src/dodo-payments/
 * tiers.ts) — for DISPLAY ONLY. Picks the tier a new buyer would land in given the
 * product's confirmed `purchaseCount`, so the pricing page can show the current
 * price. The authoritative tier/discount is still resolved server-side at checkout.
 */
export function resolveDisplayTier(product: Pick<IProduct, 'tiers' | 'purchaseCount'>): IPricingTier | null {
    const tiers = product.tiers ?? [];
    if (tiers.length === 0) return null;

    const count = Number.isFinite(product.purchaseCount) && product.purchaseCount > 0 ? Math.floor(product.purchaseCount) : 0;
    const sorted = [...tiers].sort((a, b) => normalizeMax(a.maxCount) - normalizeMax(b.maxCount));

    for (const tier of sorted) {
        if (count < normalizeMax(tier.maxCount)) return tier;
    }
    return null;
}

/** Treat non-positive / non-finite maxCount as unbounded ("everyone else"). */
function normalizeMax(maxCount: number): number {
    if (!Number.isFinite(maxCount) || maxCount <= 0) return Number.MAX_SAFE_INTEGER;
    return maxCount;
}

/**
 * The price to show for a product: the active display tier's price if set,
 * otherwise the product's list price. Returns null when nothing is priced.
 */
export function displayPrice(product: Pick<IProduct, 'tiers' | 'purchaseCount' | 'price'>): number | null {
    const tier = resolveDisplayTier(product);
    if (tier) {
        if (typeof tier.price === 'number') return tier.price;
        if (typeof tier.discountPct === 'number' && typeof product.price === 'number') {
            return product.price * (1 - tier.discountPct / 100);
        }
    }
    return typeof product.price === 'number' ? product.price : null;
}

/** True when the active tier's price is a genuine discount off the product list price. */
export function isDiscounted(product: Pick<IProduct, 'tiers' | 'purchaseCount' | 'price'>): boolean {
    const shown = displayPrice(product);
    return (
        typeof product.price === 'number' &&
        typeof shown === 'number' &&
        shown < product.price
    );
}

/** Format a major-units amount with an ISO currency, falling back to a plain number. */
export function formatMoney(amount: number | null | undefined, currency?: string): string {
    if (typeof amount !== 'number') return '';
    try {
        return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency || 'USD' }).format(amount);
    } catch {
        return `${amount} ${currency ?? ''}`.trim();
    }
}
