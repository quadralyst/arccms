/**
 * The automatic summary of an entry, and short text cut for a card or a feed
 * (docs/features/content.html#summary). One set of rules everywhere:
 *
 * - The words of the body, without markup or file cards, with a space at every
 *   block boundary, so a heading never glues to the next words.
 * - Whole sentences that fit in SUMMARY_LIMIT characters, the length search
 *   engines show of a meta description.
 * - Otherwise cut at a word boundary, ending in "...". Never mid-word.
 *
 * Source of truth; functions/src/shared/summary-text.ts is a mirror for the
 * Cloud Functions build, which cannot import from src/. summary-text.spec.ts
 * checks that the two agree.
 */

/**
 * Characters in an automatic summary. The summary is the meta description and
 * og:description too (until either is written by hand), and search engines show
 * about 155 to 160 characters of one before they cut it themselves.
 */
export const SUMMARY_LIMIT = 160;

/** Whole sentences shorter than this share of the limit leave too much out: the summary is cut at a word instead. */
const SHORTEST_SHARE = 0.25;

const ELLIPSIS = '...';

/** Tags that start or end a block: each one is a space between words. */
const BLOCK_TAGS =
    'address|article|aside|blockquote|caption|dd|details|div|dl|dt|figcaption|figure|footer|h[1-6]|header|hr|li|main|nav|ol|p|pre|section|summary|table|tbody|td|tfoot|th|thead|tr|ul';
const BLOCK_BOUNDARY = new RegExp(`<\\/?(?:${BLOCK_TAGS})\\b[^>]*>|<br\\b[^>]*>`, 'gi');

/**
 * Where a sentence ends: a full stop, question or exclamation mark (and any
 * closing quotes or brackets) before a space and a word that is not lowercase,
 * so "e.g. the" does not end one; or a mark that needs no space after it.
 */
const SENTENCE_END = /[.!?\u2026]+["'\u201d\u2019)\]]*(?=\s(?!\p{Ll}))|[\u3002\uff01\uff1f\u0964\u0965]+["'\u201d\u2019)\]\u300d\u300f]*/gu;

/**
 * The words of an HTML text on one line: no file cards (their type and size are
 * not prose, docs/features/media.html), a space where any block starts or ends,
 * none inside a word ("wo<b>rd</b>" stays "word"), common entities read as their
 * characters. `&lt;` and `&gt;` stay as they are, so the text never grows a tag.
 */
export function summaryPlainText(html: string): string {
    return (html || '')
        .replace(/<a\b[^>]*class="arc-file[^"]*"[^>]*>[\s\S]*?<\/a>/g, ' ')
        .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
        .replace(BLOCK_BOUNDARY, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;|&#160;|&#xa0;/gi, ' ')
        .replace(/&quot;|&#34;/g, '"')
        .replace(/&#39;|&#x27;|&apos;/gi, "'")
        .replace(/&amp;/g, '&')
        .replace(/\s+/g, ' ')
        .trim();
}

/** Text cut at a word boundary to fit `limit` characters, ending in "..." when anything was left out. */
export function clipWords(text: string, limit: number = SUMMARY_LIMIT): string {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    const room = Math.max(1, limit - ELLIPSIS.length);
    // A space at `room` means the word before it ends exactly there.
    const space = clean.lastIndexOf(' ', room);
    // Only a run of letters longer than half the room (a web address, or a script
    // written without spaces) is cut inside: there is no word to keep whole.
    let cut = space > room / 2 ? clean.slice(0, space) : clean.slice(0, endOfChar(clean, room));
    cut = cut.replace(/[\s.,;:\u2026\-([{"'\u201c\u2018]+$/u, '');
    return cut + ELLIPSIS;
}

/**
 * Text as a summary: all of it when it fits, else the whole sentences that fit,
 * else (one long first sentence, or too few words) cut at a word with "...".
 */
export function shortText(text: string, limit: number = SUMMARY_LIMIT): string {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (clean.length <= limit) return clean;
    let end = 0;
    for (const match of clean.matchAll(SENTENCE_END)) {
        const after = (match.index ?? 0) + match[0].length;
        if (after > limit) break;
        end = after;
    }
    return end >= limit * SHORTEST_SHARE ? clean.slice(0, end).trim() : clipWords(clean, limit);
}

/** The automatic summary of a body: its first whole sentences, up to SUMMARY_LIMIT characters. */
export function bodyExcerpt(html: string, limit: number = SUMMARY_LIMIT): string {
    return shortText(summaryPlainText(html || ''), limit);
}

/**
 * The automatic summaries this body has had, the current one first: before
 * this rule the editor stored the first 100 characters of the text, with no
 * space between blocks until October 2026. A stored summary equal to any of
 * them follows the body (it was never written by hand), so an older entry
 * moves to the current summary when it is next opened in the classic editor
 * or its body changes.
 */
export function automaticSummaries(html: string): string[] {
    const body = html || '';
    const firstHundred = (text: string) => text.trim().substring(0, 100).trim();
    // The editor's plain text from October 2026 until this rule.
    const spaced = body
        .replace(/<a\b[^>]*class="arc-file[^"]*"[^>]*>[\s\S]*?<\/a>/g, ' ')
        .replace(/<\/(p|h[1-6]|li|blockquote|div)>|<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/[ \t]{2,}/g, ' ');
    // The editor's plain text before October 2026.
    const glued = body.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ');
    const all = [bodyExcerpt(body), firstHundred(spaced), firstHundred(glued)].filter(Boolean);
    return [...new Set(all)];
}

/** The index just after the character that ends at `index`, without splitting a surrogate pair. */
function endOfChar(text: string, index: number): number {
    const code = text.charCodeAt(index - 1);
    return code >= 0xd800 && code <= 0xdbff ? index - 1 : index;
}
