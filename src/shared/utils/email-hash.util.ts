/**
 * Email Hash Utility
 *
 * Provides deterministic SHA-256 hashing for email addresses.
 * Used by the `email_lookup` Firestore collection to check email
 * existence without exposing PII.
 *
 * The hash is one-way: the email cannot be recovered from the hash.
 * Uses the Web Crypto API (native in browsers and Node.js 18+).
 */

/**
 * Normalize and SHA-256 hash an email address.
 *
 * @param email - Raw email input from user
 * @returns Hex-encoded SHA-256 hash of the normalized (trimmed, lowercased) email
 *
 * @example
 * await hashEmail('  User@Example.COM  ');
 * // => '7a1d3e8f...' (64-char hex string)
 */
export async function hashEmail(email: string): Promise<string> {
    const normalized = email.trim().toLowerCase();
    const encoder = new TextEncoder();
    const data = encoder.encode(normalized);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}
