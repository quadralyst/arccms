/**
 * Search tokenizer.
 *
 * One implementation serves both sides of the index: the writer tokenizes a
 * document's fields into the `tokens` array, and the callable tokenizes the
 * visitor's query. They must agree byte for byte, or a word that was indexed
 * one way is looked up another and never found. Nothing in here touches
 * Firestore, so the behaviour is fully covered by tokenizer.spec.ts.
 *
 * Spec: docs/search-spec.md, decisions S-D3 to S-D6.
 */

/** Prefixes are emitted from this length up to PREFIX_MAX (S-D4). */
export const PREFIX_MIN = 2;
export const PREFIX_MAX = 12;

/** Shortest token that is worth indexing or searching for. */
export const MIN_TOKEN_LENGTH = 2;

/** Hard cap on the token array of one index entry (S1.1). */
export const MAX_TOKENS_PER_ENTRY = 600;

/** Words kept per field by default; titles never get near it. */
export const DEFAULT_MAX_WORDS = 80;

/** Query tokens sent to Firestore. `array-contains-any` allows 30; ten is plenty. */
export const MAX_QUERY_TOKENS = 10;

/**
 * A short English list only (S-D5). Content in other languages keeps every
 * word: dropping the wrong "stop word" in a language nobody checked would cost
 * real matches for no gain.
 */
const STOP_WORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'but', 'by', 'for', 'from',
    'has', 'have', 'he', 'her', 'his', 'if', 'in', 'into', 'is', 'it', 'its',
    'of', 'on', 'or', 'our', 'she', 'so', 'that', 'the', 'their', 'then',
    'there', 'these', 'they', 'this', 'to', 'was', 'we', 'were', 'will',
    'with', 'you', 'your',
]);

export function isStopWord(word: string): boolean {
    return STOP_WORDS.has(word);
}

/**
 * Lowercases and folds text into its indexable form.
 *
 * Accent folding is deliberately Latin-only (S-D6): the string is decomposed,
 * combining marks that follow an ASCII letter are dropped, and the rest is
 * recomposed. A blanket strip of U+0300 to U+036F would look harmless and is
 * not: Devanagari vowel signs live elsewhere but Vietnamese, Arabic and many
 * others put real meaning in combining marks that share that block.
 *
 * Apostrophes vanish rather than split ("karun's" becomes "karuns") so that
 * the possessive still shares a prefix with the name. Every other symbol
 * becomes a space. Marks (\p{M}) are kept: Devanagari vowel signs are marks,
 * and stripping them would turn every Hindi word into consonants.
 */
export function normalize(text: string): string {
    if (!text) return '';
    const withoutTags = text.replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
    const folded = withoutTags
        .normalize('NFKC')
        .toLowerCase()
        .normalize('NFD')
        .replace(/([a-z])[̀-ͯ]+/g, '$1')
        .normalize('NFC');
    return folded
        .replace(/['’ʼ‘]/g, '')
        .replace(/[^\p{L}\p{M}\p{N}\s]+/gu, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Normalized whole words of a text, in order, duplicates kept. */
export function words(text: string): string[] {
    const normalized = normalize(text);
    return normalized ? normalized.split(' ') : [];
}

export interface TokenizeOptions {
    /** Also emit every prefix of each word, PREFIX_MIN to PREFIX_MAX chars. */
    prefix?: boolean;
    /** Words kept from the start of the text. */
    maxWords?: number;
    /** Keep stop words. The query side sets this when the query is nothing else. */
    keepStopWords?: boolean;
}

/**
 * The index tokens of one field: unique, stop words removed, optionally with
 * prefixes. Order is preserved so that a later cap keeps the earliest words.
 */
export function tokenize(text: string, options: TokenizeOptions = {}): string[] {
    const maxWords = options.maxWords ?? DEFAULT_MAX_WORDS;
    const seen = new Set<string>();
    const out: string[] = [];
    const push = (token: string) => {
        if (seen.has(token)) return;
        seen.add(token);
        out.push(token);
    };

    let kept = 0;
    for (const word of words(text)) {
        if (word.length < MIN_TOKEN_LENGTH) continue;
        if (!options.keepStopWords && isStopWord(word)) continue;
        if (kept >= maxWords) break;
        kept++;
        push(word);
        if (options.prefix) {
            const upto = Math.min(word.length - 1, PREFIX_MAX);
            for (let len = PREFIX_MIN; len <= upto; len++) push(word.slice(0, len));
        }
    }
    return out;
}

export interface QueryTokens {
    /** Tokens to send to Firestore and to score against, longest first. */
    tokens: string[];
    /** The normalized query as one string, for the phrase bonus. */
    phrase: string;
}

/**
 * Tokens for a visitor's query (no prefixes: the index holds those).
 *
 * Stop words go unless the whole query is stop words, in which case the
 * visitor evidently wants them. When more than MAX_QUERY_TOKENS remain the
 * longest survive, since a long word narrows a search far more than "new".
 */
export function queryTokens(query: string): QueryTokens {
    const all = words(query).filter(word => word.length >= MIN_TOKEN_LENGTH);
    const meaningful = all.filter(word => !isStopWord(word));
    const chosen = meaningful.length ? meaningful : all;

    const unique = [...new Set(chosen)];
    const tokens = unique
        .map((token, index) => ({ token, index }))
        .sort((a, b) => b.token.length - a.token.length || a.index - b.index)
        .slice(0, MAX_QUERY_TOKENS)
        .map(entry => entry.token);

    return { tokens, phrase: chosen.join(' ') };
}
