import { IBaseModel } from '../../../../shared/models/base-model';

export const PRODUCTS_COLLECTION = 'Products';

/** A headcount-based pricing tier (first N buyers get a discount, etc.). */
export interface IPricingTier {
    label: string;
    /** Cumulative confirmed-purchase threshold. 0 or empty = "everyone else" (unbounded). */
    maxCount: number;
    /** Dodo discount code applied for this tier ('' = full price). */
    discountCode: string;
    /** Display-only percentage. */
    discountPct: number;
}

export interface IProduct extends IBaseModel {
    name: string;
    description?: string;
    features?: string[];
    active: boolean;
    /** Product id from the Dodo dashboard. */
    dodoProductId: string;
    type: 'one_time' | 'subscription';
    /** Entitlement granted on purchase, e.g. 'plus' | 'gold' | 'platinum'. */
    premiumType: string;
    /** Higher rank wins when a user already holds an entitlement. */
    tierRank: number;
    interval?: 'month' | 'year';
    trialDays?: number;
    tiers: IPricingTier[];
    /** Confirmed-purchase counter (incremented by Cloud Functions). */
    purchaseCount: number;
}
