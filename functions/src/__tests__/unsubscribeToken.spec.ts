/**
 * Tests for the HMAC unsubscribe-token helpers
 * (functions/src/email-core/unsubscribeToken.ts).
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../constant', () => ({
  constant: { isProduction: false, live_url: 'https://app.example.com/', local_url: 'http://localhost:5173/' },
}));

import {
  computeEmailHash,
  buildUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
} from '../email-core/unsubscribeToken.js';

describe('unsubscribeToken', () => {
  describe('computeEmailHash', () => {
    it('is sha256 of the normalised email (lowercase + trim)', () => {
      const a = computeEmailHash('User@Example.com');
      const b = computeEmailHash('  user@example.com ');
      expect(a).toBe(b);
      expect(a).toMatch(/^[a-f0-9]{64}$/);
    });

    it('differs for different addresses', () => {
      expect(computeEmailHash('a@x.com')).not.toBe(computeEmailHash('b@x.com'));
    });
  });

  describe('buildUnsubscribeToken / verifyUnsubscribeToken', () => {
    const hash = computeEmailHash('user@example.com');
    const secret = 'super-secret';

    it('a freshly minted token validates', () => {
      const token = buildUnsubscribeToken(hash, secret);
      expect(verifyUnsubscribeToken(hash, token, secret)).toBe(true);
    });

    it('rejects a tampered token', () => {
      const token = buildUnsubscribeToken(hash, secret);
      expect(verifyUnsubscribeToken(hash, token + 'ff', secret)).toBe(false);
      expect(verifyUnsubscribeToken(hash, token.slice(0, -2) + '00', secret)).toBe(false);
    });

    it('rejects a token minted with a different secret', () => {
      const token = buildUnsubscribeToken(hash, 'other-secret');
      expect(verifyUnsubscribeToken(hash, token, secret)).toBe(false);
    });

    it('rejects a token bound to a different emailHash', () => {
      const token = buildUnsubscribeToken(computeEmailHash('someone@else.com'), secret);
      expect(verifyUnsubscribeToken(hash, token, secret)).toBe(false);
    });

    it('rejects when any argument is empty', () => {
      const token = buildUnsubscribeToken(hash, secret);
      expect(verifyUnsubscribeToken('', token, secret)).toBe(false);
      expect(verifyUnsubscribeToken(hash, '', secret)).toBe(false);
      expect(verifyUnsubscribeToken(hash, token, '')).toBe(false);
    });
  });

  describe('buildUnsubscribeUrl', () => {
    it('builds an e/t URL that round-trips through verify (fixes empty-userId bug)', () => {
      const url = buildUnsubscribeUrl('user@example.com', 'super-secret');
      expect(url).toContain('unsubscribe?e=');
      expect(url).toContain('&t=');
      // The link must NOT contain the old empty-userId form.
      expect(url).not.toContain('userId=');

      const u = new URL(url);
      const e = u.searchParams.get('e')!;
      const t = u.searchParams.get('t')!;
      expect(e).toBe(computeEmailHash('user@example.com'));
      expect(verifyUnsubscribeToken(e, t, 'super-secret')).toBe(true);
    });

    it('returns empty string when no secret is configured', () => {
      expect(buildUnsubscribeUrl('user@example.com', undefined)).toBe('');
      expect(buildUnsubscribeUrl('user@example.com', '')).toBe('');
    });
  });
});
