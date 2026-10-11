/**
 * The words of the body for the automatic summary: no file cards (their type
 * and size are not prose, docs/features/media.html), and a space where one
 * block ends, so "below.</p><p>Menu" does not read "below.Menu".
 */
export function summaryPlainText(html: string): string {
    return html
        .replace(/<a\b[^>]*class="arc-file[^"]*"[^>]*>[\s\S]*?<\/a>/g, ' ')
        .replace(/<\/(p|h[1-6]|li|blockquote|div)>|<br\s*\/?>/gi, ' ')
        .replace(/<[^>]*>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/[ \t]{2,}/g, ' ');
}
