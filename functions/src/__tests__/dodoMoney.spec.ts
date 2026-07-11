/**
 * Tests for functions/src/dodo-payments/money.ts — currency-aware minor→major
 * unit conversion (the bug being: assuming every currency has 2 decimals).
 */
import { describe, it, expect } from 'vitest';
import { toMajorUnits, minorUnitScale } from '../dodo-payments/money.js';

describe('minorUnitScale', () => {
  it('defaults to 100 (2-decimal currencies)', () => {
    expect(minorUnitScale('USD')).toBe(100);
    expect(minorUnitScale('EUR')).toBe(100);
    expect(minorUnitScale(undefined)).toBe(100);
  });
  it('is 1 for zero-decimal currencies', () => {
    expect(minorUnitScale('JPY')).toBe(1);
    expect(minorUnitScale('krw')).toBe(1); // case-insensitive
  });
  it('is 1000 for three-decimal currencies', () => {
    expect(minorUnitScale('KWD')).toBe(1000);
    expect(minorUnitScale('BHD')).toBe(1000);
  });
});

describe('toMajorUnits', () => {
  it('divides cents by 100 for USD', () => {
    expect(toMajorUnits(4999, 'USD')).toBe(49.99);
  });
  it('does NOT divide for JPY (¥5000 stays 5000)', () => {
    expect(toMajorUnits(5000, 'JPY')).toBe(5000);
  });
  it('divides by 1000 for KWD', () => {
    expect(toMajorUnits(1500, 'KWD')).toBe(1.5);
  });
  it('returns 0 for non-numbers', () => {
    expect(toMajorUnits(undefined, 'USD')).toBe(0);
    expect(toMajorUnits(NaN, 'USD')).toBe(0);
  });
});
