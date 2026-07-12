import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { constant } from '../constant.js';

/**
 * Stable recipient key: sha256(lowercase(trim(email))).
 * Same scheme as the existing `email_lookup` collection, so it can be used as a
 * document id across Contacts / Suppression / signup_otps.
 */
export function computeEmailHash(email: string): string {
  return createHash('sha256')
    .update((email || '').trim().toLowerCase())
    .digest('hex');
}

/**
 * HMAC token binding an emailHash to the site's `unsubscribeSecret`.
 * Only someone holding the secret (the server) can mint a valid token, so an
 * unsubscribe link cannot be forged for an arbitrary address.
 */
export function buildUnsubscribeToken(emailHash: string, secret: string): string {
  return createHmac('sha256', secret || '').update(emailHash).digest('hex');
}

/** Constant-time token validation. Returns false when secret/token are absent. */
export function verifyUnsubscribeToken(
  emailHash: string,
  token: string,
  secret: string,
): boolean {
  if (!emailHash || !token || !secret) return false;
  const expected = buildUnsubscribeToken(emailHash, secret);
  const a = Buffer.from(expected, 'utf8');
  const b = Buffer.from(token, 'utf8');
  if (a.length !== b.length) return false;
  try {
    return timingSafeEqual(a, b);
  } catch {
    return false;
  }
}

/**
 * Base URL for public email links (unsubscribe / preferences).
 * Prefers an explicit override (e.g. `Settings/email.liveUrl`) so per-product
 * deploys don't edit source; falls back to the constant.
 */
export function getPublicBaseUrl(override?: string): string {
  const base = override || (constant.isProduction ? constant.live_url : constant.local_url);
  // Guarantee a single trailing slash.
  if (!base) return '/';
  return base.endsWith('/') ? base : `${base}/`;
}

/**
 * Build the one-click unsubscribe URL for a recipient.
 * Fixes the historical empty-userId bug (emailTemplateHelper.ts:189): the link
 * now carries the recipient's emailHash + an HMAC token instead of a blank id.
 * Returns an empty string when no secret is configured (link can't be verified).
 */
export function buildUnsubscribeUrl(email: string, secret: string | undefined, baseUrl?: string): string {
  if (!email || !secret) return '';
  const emailHash = computeEmailHash(email);
  const token = buildUnsubscribeToken(emailHash, secret);
  return `${getPublicBaseUrl(baseUrl)}unsubscribe?e=${emailHash}&t=${token}`;
}

/**
 * Build the preference-center URL for a recipient (##PREFERENCES_LINK##).
 * Same HMAC token scheme as unsubscribe, so it works for non-user contacts too.
 */
export function buildPreferencesUrl(email: string, secret: string | undefined, baseUrl?: string): string {
  if (!email || !secret) return '';
  const emailHash = computeEmailHash(email);
  const token = buildUnsubscribeToken(emailHash, secret);
  return `${getPublicBaseUrl(baseUrl)}email-preferences?e=${emailHash}&t=${token}`;
}
