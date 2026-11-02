/**
 * What an attempt cost (specs/ai-spec.md, AI-D13; specs/ai-media-spec.md, AM-D5, AM-D6,
 * AM-D31). The provider's own figure when it gives one. Else the model's price list, by its
 * unit: tokens (input, output, cached input and cache writes priced apart, and a higher
 * price above a prompt size), or pictures, characters (per 1,000) or seconds. A price in
 * another currency needs the admin's USD rate; without one, or without a price, it counts 0
 * and says so, so Settings, AI can warn.
 */
import type { AttemptUsage } from './connectors/types.js';
import type { AiModelInfo } from './settings.js';
import type { AiUnit } from './types.js';

export type CostFrom = 'provider' | 'price-list' | 'none';

export interface AttemptCost {
    usd: number;
    from: CostFrom;
    /** What was billed, in `unit`: tokens in and out together, pictures, characters or seconds. */
    amount: number;
    unit: AiUnit;
}

/** The tokens' cost in the model's currency, or null when it has no token price. */
export function tokenCost(info: Pick<AiModelInfo, 'priceIn' | 'priceOut' | 'priceCachedIn' | 'priceCacheWrite' | 'priceAbove'>, usage: AttemptUsage): number | null {
    const above = info.priceAbove && usage.tokensIn > info.priceAbove.tokens ? info.priceAbove : null;
    const priceIn = above?.priceIn ?? info.priceIn;
    const priceOut = above?.priceOut ?? info.priceOut;
    if (priceIn === undefined || priceOut === undefined) return null;
    // A missing cached or write price is the input price: it overstates, never understates.
    const priceCached = (above ? above.priceCachedIn : info.priceCachedIn) ?? priceIn;
    const priceWrite = (above ? above.priceCacheWrite : info.priceCacheWrite) ?? priceIn;
    const cached = Math.min(usage.tokensCached ?? 0, usage.tokensIn);
    const written = Math.min(usage.tokensCacheWrite ?? 0, usage.tokensIn - cached);
    const plain = usage.tokensIn - cached - written;
    return (plain * priceIn + cached * priceCached + written * priceWrite + usage.tokensOut * priceOut) / 1_000_000;
}

/**
 * The cost of one attempt. `amount` is what a model billed by pictures, characters or
 * seconds made or took, as Arc counted it; the provider's own count, when it gives one, wins.
 */
export function attemptCost(info: AiModelInfo, usage: AttemptUsage, amount = 0): AttemptCost {
    const unit = info.unit;
    const billed = unit === 'tokens' ? usage.tokensIn + usage.tokensOut : usage.amount ?? amount;
    if (typeof usage.costUsd === 'number' && Number.isFinite(usage.costUsd)) return { usd: usage.costUsd, from: 'provider', amount: billed, unit };
    let inCurrency: number | null;
    if (unit === 'tokens') inCurrency = tokenCost(info, usage);
    else if (info.price === undefined) inCurrency = null;
    else inCurrency = unit === 'characters' ? (billed / 1000) * info.price : billed * info.price;
    if (inCurrency === null || info.usdRate === null) return { usd: 0, from: 'none', amount: billed, unit };
    return { usd: inCurrency * info.usdRate, from: 'price-list', amount: billed, unit };
}
