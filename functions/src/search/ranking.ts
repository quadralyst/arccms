/**
 * Scores candidates and marks what matched.
 *
 * Firestore hands back every entry that shares any token with the query, in
 * recency order. This is what turns that pile into search results: entries
 * matching more of the query, in heavier fields, as whole words, rank first.
 * Pure functions, so ranking.spec.ts can pin every row of the spec's
 * behaviour table.
 *
 * Spec: docs/search-spec.md, phase S3 item 4.
 */

import { normalize, words } from './tokenizer.js';

export const WHOLE_WORD_SCORE = 1;
export const PREFIX_SCORE = 0.6;
export const COVERAGE_SCALE = 0.5;
/**
 * Added when every query token matched. A constant rather than anything
 * derived from the entry, so an entry with more indexed fields is not
 * rewarded for having them.
 */
export const ALL_TOKENS_BONUS = 4;

/** The parts of an index entry ranking needs. */
export interface Rankable {
    fields: Record<string, string>;
    weights: Record<string, number>;
    boost?: number;
    title: string;
    snippet?: string;
    sortAt?: unknown;
}

/** Character ranges in the original strings, for the client to highlight. */
export interface Highlights {
    title: [number, number][];
    snippet: [number, number][];
}

export interface Ranked<T extends Rankable> {
    entry: T;
    score: number;
    matched: number;
    highlights: Highlights;
}

interface MatchQuality {
    /** 0 when nothing matched, PREFIX_SCORE for a prefix, WHOLE_WORD_SCORE for a whole word. */
    quality: number;
}

function bestMatch(fieldWords: string[], token: string): MatchQuality {
    let quality = 0;
    for (const word of fieldWords) {
        if (word === token) return { quality: WHOLE_WORD_SCORE };
        if (word.startsWith(token)) quality = Math.max(quality, PREFIX_SCORE);
    }
    return { quality };
}

function sortMillis(value: unknown): number {
    if (!value) return 0;
    if (value instanceof Date) return value.getTime();
    if (typeof value === 'object') {
        const raw = value as { toMillis?: () => number; seconds?: number; _seconds?: number };
        if (typeof raw.toMillis === 'function') return raw.toMillis();
        if (typeof raw.seconds === 'number') return raw.seconds * 1000;
        if (typeof raw._seconds === 'number') return raw._seconds * 1000;
    }
    if (typeof value === 'number') return value;
    return 0;
}

/**
 * The score of one entry against the query tokens, or null when nothing
 * matched at all (possible after the typo fallback widened the token set).
 */
export function scoreEntry<T extends Rankable>(
    entry: T,
    tokens: string[],
    phrase: string,
): Ranked<T> | null {
    if (tokens.length === 0) return null;

    const fieldWords = new Map<string, string[]>();
    for (const [path, text] of Object.entries(entry.fields)) {
        fieldWords.set(path, words(text));
    }

    const weightOf = (path: string) => entry.weights[path] ?? 1;
    const maxWeight = Object.keys(entry.fields).map(weightOf).reduce((max, weight) => Math.max(max, weight), 0);

    let score = 0;
    let matched = 0;
    for (const token of tokens) {
        let best = 0;
        for (const [path, fieldTokens] of fieldWords) {
            const { quality } = bestMatch(fieldTokens, token);
            if (quality > 0) best = Math.max(best, quality * weightOf(path));
        }
        if (best > 0) {
            matched++;
            score += best;
        }
    }
    if (matched === 0) return null;

    // Every token matched.
    if (matched === tokens.length) score += ALL_TOKENS_BONUS;

    // The exact query inside the title beats the same words scattered about.
    const title = normalize(entry.title);
    if (phrase && title && title.includes(phrase)) score += 2 * maxWeight;

    // A short title fully matched beats a long one partly matched.
    const titleWords = words(entry.title).length;
    if (titleWords > 0) score += COVERAGE_SCALE * (matched / titleWords);

    score *= entry.boost ?? 1;

    return {
        entry,
        score,
        matched,
        highlights: {
            title: highlightRanges(entry.title, tokens),
            snippet: highlightRanges(entry.snippet ?? '', tokens),
        },
    };
}

/** Ranks candidates: score, then recency. Drops anything that matched nothing. */
export function rank<T extends Rankable>(
    candidates: T[],
    tokens: string[],
    phrase: string,
): Ranked<T>[] {
    const ranked: Ranked<T>[] = [];
    for (const candidate of candidates) {
        const scored = scoreEntry(candidate, tokens, phrase);
        if (scored) ranked.push(scored);
    }
    ranked.sort((a, b) =>
        b.score - a.score
        || sortMillis(b.entry.sortAt) - sortMillis(a.entry.sortAt)
        || a.entry.title.localeCompare(b.entry.title));
    return ranked;
}

/**
 * Where the query tokens sit in an original string.
 *
 * Words are located in the original text and compared in normalized form,
 * so "Karun" is highlighted when the query was "kar" and "Gunján" when the
 * query was "gunjan". A prefix match highlights the matched prefix only. The
 * client never re-implements matching (S3 item 6).
 */
export function highlightRanges(text: string, tokens: string[]): [number, number][] {
    if (!text || tokens.length === 0) return [];
    const ranges: [number, number][] = [];
    const wordPattern = /[\p{L}\p{N}'’ʼ‘]+/gu;
    let match: RegExpExecArray | null;
    while ((match = wordPattern.exec(text)) !== null) {
        const original = match[0];
        const normalized = normalize(original);
        if (!normalized) continue;

        // The longest token that fits: a whole-word match over any prefix.
        let best = '';
        for (const token of tokens) {
            if ((normalized === token || normalized.startsWith(token)) && token.length > best.length) best = token;
        }
        if (!best) continue;

        if (normalized === best) {
            ranges.push([match.index, match.index + original.length]);
            continue;
        }
        // Prefix length in the original: count original characters until
        // their normalized form covers the token.
        let end = 0;
        for (let i = 1; i <= original.length; i++) {
            if (normalize(original.slice(0, i)).length >= best.length) { end = i; break; }
        }
        ranges.push([match.index, match.index + (end || best.length)]);
    }
    return mergeRanges(ranges);
}

function mergeRanges(ranges: [number, number][]): [number, number][] {
    if (ranges.length < 2) return ranges;
    const sorted = [...ranges].sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [sorted[0]];
    for (const range of sorted.slice(1)) {
        const last = merged[merged.length - 1];
        if (range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
        else merged.push(range);
    }
    return merged;
}
