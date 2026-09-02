/**
 * Allowlist sanitiser for the inline SVG stored on an icon token.
 *
 * Why this exists at all: a bound value containing tags is injected with
 * `$el.html(value)` when a page is published (functions/src/shared/
 * template-hydration.ts) — the icon markup reaches the static HTML verbatim.
 * The markup this app writes is machine-generated from the Font Awesome path
 * data, so nothing hostile is expected; this is the gate that keeps it that
 * way if a token is ever hand-edited in Firestore or a future icon set
 * supplies its own markup.
 *
 * Deliberately allowlist-based rather than a blocklist of `<script>` and
 * `on*`: SVG has too many script vectors (`<use href>`, `<foreignObject>`,
 * `<animate attributeName="href">`, `<set>`) for "remove the bad parts" to be
 * a claim anyone can verify. Anything not named below is dropped.
 *
 * Sanitising happens on write, in the admin. It is not repeated server-side:
 * an admin who can write a content document can already publish arbitrary
 * HTML through any richtext field, which lands in the same `$el.html()` call.
 * The trust boundary is "admin", and this guards accidents inside it, not a
 * privilege escalation across it.
 */

/** Elements an icon may legitimately be built from. */
const ALLOWED_ELEMENTS = new Set([
    'svg',
    'path',
    'g',
    'circle',
    'ellipse',
    'line',
    'polygon',
    'polyline',
    'rect',
    'title',
]);

/**
 * Attributes that describe geometry or presentation.
 *
 * No `href`/`xlink:href` in any form — that is `<use>`'s route to an external
 * document, and `javascript:` in an `<a>`. No `style`, which carries
 * `url(…)`. No `id`/`class`, which are the hooks a page's own CSS could be
 * made to act on.
 */
const ALLOWED_ATTRIBUTES = new Set([
    'aria-hidden',
    'aria-label',
    'clip-rule',
    'cx',
    'cy',
    'd',
    'fill',
    'fill-opacity',
    'fill-rule',
    'focusable',
    'height',
    'opacity',
    'points',
    'preserveaspectratio',
    'r',
    'role',
    'rx',
    'ry',
    'stroke',
    'stroke-linecap',
    'stroke-linejoin',
    'stroke-width',
    'transform',
    'viewbox',
    'width',
    'x',
    'x1',
    'x2',
    'xmlns',
    'y',
    'y1',
    'y2',
]);

/**
 * Attribute values may not reference anything fetchable or executable.
 * `url(` covers `fill="url(#x)"`, which is harmless in isolation but only
 * useful with the `<defs>` we do not allow.
 *
 * Entities are already decoded by the time this runs — the parser resolves
 * `&#106;avascript:` before we see it — so this matches the real value, not
 * the source spelling.
 */
const FORBIDDEN_VALUE = /javascript:|data:|url\s*\(|expression\s*\(/i;

/**
 * Returns sanitised `<svg>` markup, or an empty string when the input is not
 * usable as an icon.
 *
 * An empty string is the honest result for unusable input: the caller stores
 * no `markup`, the icon still renders from its class name, and nothing
 * half-scrubbed reaches a published page.
 */
export function sanitizeSvg(markup: string | null | undefined): string {
    if (!markup || typeof markup !== 'string') return '';
    if (typeof DOMParser === 'undefined') return '';

    // `image/svg+xml` rather than `text/html`: the HTML parser lowercases
    // `viewBox` to `viewbox` and silently repairs malformed markup, so a
    // broken input would come back looking valid.
    const doc = new DOMParser().parseFromString(markup.trim(), 'image/svg+xml');

    if (doc.getElementsByTagName('parsererror').length > 0) return '';

    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg') return '';

    if (!scrub(root)) return '';

    // A root stripped down to nothing draws nothing — report it as unusable
    // rather than storing an empty `<svg/>` that looks like a working icon.
    if (root.children.length === 0) return '';

    return new XMLSerializer().serializeToString(root);
}

/**
 * Strips disallowed attributes from `element` and removes disallowed
 * descendants. Returns false when the element itself must go.
 */
function scrub(element: Element): boolean {
    if (!ALLOWED_ELEMENTS.has(element.nodeName.toLowerCase())) return false;

    // Snapshot: removing an attribute mutates the live `attributes` list.
    for (const name of Array.from(element.attributes, (a) => a.name)) {
        const value = element.getAttribute(name) ?? '';
        const lower = name.toLowerCase();

        // Namespaced attributes (`xlink:href`, `xml:base`) are rejected
        // wholesale — the allowlist below only recognises bare names, so a
        // prefixed spelling of an allowed name must not sneak through.
        const isNamespaced = lower.includes(':') && lower !== 'xmlns';

        if (isNamespaced || !ALLOWED_ATTRIBUTES.has(lower) || FORBIDDEN_VALUE.test(value)) {
            element.removeAttribute(name);
        }
    }

    for (const child of Array.from(element.children)) {
        if (!scrub(child)) child.remove();
    }

    return true;
}
