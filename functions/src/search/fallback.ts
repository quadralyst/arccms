/**
 * The typo fallback (S-D9).
 *
 * Firestore has no fuzzy matching. When a query finds nothing, the token
 * being typed is shortened by one character and the search runs again, at
 * most twice and never below three characters. "gunjam" finds nothing,
 * "gunja" finds Gunjan. Pure, so fallback.spec.ts pins it.
 */

/** The typo fallback shortens the last token this many times at most. */
export const FALLBACK_ATTEMPTS = 2;
export const FALLBACK_MIN_LENGTH = 3;
export const FALLBACK_TRIGGER_LENGTH = 4;

export interface TokenAttempt {
    tokens: string[];
    /** The shortened token, present on fallback attempts only. */
    fallback?: string;
}

/** The token sets to try: the query as typed, then with a token shortened. */
export function fallbackTokenSets(tokens: string[]): TokenAttempt[] {
    const attempts: TokenAttempt[] = [{ tokens }];
    if (tokens.length === 0) return attempts;

    // "Last" in the visitor's order: queryTokens sorts by length, so the
    // token being typed is usually the shortest, not the last, in the array.
    // The shortest token that is long enough to shorten is the target, and
    // only that one is ever shortened.
    let target = -1;
    for (let i = tokens.length - 1; i >= 0; i--) {
        if (tokens[i].length >= FALLBACK_TRIGGER_LENGTH && (target === -1 || tokens[i].length < tokens[target].length)) target = i;
    }
    if (target === -1) return attempts;

    let shortened = tokens[target];
    for (let attempt = 0; attempt < FALLBACK_ATTEMPTS; attempt++) {
        if (shortened.length <= FALLBACK_MIN_LENGTH) break;
        shortened = shortened.slice(0, shortened.length - 1);
        const next = tokens.map((token, i) => (i === target ? shortened : token));
        attempts.push({ tokens: [...new Set(next)], fallback: shortened });
    }
    return attempts;
}
