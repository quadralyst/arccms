/**
 * Currency-aware conversion from a gateway's smallest currency unit to major
 * units. Most currencies have 2 decimal places (cents → 4999 = 49.99), but some
 * have none (JPY, KRW — the smallest unit IS the major unit) and a few have three
 * (KWD, BHD). Getting this wrong silently mis-states amounts, so it lives in one
 * place that any future gateway normalizer can reuse.
 */

/** ISO-4217 currencies with no minor unit (amount is already in major units). */
const ZERO_DECIMAL = new Set([
  'BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'UGX', 'VND', 'VUV', 'XAF', 'XOF', 'XPF',
]);

/** ISO-4217 currencies with three minor-unit digits. */
const THREE_DECIMAL = new Set(['BHD', 'IQD', 'JOD', 'KWD', 'LYD', 'OMR', 'TND']);

/** Number of minor units per major unit for a currency (defaults to 100). */
export function minorUnitScale(currency?: string): number {
  const c = (currency || '').toUpperCase();
  if (ZERO_DECIMAL.has(c)) return 1;
  if (THREE_DECIMAL.has(c)) return 1000;
  return 100;
}

/** Convert an amount in the smallest currency unit to major units. */
export function toMajorUnits(amountMinor?: number, currency?: string): number {
  if (typeof amountMinor !== 'number' || !Number.isFinite(amountMinor)) return 0;
  return Math.round(amountMinor) / minorUnitScale(currency);
}
