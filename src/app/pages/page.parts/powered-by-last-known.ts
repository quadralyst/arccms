/**
 * What this browser last learned about Settings, Miscellaneous, "Built with Arc CMS",
 * kept in localStorage so the footer is right from the first frame of a visit after
 * the first one (PoweredByFooterComponent). A visitor's very first load has none, so
 * the footer waits for the setting to be read instead of showing and then going away.
 *
 * Only a convenience: storage can be missing, full or blocked (a private window), and
 * then the footer simply waits for the read each time.
 */
const KEY = 'arc-powered-by';

/** `true` or `false` as last read, `null` when this browser has never read it. */
export function lastKnownPoweredBy(): boolean | null {
    try {
        const value = localStorage.getItem(KEY);
        return value === '1' ? true : value === '0' ? false : null;
    } catch {
        return null;
    }
}

export function rememberPoweredBy(show: boolean): void {
    try {
        localStorage.setItem(KEY, show ? '1' : '0');
    } catch {
        // Not kept; the next visit waits for the read.
    }
}
