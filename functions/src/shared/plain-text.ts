/**
 * Plain text an editor typed, as safe HTML: an FAQ answer's `answer_html`
 * (specs/site-sections-spec.md, SS4). Everything is escaped; a blank line
 * starts a new paragraph, a single line break stays a line break, and
 * http(s) addresses become links.
 *
 * Mirror of src/shared/utils/plain-text.ts, which is the source of truth: the
 * Cloud Functions build cannot import from src/. src/shared/utils/plain-text.spec.ts
 * checks that the two agree.
 */

const escapeHtml = (value: string): string =>
    value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

/** An address ends before whitespace or a closing bracket, and gives back trailing punctuation. */
const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/g;

function linkify(line: string): string {
    let html = '';
    let last = 0;
    for (const match of line.matchAll(URL_PATTERN)) {
        let url = match[0];
        const trailing = /[.,;:!?]+$/.exec(url)?.[0] ?? '';
        url = url.slice(0, url.length - trailing.length);
        const start = match.index ?? 0;
        html += escapeHtml(line.slice(last, start));
        html += `<a href="${escapeHtml(url)}">${escapeHtml(url)}</a>`;
        last = start + url.length;
    }
    return html + escapeHtml(line.slice(last));
}

/** The text as paragraphs of escaped, linked lines; '' for none. */
export function plainTextHtml(text: unknown): string {
    if (typeof text !== 'string' || !text.trim()) return '';
    return text
        .replace(/\r\n?/g, '\n')
        .split(/\n\s*\n/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph) => `<p>${paragraph.split('\n').map((line) => linkify(line.trim())).join('<br>')}</p>`)
        .join('');
}
