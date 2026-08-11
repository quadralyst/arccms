import { describe, it, expect } from 'vitest';
import { resolveDisplayTier, displayPrice, isDiscounted, formatMoney } from './pricing-utils';

const tiers = [
    { label: 'First 100', maxCount: 100, discountCode: 'EARLY', discountPct: 48, price: 15 },
    { label: 'Next 100', maxCount: 200, discountCode: 'SECOND', discountPct: 34, price: 19 },
    { label: 'Everyone else', maxCount: 0, discountCode: '', discountPct: 0, price: 29 },
];

function product(purchaseCount: number, price?: number) {
    return { tiers, purchaseCount, price } as any;
}

describe('resolveDisplayTier', () => {
    it('returns the first tier before it fills', () => {
        expect(resolveDisplayTier(product(0))?.label).toBe('First 100');
        expect(resolveDisplayTier(product(99))?.label).toBe('First 100');
    });

    it('advances to the next tier once the previous is full', () => {
        expect(resolveDisplayTier(product(100))?.label).toBe('Next 100');
        expect(resolveDisplayTier(product(150))?.label).toBe('Next 100');
    });

    it('falls to the unbounded tier (maxCount 0) for everyone else', () => {
        expect(resolveDisplayTier(product(200))?.label).toBe('Everyone else');
        expect(resolveDisplayTier(product(99999))?.label).toBe('Everyone else');
    });

    it('returns null with no tiers', () => {
        expect(resolveDisplayTier({ tiers: [], purchaseCount: 0 } as any)).toBeNull();
    });
});

describe('displayPrice', () => {
    it('uses the active tier price when present', () => {
        expect(displayPrice(product(0, 29))).toBe(15);
        expect(displayPrice(product(150, 29))).toBe(19);
    });

    it('falls back to the product list price when no tier price', () => {
        const noTierPrice = { tiers: [{ label: 'x', maxCount: 0, discountCode: '', discountPct: 0 }], purchaseCount: 0, price: 49 };
        expect(displayPrice(noTierPrice as any)).toBe(49);
    });

    it('returns null when nothing is priced', () => {
        expect(displayPrice({ tiers: [], purchaseCount: 0 } as any)).toBeNull();
    });
});

describe('isDiscounted', () => {
    it('is true when the active tier undercuts the list price', () => {
        expect(isDiscounted(product(0, 29))).toBe(true);
    });
    it('is false at the full-price tier', () => {
        expect(isDiscounted(product(200, 29))).toBe(false);
    });
});

describe('formatMoney', () => {
    it('formats with currency', () => {
        expect(formatMoney(15, 'USD')).toBe('$15.00');
    });
    it('returns empty string for non-numbers', () => {
        expect(formatMoney(null)).toBe('');
        expect(formatMoney(undefined)).toBe('');
    });
});
