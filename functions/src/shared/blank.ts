/**
 * Whether a value is missing, empty or only spaces (specs/app-accounts-spec.md, C-D13).
 *
 * Accounts without an email or a phone (phone sign-up, app accounts) store `''`, so a
 * query `where('email', '==', x)` with an empty x would match all of them. Every such
 * lookup checks this first and finds nothing instead; a test fails on one that does not.
 */
export function isBlank(value: unknown): boolean {
    return typeof value !== 'string' || value.trim() === '';
}
