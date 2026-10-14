/**
 * The "Built with Arc CMS" line at the foot of every public page, while Settings,
 * Miscellaneous shows it. Its words are the site's: the `powered_by` and
 * `powered_by_title` keys of `/_site/strings/{lang}.json` translate them, as the
 * `signup_*` keys do the signup panels, and `{link}` marks where the "Arc CMS"
 * link goes. Only the name is a link.
 *
 * Publishing writes the same line (poweredByHtml in functions/src/shared/html-document.ts,
 * a mirror of this file); a parity test keeps the two equal.
 */
export const POWERED_BY_URL = 'https://arccms.com';
export const POWERED_BY_NAME = 'Arc CMS';

/** The English, used for any key a page's strings leave out. */
export const POWERED_BY_DEFAULTS = {
    powered_by: 'Built with {link} · your site, your code, your data',
    powered_by_title: 'Arc CMS: the open-source foundation for websites and apps you own',
} as const;

export interface PoweredByWords {
    /** The text before the link. */
    before: string;
    /** The text after the link. */
    after: string;
    /** The link's title. */
    title: string;
}

/**
 * The line in a page's strings. A translated `powered_by` without `{link}` would
 * lose the link, so the English stands for it.
 */
export function poweredByWords(strings: Record<string, string> = {}): PoweredByWords {
    const own = typeof strings['powered_by'] === 'string' ? strings['powered_by'].trim() : '';
    const sentence = own.includes('{link}') ? own : POWERED_BY_DEFAULTS.powered_by;
    const at = sentence.indexOf('{link}');
    const title = typeof strings['powered_by_title'] === 'string' && strings['powered_by_title'].trim()
        ? strings['powered_by_title'].trim()
        : POWERED_BY_DEFAULTS.powered_by_title;
    return { before: sentence.slice(0, at), after: sentence.slice(at + '{link}'.length), title };
}
