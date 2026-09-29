/**
 * Escape text for HTML. Use it on every value put into markup that is then
 * trusted with `bypassSecurityTrustHtml` (confirmation dialogs render their
 * message with innerHTML): names, titles and addresses are typed by members,
 * editors or visitors, and would otherwise run as script in an admin's session.
 */
export function escapeHtml(value: unknown): string {
    return String(value ?? '').replace(/[&<>"']/g, (c) => (
        { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
    ));
}
