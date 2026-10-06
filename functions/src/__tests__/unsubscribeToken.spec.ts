/**
 * Tests for the HMAC unsubscribe-token helpers
 * (functions/src/email-core/unsubscribeToken.ts).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const constantMock = vi.hoisted(() => ({
  isProduction: false, live_url: 'https://app.example.com/', local_url: 'http://localhost:5173/',
}));
vi.mock('../constant', () => ({ constant: constantMock }));

import {
  computeEmailHash,
  buildUnsubscribeToken,
  verifyUnsubscribeToken,
  buildUnsubscribeUrl,
  buildPreferencesUrl,
  getPublicBaseUrl,
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

  describe('getPublicBaseUrl', () => {
    const saved = { ...constantMock };
    const env = { site: process.env['ARC_HOSTING_SITE'], project: process.env['GCLOUD_PROJECT'] };
    const restore = (key: string, value: string | undefined) => {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    };
    afterEach(() => {
      Object.assign(constantMock, saved);
      restore('ARC_HOSTING_SITE', env.site);
      restore('GCLOUD_PROJECT', env.project);
    });

    it('prefers the liveUrl override and adds one trailing slash', () => {
      constantMock.isProduction = true;
      expect(getPublicBaseUrl('https://site.example.com')).toBe('https://site.example.com/');
      expect(getPublicBaseUrl('https://site.example.com/')).toBe('https://site.example.com/');
    });

    it('uses constant.live_url in production when no override is set', () => {
      constantMock.isProduction = true;
      expect(getPublicBaseUrl()).toBe('https://app.example.com/');
    });

    it('falls back to the hosting site when neither is set, so a fresh install has working links', () => {
      constantMock.isProduction = true;
      constantMock.live_url = '';
      process.env['GCLOUD_PROJECT'] = 'acme-project';
      delete process.env['ARC_HOSTING_SITE'];
      expect(getPublicBaseUrl()).toBe('https://acme-project.web.app/');
      process.env['ARC_HOSTING_SITE'] = 'acme-arccms';
      expect(getPublicBaseUrl()).toBe('https://acme-arccms.web.app/');
      expect(buildUnsubscribeUrl('user@example.com', 's')).toMatch(/^https:\/\/acme-arccms\.web\.app\/unsubscribe\?e=/);
      expect(buildPreferencesUrl('user@example.com', 's')).toMatch(/^https:\/\/acme-arccms\.web\.app\/email-preferences\?e=/);
    });

    it('stays relative when hosting is off and nothing is set', () => {
      constantMock.isProduction = true;
      constantMock.live_url = '';
      process.env['ARC_HOSTING_SITE'] = 'none';
      expect(getPublicBaseUrl()).toBe('/');
    });

    it('uses the local URL outside production', () => {
      constantMock.isProduction = false;
      expect(getPublicBaseUrl()).toBe('http://localhost:5173/');
    });
  });
});
