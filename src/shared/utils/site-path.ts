/**
 * Whether a value someone else supplied (a page path a member sent with feedback or a
 * message) is a path on this site, safe to show as a link.
 *
 * Only a value that starts with exactly one `/`: `//host` and `/\host` open another
 * site, and a browser drops tabs and line breaks from an address before it reads it,
 * so `/<tab>/host` would too. Anything else is shown as plain text.
 */
export function isSitePath(value: unknown): value is string {
    if (typeof value !== 'string' || !value.startsWith('/')) return false;
    if (value[1] === '/' || value[1] === '\\') return false;
    // eslint-disable-next-line no-control-regex
    return !/[\u0000-\u001f\u007f]/.test(value);
}
