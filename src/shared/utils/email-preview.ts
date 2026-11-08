/**
 * An email shown in a sandboxed frame keeps its reader on the email, and its links work as
 * they would in a mail app, except the ones that act for the person it was sent to.
 *
 * The frame runs no script (`sandbox` has no `allow-scripts`), so nothing in a stored email
 * can act in the admin's session. Followed inside the frame, a link replaced the email:
 * the app's own page loaded there with no scripts and, cross-origin to the frame, no
 * stylesheet, and stayed on its bare "Loading...". So every link opens in a new tab
 * (`<base target="_blank">`, with `allow-popups allow-popups-to-escape-sandbox` on the
 * frame), without a way back to the frame (`rel="noopener noreferrer"`).
 *
 * Arc CMS's unsubscribe and preference links do not open: they act for the recipient
 * (one click unsubscribes them), and the admin reading a log is not that person. They lose
 * their address, keep a link's look, and say why when pointed at. Not `href="#"`: in a
 * srcdoc frame that is the admin page's own address, and loads the app in the frame. For
 * the same reason a link to a spot in the email (`#top`) loses its address, and so does a
 * script or data address, which would run outside the sandbox in the new tab.
 *
 * A link the email gave no address does not open either: an empty one (`href=""`, which
 * would open the admin page itself in the new tab) and one whose address is still a
 * `##TAG##` (a template shown before it is sent). Each says why when pointed at, so an
 * admin can tell it from a fault.
 */
const NEW_WINDOW = '<base target="_blank">';

/** The attributes of a frame that shows an email: no script, links to a new tab. */
export const EMAIL_FRAME_SANDBOX = 'allow-popups allow-popups-to-escape-sandbox';

/** What a link that acts for the recipient says when pointed at. */
export const RECIPIENT_LINK_TITLE = 'Opens for the recipient, so it does not open from here';

/** What a link says when the email gave it no address: empty, or a tag filled with nothing. */
export const NO_ADDRESS_TITLE = 'No address was filled in';

/** What a link says when its address is still a tag, as in an email not yet sent. */
export const UNFILLED_TAG_TITLE = 'Filled in when the email is sent';

/** Arc CMS's links that act for the recipient: its unsubscribe and preference pages, or their tags before sending. */
const ACTS_FOR_RECIPIENT = /^(?:##(?:UNSUBSCRIBE|PREFERENCES)_LINK##|[^?#]*\/(?:unsubscribe|email-preferences)(?:[?#]|$))/i;

/** A link's `href`: quoted, bare, or written with no value (`<a href>`), never `data-href`. */
const HREF = /\shref(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?(?=[\s/>])/i;
const TITLE = /\stitle\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/i;

/** An address still holding a `##TAG##`, as in a template before it is sent. */
const HOLDS_TAG = /##[^#"'<>]+##/;
const STYLE = /\sstyle\s*=\s*("([^"]*)"|'([^']*)')/i;

/** An address that cannot open from a preview: a spot in the email, or a script or data URL. */
const GOES_NOWHERE = /^(?:#|(?:javascript|data|vbscript|file):)/i;

/** Whether a link's address is one of Arc CMS's that act for the recipient. */
export function actsForRecipient(href: string): boolean {
    return ACTS_FOR_RECIPIENT.test(href.trim());
}

/** The email's HTML, whose links open in a new tab (but those that act for the recipient). It looks the same. */
export function emailPreviewDocument(html: string): string {
    // A refresh would move the frame to another page on its own, and the sandbox lets a
    // frame navigate itself: a stored email or version could show a lookalike sign-in
    // page inside the admin. Previews never refresh.
    const kept = html.replace(/<meta\b[^>]*http-equiv\s*=\s*["']?\s*refresh[^>]*>/gi, '').replace(/<a\b[^>]*>/gi, (tag) => {
        const href = HREF.exec(tag);
        if (!href) return tag;
        const value = href[1] ?? href[2] ?? href[3] ?? '';
        // Whatever the email asked for, the link's own target and rel are ours.
        const bare = tag.replace(/\s(?:target|rel)\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
        const why = actsForRecipient(value) ? RECIPIENT_LINK_TITLE
            : !value.trim() ? NO_ADDRESS_TITLE
            : HOLDS_TAG.test(value) ? UNFILLED_TAG_TITLE
            : null;
        if (why || GOES_NOWHERE.test(value.trim())) {
            // No address, so nothing to open; the link's look from its own style, else a link's colours.
            const look = 'color:LinkText;text-decoration:underline;cursor:not-allowed;';
            const styled = STYLE.test(bare)
                ? bare.replace(STYLE, (_m, _q, dq, sq) => ` style="${look}${(dq ?? sq ?? '').replace(/"/g, "'")}"`)
                : bare.replace(/\s*\/?>$/, (end) => ` style="${look}"${end}`);
            // A spot in the email or a script address: inert, and nothing to explain.
            if (!why) return styled.replace(HREF, ' aria-disabled="true"');
            return styled.replace(TITLE, '').replace(HREF, ` aria-disabled="true" title="${why}"`);
        }
        return bare.replace(/\s*\/?>$/, (end) => ` target="_blank" rel="noopener noreferrer"${end}`);
    });
    // In the head when it has one, and never before a doctype: that would change how it renders.
    const head = /<head(\s[^>]*)?>/i.exec(kept);
    const at = head ? head.index + head[0].length : (/^\s*<!doctype[^>]*>/i.exec(kept)?.[0].length ?? 0);
    return kept.slice(0, at) + NEW_WINDOW + kept.slice(at);
}

/** Whether the email has a link that acts for the recipient, so the preview can say why it does not open. */
export function emailHasRecipientLinks(html: string): boolean {
    const links = html.match(/<a\b[^>]*>/gi) ?? [];
    return links.some((tag) => {
        const href = HREF.exec(tag);
        return !!href && actsForRecipient(href[1] ?? href[2] ?? href[3] ?? '');
    });
}
