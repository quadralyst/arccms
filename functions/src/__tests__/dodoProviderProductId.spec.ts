/**
 * Tests for providerProductId() in functions/src/dodo-payments/types.ts —
 * resolving a product's gateway id, including the backward-compat fallback to the
 * legacy flat `dodoProductId` field on pre-migration product docs.
 */
import { describe, it, expect } from 'vitest';
import { providerProductId } from '../dodo-payments/types.js';

describe('providerProductId', () => {
  it('reads the providerProductIds map', () => {
    expect(providerProductId({ providerProductIds: { dodo: 'prod_new' } } as any)).toBe('prod_new');
  });

  it('falls back to the legacy dodoProductId field', () => {
    expect(providerProductId({ dodoProductId: 'prod_legacy' } as any)).toBe('prod_legacy');
  });

  it('prefers the map over the legacy field', () => {
    expect(providerProductId({ providerProductIds: { dodo: 'prod_new' }, dodoProductId: 'prod_legacy' } as any)).toBe('prod_new');
  });

  it('returns undefined when neither is set', () => {
    expect(providerProductId({} as any)).toBeUndefined();
  });
});
