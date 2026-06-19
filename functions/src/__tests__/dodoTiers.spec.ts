/**
 * Tests for functions/src/dodo-payments/tiers.ts — pure tier resolution.
 */
import { describe, it, expect } from 'vitest';
import { resolveTier } from '../dodo-payments/tiers.js';
import { PricingTier } from '../dodo-payments/types.js';

const tiers: PricingTier[] = [
  { label: 'First 100', maxCount: 100, discountCode: 'EARLY100', discountPct: 50 },
  { label: 'Next 200', maxCount: 300, discountCode: 'EARLY300', discountPct: 25 },
  { label: 'Everyone else', maxCount: 0, discountCode: '', discountPct: 0 }, // unbounded
];

describe('resolveTier', () => {
  it('returns the first tier for early buyers', () => {
    expect(resolveTier(tiers, 0)?.label).toBe('First 100');
    expect(resolveTier(tiers, 99)?.label).toBe('First 100');
  });

  it('advances to the second tier at the boundary', () => {
    expect(resolveTier(tiers, 100)?.label).toBe('Next 200');
    expect(resolveTier(tiers, 299)?.label).toBe('Next 200');
  });

  it('falls through to the unbounded "everyone else" tier', () => {
    expect(resolveTier(tiers, 300)?.label).toBe('Everyone else');
    expect(resolveTier(tiers, 999999)?.label).toBe('Everyone else');
  });

  it('sorts tiers by maxCount regardless of input order', () => {
    const shuffled = [tiers[2], tiers[1], tiers[0]];
    expect(resolveTier(shuffled, 50)?.label).toBe('First 100');
    expect(resolveTier(shuffled, 150)?.label).toBe('Next 200');
  });

  it('returns null when no tier matches (no unbounded tier)', () => {
    const bounded: PricingTier[] = [{ label: 'First 10', maxCount: 10, discountCode: 'X', discountPct: 10 }];
    expect(resolveTier(bounded, 10)).toBeNull();
    expect(resolveTier(bounded, 5)?.label).toBe('First 10');
  });

  it('handles empty/undefined tiers and negative counts', () => {
    expect(resolveTier(undefined, 5)).toBeNull();
    expect(resolveTier([], 5)).toBeNull();
    expect(resolveTier(tiers, -3)?.label).toBe('First 100');
  });
});
