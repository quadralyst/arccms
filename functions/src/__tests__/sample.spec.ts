/**
 * Sample test to verify Vitest setup works for cloud functions.
 */
import { describe, it, expect } from 'vitest';

describe('Cloud Functions Test Setup', () => {
  it('should run a basic test', () => {
    expect(1 + 1).toBe(2);
  });

  it('should have access to Vitest globals', () => {
    expect(typeof describe).toBe('function');
    expect(typeof it).toBe('function');
    expect(typeof expect).toBe('function');
  });
});
