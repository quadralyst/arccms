/**
 * An email shown in a sandboxed frame (`<iframe sandbox="">`, so nothing in it can run
 * script in the admin's session) keeps its reader on the email.
 *
 * A link in such a frame navigates the frame. The page it reaches runs without scripts
 * and, being cross-origin to the frame, without the site's stylesheet, so a link to the
 * site itself shows the app's bare "Loading..." for good, and the email is gone until the
 * log is opened again. A target of a new window is refused by the sandbox instead, so a
 * click does nothing. That is wanted: a link in an email may do something (an unsubscribe
 * link would unsubscribe its recipient), and it belongs to whoever the email was sent to.
 */
const NEW_WINDOW = '<base target="_blank">';

/** The email's HTML, whose links can no longer replace it in the frame. It looks the same. */
export function emailPreviewDocument(html: string): string {
    const kept = html.replace(/\btarget\s*=\s*(["']?)_self\1/gi, 'target="_blank"');
    // In the head when it has one, and never before a doctype: that would change how it renders.
    const head = /<head(\s[^>]*)?>/i.exec(kept);
    const at = head ? head.index + head[0].length : (/^\s*<!doctype[^>]*>/i.exec(kept)?.[0].length ?? 0);
    return kept.slice(0, at) + NEW_WINDOW + kept.slice(at);
}

/** Whether the email has a link, so the preview can say that links do not open from it. */
export function emailHasLinks(html: string): boolean {
    return /<a\s[^>]*href\s*=/i.test(html);
}
