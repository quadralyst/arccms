import { PricingTier } from './types.js';

/**
 * Resolve which pricing tier applies to the next buyer of a product.
 *
 * Tiers are sorted by ascending `maxCount` (cumulative confirmed-purchase
 * threshold). The active tier is the first whose `maxCount` is strictly greater
 * than `confirmedCount` (the number of purchases already made — i.e. the next
 * buyer sits at 0-based index `confirmedCount`). A tier with `maxCount <= 0` is
 * treated as unbounded ("everyone else") and matches any remaining buyer.
 *
 * Pure function — no I/O — so it is unit-testable in isolation.
 *
 * @returns the matching tier, or null if no tier matches (caller charges full price).
 */
export function resolveTier(tiers: PricingTier[] | undefined, confirmedCount: number): PricingTier | null {
  if (!tiers || tiers.length === 0) return null;

  const count = Number.isFinite(confirmedCount) && confirmedCount > 0 ? Math.floor(confirmedCount) : 0;

  const sorted = [...tiers].sort((a, b) => normalizeMax(a.maxCount) - normalizeMax(b.maxCount));

  for (const tier of sorted) {
    if (count < normalizeMax(tier.maxCount)) {
      return tier;
    }
  }

  return null;
}

/** Treat non-positive / non-finite maxCount as unbounded. */
function normalizeMax(maxCount: number): number {
  if (!Number.isFinite(maxCount) || maxCount <= 0) return Number.MAX_SAFE_INTEGER;
  return maxCount;
}
