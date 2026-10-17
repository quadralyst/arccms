/**
 * The editor's site look (specs/editor-site-look-spec.md, ES1): the live page's
 * CSS for an entry's body, kept inside the editor.
 *
 * The page styles the body with three sources: `main.css`, the app's `site.css`
 * and the `<style>` blocks of the entry's detail template. The editor uses the
 * same three, with every rule wrapped in `@scope (root) to (limit)` so it styles
 * only the editor and never the admin around it, and the template's elements
 * around the body rebuilt around the editor (bodyChain), so a selector such as
 * `.article-wrapper .article-content p` matches as it does on the page.
 *
 * Pure functions: no fetching and no Angular. The editor's service feeds them.
 */

/** One element of the wrapper rebuilt around the editor. */
export interface ChainElement {
    tag: string;
    classes: string[];
    id: string | null;
}

/** The element a template fills with a field, and the template elements around it, outermost first. */
export interface BodyChain {
    ancestors: ChainElement[];
    body: ChainElement;
}

/** An `@import` found in a stylesheet: the caller fetches it and scopes it too. */
export interface CssImport {
    /** Resolved against the sheet it came from. */
    url: string;
    /** What followed the URL (media query, `supports()`, `layer`), as written. */
    condition: string;
}

/** A stylesheet made safe for the editor. */
export interface ScopedCss {
    /** Rules that cannot sit inside `@scope` and style nothing by themselves (`@font-face`, `@keyframes`). */
    hoisted: string[];
    /** The style rules, inside `@scope`, in their original order. */
    blocks: string[];
    imports: CssImport[];
}

export interface ScopeOptions {
    /** The look's root, the stand-in for the page's `<html>` and `<body>`. */
    scope: string;
    /** Elements inside the root the site CSS must not reach (the editor's own controls). */
    limit?: string;
    /** The address relative `url()`s resolve against: the sheet's, or the page's for a template's inline styles. */
    baseUrl: string;
}

/** Tags kept as they are when rebuilt; anything else becomes a `div`, so nothing interactive or Angular-rendered is created. */
const LAYOUT_TAGS = new Set(['div', 'article', 'section', 'main', 'aside', 'header', 'footer', 'figure', 'span', 'nav']);

/**
 * Where a template puts a field: the element bound with `[innerHTML]="key"` and
 * its ancestors, or null when the template does not place it. When the field is
 * placed twice, the first place is used.
 */
export function bodyChain(templateHtml: string, key: string): BodyChain | null {
    const doc = new DOMParser().parseFromString(templateHtml, 'text/html');
    // HTML lowercases attribute names, so `[innerHTML]` reads as `[innerhtml]`.
    const bound = Array.from(doc.body.querySelectorAll('*'))
        .find((el) => el.getAttribute('[innerhtml]')?.trim() === key);
    if (!bound) return null;
    const ancestors: ChainElement[] = [];
    for (let el = bound.parentElement; el && el !== doc.body; el = el.parentElement) {
        ancestors.unshift(chainElement(el));
    }
    return { ancestors, body: chainElement(bound) };
}

function chainElement(el: Element): ChainElement {
    const tag = el.tagName.toLowerCase();
    const classes = withoutInterpolation(el.getAttribute('class'))
        .split(/\s+/)
        .filter((name) => name && name !== 'arc-skeleton');
    const id = withoutInterpolation(el.getAttribute('id')).trim();
    return { tag: LAYOUT_TAGS.has(tag) ? tag : 'div', classes, id: id && !/\s/.test(id) ? id : null };
}

function withoutInterpolation(value: string | null): string {
    return (value ?? '').replace(/\{\{[\s\S]*?\}\}/g, ' ');
}

/** The text of a template's `<style>` blocks, in order. */
export function templateStyles(templateHtml: string): string {
    const doc = new DOMParser().parseFromString(templateHtml, 'text/html');
    return Array.from(doc.querySelectorAll('style')).map((style) => style.textContent ?? '').join('\n');
}

/**
 * Bootstrap's `body` defaults for the look's root. On the page Bootstrap's own
 * `body` rule gives them; it does not reach inside the editor, where the admin
 * pane would pass down its own instead. Assembled before the site's rules, so
 * the site's `body` rules win as they do on the page.
 */
export function rootDefaults(options: Pick<ScopeOptions, 'scope' | 'limit'>): string {
    return `${scopePrelude(options)} {\n:scope {
font-family: var(--bs-body-font-family);
font-size: var(--bs-body-font-size);
font-weight: var(--bs-body-font-weight);
line-height: var(--bs-body-line-height);
color: var(--bs-body-color);
text-align: var(--bs-body-text-align);
background-color: var(--bs-body-bg);
}\n}`;
}

export interface AssembleOptions extends Pick<ScopeOptions, 'scope' | 'limit'> {
    /**
     * Put before the name of every `@keyframes` the sheets define, and before
     * those names in `animation` and `animation-name`. Keyframes are global, so
     * without it a site animation named like one of the admin's (main.css has
     * `pulse`) would replace the admin's while the editor is open.
     */
    keyframesPrefix?: string;
}

/** The look's whole stylesheet: every sheet's hoisted rules, the root defaults, then every sheet's rules in order. */
export function assembleSiteLook(options: AssembleOptions, sheets: ScopedCss[]): string {
    const css = [
        ...sheets.flatMap((sheet) => sheet.hoisted),
        rootDefaults(options),
        ...sheets.flatMap((sheet) => sheet.blocks),
    ].join('\n');
    return options.keyframesPrefix ? prefixKeyframes(css, options.keyframesPrefix) : css;
}

function prefixKeyframes(css: string, prefix: string): string {
    const names = new Set<string>();
    const renamed = css.replace(/@(-webkit-|-moz-)?keyframes\s+(["']?)([\w-]+)\2/gi, (_whole, vendor: string | undefined, _quote, name: string) => {
        names.add(name);
        return `@${vendor ?? ''}keyframes ${prefix}${name}`;
    });
    if (!names.size) return renamed;
    // Only the sheets' own keyframes: an animation naming one of Bootstrap's still finds it, as on the page.
    return renamed.replace(/(animation(?:-name)?\s*:)([^;}]*)/gi, (_whole, head: string, value: string) =>
        head + value.replace(/[\w-]+/g, (word) => (names.has(word) ? prefix + word : word)));
}

/** At-rules that cannot sit inside `@scope` and style no element by themselves. */
const HOISTED = new Set([
    'font-face', 'keyframes', '-webkit-keyframes', '-moz-keyframes', 'property',
    'counter-style', 'font-feature-values', 'font-palette-values',
]);

/** At-rules holding rules: kept, with their rules scoped inside. */
const GROUPS = new Set(['media', 'supports', 'layer', 'container', 'starting-style']);

/**
 * Wraps a stylesheet's rules in `@scope` (ES-D2): `html`, `body` and `:root` at
 * the start of a selector become `:scope` (ES-D4), the rules `@scope` cannot
 * hold are hoisted (ES-D5), relative `url()`s are resolved (ES-D6), and
 * `@import`s are returned for the caller to fetch and scope as well (left in,
 * their rules would style the admin). Anything else that is not a style rule
 * (`@page`, `@namespace`, unknown at-rules) is left out for the same reason.
 */
export function scopeCss(css: string, options: ScopeOptions): ScopedCss {
    const out: ScopedCss = { hoisted: [], blocks: [], imports: [] };
    out.blocks = scopeRules(splitRules(stripComments(css)), options, true, out);
    return out;
}

function scopePrelude({ scope, limit }: Pick<ScopeOptions, 'scope' | 'limit'>): string {
    return limit ? `@scope (${scope}) to (${limit})` : `@scope (${scope})`;
}

function scopeRules(rules: CssRule[], options: ScopeOptions, top: boolean, out: ScopedCss): string[] {
    const emitted: string[] = [];
    let batch: string[] = [];
    const flush = () => {
        if (batch.length) emitted.push(`${scopePrelude(options)} {\n${batch.join('\n')}\n}`);
        batch = [];
    };

    for (const { prelude, block } of rules) {
        if (!prelude.startsWith('@')) {
            if (block === null || !prelude) continue;
            const body = resolveUrls(block, options.baseUrl);
            const { root, other } = rewriteSelectorList(prelude);
            if (root.length) batch.push(cssRule(root.join(', '), withoutPageFrame(body)));
            if (other.length) batch.push(cssRule(other.join(', '), body));
            continue;
        }

        const name = prelude.slice(1).match(/^[\w-]+/)?.[0].toLowerCase() ?? '';
        if (name === 'import') {
            const found = top ? parseImport(prelude, options.baseUrl) : null;
            if (found) out.imports.push(found);
        } else if (HOISTED.has(name) || (name === 'layer' && block === null)) {
            const text = block === null ? `${prelude};` : cssRule(prelude, resolveUrls(block, options.baseUrl));
            if (top) {
                out.hoisted.push(text);
            } else {
                flush();
                emitted.push(text);
            }
        } else if (name === 'scope' && block !== null) {
            // The site's own @scope nests inside the look's: its root is found within the editor.
            batch.push(cssRule(prelude, resolveUrls(block, options.baseUrl)));
        } else if (GROUPS.has(name) && block !== null) {
            flush();
            const inner = scopeRules(splitRules(block), options, false, out);
            if (inner.length) emitted.push(`${prelude} {\n${inner.join('\n')}\n}`);
        }
    }
    flush();
    return emitted;
}

function cssRule(prelude: string, block: string): string {
    const inside = block.trim();
    return inside ? `${prelude} { ${inside} }` : `${prelude} {}`;
}

/** Properties that size or place the page itself, dropped from rules that land on the look's root. */
const PAGE_FRAME = /^(margin|padding|height|min-height|max-height|width|min-width|max-width|overflow|overflow-x|overflow-y|position|top|right|bottom|left|inset|display|float|transform|zoom)(-|$)/i;

/**
 * A root rule's declarations without the page frame: `body { margin: 0;
 * padding-top: 70px; overflow-x: hidden }` sizes the whole page, not the body
 * text, and on the editor's root it would only add gaps. A block holding nested
 * rules is kept whole.
 */
function withoutPageFrame(block: string): string {
    if (block.includes('{')) return block;
    return splitTop(block, ';')
        .filter((declaration) => {
            const property = declaration.split(':')[0].trim();
            return property && !PAGE_FRAME.test(property);
        })
        .map((declaration) => declaration.trim())
        .join('; ');
}

/** A selector list split into those now naming the look's root alone and the rest. */
function rewriteSelectorList(prelude: string): { root: string[]; other: string[] } {
    const root: string[] = [];
    const other: string[] = [];
    for (const selector of splitTop(prelude, ',')) {
        const trimmed = selector.trim();
        if (!trimmed) continue;
        const rewritten = rewriteSelector(trimmed);
        (rewritten.rootOnly ? root : other).push(rewritten.selector);
    }
    return { root, other };
}

/**
 * `html`, `body`, `:root`, and `html body` or `html > body`, at the start of a
 * selector become `:scope`, keeping their qualifiers: `body > footer` is
 * `:scope > footer`, `html[dir="rtl"] .x` is `:scope[dir="rtl"] .x`.
 */
export function rewriteSelector(selector: string): { selector: string; rootOnly: boolean } {
    const firstEnd = compoundEnd(selector, 0);
    const first = pageElement(selector.slice(0, firstEnd));
    if (!first) return { selector, rootOnly: false };

    let qualifiers = first.qualifiers;
    let rest = selector.slice(firstEnd);
    if (first.element === 'html') {
        const combinator = rest.match(/^\s*(>?)\s*/);
        if (combinator && (combinator[0].length > 0)) {
            const start = combinator[0].length;
            const end = compoundEnd(rest, start);
            const second = pageElement(rest.slice(start, end));
            if (second?.element === 'body') {
                qualifiers += second.qualifiers;
                rest = rest.slice(end);
            }
        }
    }
    return { selector: `:scope${qualifiers}${rest}`, rootOnly: rest.trim() === '' };
}

function pageElement(compound: string): { element: 'html' | 'body'; qualifiers: string } | null {
    const match = compound.match(/^(html|body|:root)(?=$|[.#[:])/i);
    if (!match) return null;
    const element = match[1].toLowerCase() === 'body' ? 'body' : 'html';
    return { element, qualifiers: compound.slice(match[0].length) };
}

/** Where the compound selector starting at `from` ends: the next combinator outside brackets, parentheses and strings. */
function compoundEnd(selector: string, from: number): number {
    let depth = 0;
    for (let i = from; i < selector.length; i++) {
        const c = selector[i];
        if (c === '"' || c === "'") {
            i = stringEnd(selector, i) - 1;
        } else if (c === '(' || c === '[') {
            depth++;
        } else if (c === ')' || c === ']') {
            depth--;
        } else if (depth === 0 && /[\s>+~]/.test(c)) {
            return i;
        }
    }
    return selector.length;
}

/** `@import url(x.css) screen;` read into its resolved URL and condition. */
function parseImport(prelude: string, baseUrl: string): CssImport | null {
    const match = prelude.match(/^@import\s+(?:url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)|"([^"]*)"|'([^']*)')\s*([\s\S]*)$/i);
    if (!match) return null;
    const url = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5] ?? '';
    return url ? { url: resolveUrl(url, baseUrl), condition: match[6].trim() } : null;
}

/** Every relative `url()` in a block, resolved against `baseUrl`. */
export function resolveUrls(text: string, baseUrl: string): string {
    return text.replace(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s'"]*))\s*\)/gi, (whole, double, single, bare) => {
        const url = double ?? single ?? bare ?? '';
        const resolved = resolveUrl(url, baseUrl);
        return resolved === url ? whole : `url("${resolved}")`;
    });
}

function resolveUrl(url: string, baseUrl: string): string {
    if (!url || /^([a-z][a-z\d+.-]*:|\/|#)/i.test(url)) return url;
    const origin = 'http://arc.invalid';
    const resolved = new URL(url, new URL(baseUrl, origin));
    return resolved.origin === origin ? `${resolved.pathname}${resolved.search}${resolved.hash}` : resolved.href;
}

// ---------------------------------------------------------------------------
// A small CSS splitter: enough to find rules and blocks, respecting strings,
// comments, brackets and parentheses. It does not validate CSS; what the
// browser would drop, it passes through for the browser to drop.

interface CssRule {
    prelude: string;
    /** The block's inside, or null for a statement such as `@import ...;`. */
    block: string | null;
}

function stripComments(css: string): string {
    let out = '';
    for (let i = 0; i < css.length; i++) {
        const c = css[i];
        if (c === '"' || c === "'") {
            const end = stringEnd(css, i);
            out += css.slice(i, end);
            i = end - 1;
        } else if (c === '/' && css[i + 1] === '*') {
            const close = css.indexOf('*/', i + 2);
            i = close === -1 ? css.length : close + 1;
            out += ' ';
        } else {
            out += c;
        }
    }
    return out;
}

/** The index just past the string that opens at `start`. */
function stringEnd(text: string, start: number): number {
    const quote = text[start];
    for (let i = start + 1; i < text.length; i++) {
        if (text[i] === '\\') i++;
        else if (text[i] === quote || text[i] === '\n') return i + 1;
    }
    return text.length;
}

/** The first of `stops` at the top level from `from` (outside strings, brackets and parentheses), or -1. */
function findTop(text: string, from: number, stops: string): number {
    let depth = 0;
    for (let i = from; i < text.length; i++) {
        const c = text[i];
        if (c === '"' || c === "'") {
            i = stringEnd(text, i) - 1;
        } else if (c === '(' || c === '[') {
            depth++;
        } else if ((c === ')' || c === ']') && depth > 0) {
            depth--;
        } else if (depth === 0 && stops.includes(c)) {
            return i;
        }
    }
    return -1;
}

/** The index just past the block whose `{` is at `open`. */
function blockEnd(text: string, open: number): number {
    let depth = 0;
    for (let i = open; i < text.length; i++) {
        const c = text[i];
        if (c === '"' || c === "'") {
            i = stringEnd(text, i) - 1;
        } else if (c === '{') {
            depth++;
        } else if (c === '}' && --depth === 0) {
            return i + 1;
        }
    }
    return text.length;
}

function splitRules(css: string): CssRule[] {
    const rules: CssRule[] = [];
    let i = 0;
    while (i < css.length) {
        while (i < css.length && /[\s;]/.test(css[i])) i++;
        if (i >= css.length) break;
        const stop = findTop(css, i, '{;}');
        if (stop === -1) break;
        if (css[stop] === '}') {
            i = stop + 1;
        } else if (css[stop] === ';') {
            rules.push({ prelude: css.slice(i, stop).trim(), block: null });
            i = stop + 1;
        } else {
            const end = blockEnd(css, stop);
            const inside = css.slice(stop + 1, css[end - 1] === '}' ? end - 1 : end);
            rules.push({ prelude: css.slice(i, stop).trim(), block: inside });
            i = end;
        }
    }
    return rules;
}

/** `text` split on `separator` at the top level. */
function splitTop(text: string, separator: string): string[] {
    const parts: string[] = [];
    let from = 0;
    for (;;) {
        const at = findTop(text, from, separator);
        if (at === -1) break;
        parts.push(text.slice(from, at));
        from = at + 1;
    }
    parts.push(text.slice(from));
    return parts;
}
