/**
 * The editor's site look engine (site-look.ts, specs/editor-site-look-spec.md ES1):
 * where a template puts the body, and the page's CSS made safe for the editor.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_BOOTSTRAP_VARIABLES, assembleSiteLook, bodyChain, resolveUrls, rewriteSelector, rootDefaults, scopeCss, templateStyles, underImportCondition } from './site-look';

const TEMPLATES = join(__dirname, '../../../../public/_site/templates');
const template = (path: string) => readFileSync(join(TEMPLATES, path), 'utf8');
const MAIN_CSS = readFileSync(join(__dirname, '../../../../public/assets/css/main.css'), 'utf8');

const OPTIONS = { scope: '.arc-site-look.arc-site-look-1', limit: '.arc-editor-ui', baseUrl: '/assets/css/site.css' };
const SCOPE = '@scope (.arc-site-look.arc-site-look-1) to (.arc-editor-ui)';

/** The top-level chunks of a stylesheet (the test inputs have no braces inside strings). */
function topLevel(css: string): string[] {
    const chunks: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < css.length; i++) {
        if (css[i] === '{') depth++;
        if (css[i] === '}' && --depth === 0) {
            chunks.push(css.slice(start, i + 1).trim());
            start = i + 1;
        }
        if (css[i] === ';' && depth === 0) {
            chunks.push(css.slice(start, i + 1).trim());
            start = i + 1;
        }
    }
    expect(depth).toBe(0);
    return chunks.filter(Boolean);
}

/** Every style rule sits inside the look's @scope: nothing can reach the admin. */
function expectAllScoped(css: string): void {
    for (const chunk of topLevel(css)) {
        if (chunk.startsWith(SCOPE) || /^@(font-face|keyframes|-webkit-keyframes|property|layer [\w.-]+(, ?[\w.-]+)*;)/.test(chunk)) continue;
        expect(chunk, 'a group rule holds only scoped or hoisted rules').toMatch(/^@(media|supports|layer|container)\b/);
        const inner = chunk.slice(chunk.indexOf('{') + 1, -1);
        expectAllScoped(inner);
    }
}

describe('bodyChain', () => {
    const shipped: Array<[string, string, string[]]> = [
        ['articles/detail.html', 'article-content', ['arc-cms-template', 'article-page', 'container', 'article-wrapper']],
        ['default/detail.html', 'article-content', ['arc-cms-template', 'article-detail', 'article-body', 'container']],
        ['info/detail.html', 'arc-page-body', ['arc-cms-template', 'arc-page', 'container']],
        ['info/detail-contact.html', 'arc-page-body', []],
        ['manuals/detail.html', 'docs-content', ['arc-cms-template', 'docs-page', 'container', 'docs-layout', 'docs-main']],
    ];

    it.each(shipped)('finds the body in %s', (path, bodyClass, outer) => {
        const chain = bodyChain(template(path), 'content');
        expect(chain).not.toBeNull();
        expect(chain!.body.classes).toEqual([bodyClass]);
        if (outer.length) {
            expect(chain!.ancestors.map((el) => el.classes[0])).toEqual(outer);
        }
    });

    it('rebuilds the tags and classes, without interpolation, skeletons or ids that are not ids', () => {
        const chain = bodyChain(
            `<style>p{}</style>
            <article class="page {{ theme }} wide" id="top">
                <div class="col arc-skeleton" id="{{ slug }}">
                    <section class="body" [innerHTML]="content"><p class="arc-skeleton">Loading</p></section>
                </div>
            </article>`,
            'content',
        );
        expect(chain).toEqual({
            ancestors: [
                { tag: 'article', classes: ['page', 'wide'], id: 'top' },
                { tag: 'div', classes: ['col'], id: null },
            ],
            body: { tag: 'section', classes: ['body'], id: null },
        });
    });

    it('turns links, buttons and custom elements around the body into plain divs', () => {
        const chain = bodyChain(
            `<arc-shell class="shell"><a class="card" href="/x"><button class="b"><div class="body" [innerHTML]="content"></div></button></a></arc-shell>`,
            'content',
        );
        expect(chain!.ancestors.map((el) => el.tag)).toEqual(['div', 'div', 'div']);
        expect(chain!.ancestors.map((el) => el.classes)).toEqual([['shell'], ['card'], ['b']]);
    });

    it('finds a rich text field by its key, and gives null for a field the template does not place', () => {
        const html = `<div class="page"><div class="body" [innerHTML]="content"></div><aside class="extra" [innerHTML]="sidebarNote"></aside></div>`;
        expect(bodyChain(html, 'sidebarNote')!.body).toEqual({ tag: 'aside', classes: ['extra'], id: null });
        expect(bodyChain(html, 'missing')).toBeNull();
        expect(bodyChain('<div>{{ content }}</div>', 'content')).toBeNull();
    });

    it('finds a field placed with data-arc-bind too, but not on an element that takes it as an attribute', () => {
        const html = `<a class="link" data-arc-bind="content"></a><img data-arc-bind="content"><time data-arc-bind="content"></time>`
            + `<div class="page"><div class="text" data-arc-bind="content"></div></div>`;
        expect(bodyChain(html, 'content')).toEqual({
            ancestors: [{ tag: 'div', classes: ['page'], id: null }],
            body: { tag: 'div', classes: ['text'], id: null },
        });
        expect(bodyChain('<a data-arc-bind="content"></a>', 'content')).toBeNull();
    });

    it('looks for a field under each of its names, taking the first place in the template', () => {
        const html = '<div class="a" [innerHTML]="agenda"></div><div class="b" [innerHTML]="events-agenda"></div>';
        expect(bodyChain(html, ['events-agenda', 'agenda'])!.body.classes).toEqual(['a']);
        expect(bodyChain(html, ['events-agenda'])!.body.classes).toEqual(['b']);
        expect(bodyChain(html, ['nothing', 'else'])).toBeNull();
    });

    it('uses the first place when a field is placed twice', () => {
        const chain = bodyChain(`<div class="one" [innerHTML]="content"></div><div class="two" [innerHTML]="content"></div>`, 'content');
        expect(chain!.body.classes).toEqual(['one']);
    });
});

describe('the shipped templates', () => {
    const folders = readdirSync(TEMPLATES);
    const details = folders.flatMap((folder) =>
        readdirSync(join(TEMPLATES, folder))
            .filter((file) => /^detail(-[\w-]+)?\.html$/.test(file))
            .map((file) => `${folder}/${file}`));

    it.each(details)('%s puts the body in exactly one place, so the editor can find it', (path) => {
        const bound = template(path).match(/\[innerHTML\]="content"/g) ?? [];
        expect(bound).toHaveLength(1);
    });

    it.each(details)('%s: its styles scope cleanly', (path) => {
        const css = templateStyles(template(path));
        expect(css).toContain('{');
        const scoped = scopeCss(css, { ...OPTIONS, baseUrl: '/articles/an-entry' });
        expectAllScoped(assembleSiteLook(OPTIONS, [scoped]));
    });

    it('main.css scopes cleanly, its body rule on the root and its @keyframes hoisted', () => {
        const scoped = scopeCss(MAIN_CSS, { ...OPTIONS, baseUrl: '/assets/css/main.css' });
        expect(scoped.hoisted.some((rule) => rule.startsWith('@keyframes pulse'))).toBe(true);
        const css = assembleSiteLook(OPTIONS, [scoped]);
        expectAllScoped(css);
        expect(css).toMatch(/:scope \{[^}]*font-family: -apple-system/);
        expect(css).toContain(':scope > footer');
        // The page frame stays on the page.
        expect(css).not.toMatch(/:scope \{[^}]*overflow-x/);
    });
});

describe('templateStyles', () => {
    it('joins every style block in order', () => {
        expect(templateStyles('<style>.a{}</style><div></div><style>.b{}</style>')).toBe('.a{}\n.b{}');
        expect(templateStyles('<div></div>')).toBe('');
    });
});

describe('rewriteSelector', () => {
    it.each([
        ['body', ':scope', true],
        ['html', ':scope', true],
        [':root', ':scope', true],
        ['HTML', ':scope', true],
        ['html body', ':scope', true],
        ['html > body', ':scope', true],
        ['body.dark', ':scope.dark', true],
        ['html[dir="rtl"] body', ':scope[dir="rtl"]', true],
        [':root[data-theme=dark]', ':scope[data-theme=dark]', true],
        ['body::before', ':scope::before', true],
        ['body > footer', ':scope > footer', false],
        ['body footer a', ':scope footer a', false],
        ['html[dir="rtl"] .x', ':scope[dir="rtl"] .x', false],
        ['html .x', ':scope .x', false],
        ['html + body', ':scope + body', false],
    ])('%s becomes %s', (input, output, rootOnly) => {
        expect(rewriteSelector(input)).toEqual({ selector: output, rootOnly });
    });

    it.each(['.body', 'bodyx', 'tbody td', '.x body', ':is(body, .x) p', ':where(html) a', '#body', 'p'])('leaves %s alone', (input) => {
        expect(rewriteSelector(input)).toEqual({ selector: input, rootOnly: false });
    });
});

describe('scopeCss', () => {
    const blocks = (css: string, baseUrl = OPTIONS.baseUrl) => scopeCss(css, { ...OPTIONS, baseUrl }).blocks.join('\n');

    it('wraps the style rules in @scope, in order, one block for a run of rules', () => {
        const out = scopeCss('.a { color: red } .b > p { margin: 0 }', OPTIONS);
        expect(out.blocks).toEqual([`${SCOPE} {\n.a { color: red }\n.b > p { margin: 0 }\n}`]);
        expect(out.hoisted).toEqual([]);
    });

    it('works without a limit', () => {
        expect(scopeCss('.a{}', { scope: '.r', baseUrl: '/' }).blocks[0]).toMatch(/^@scope \(\.r\) \{/);
    });

    it('splits a selector list between the root and the rest, keeping each rule whole', () => {
        expect(blocks('html, body, .page { color: #111; margin: 0 }')).toBe(
            `${SCOPE} {\n:scope, :scope { color: #111 }\n.page { color: #111; margin: 0 }\n}`,
        );
    });

    it('drops the page frame from root rules, and keeps the rest of them', () => {
        const out = blocks('body { margin: 0; padding-top: 70px; overflow-x: hidden; font-family: Georgia, serif; background: url(data:image/png;base64,AA==) }');
        expect(out).toContain(':scope { font-family: Georgia, serif; background: url(data:image/png;base64,AA==) }');
        expect(out).not.toMatch(/margin|padding|overflow/);
    });

    it('keeps text properties that only start like frame ones', () => {
        const out = blocks('body { overflow-wrap: break-word; overflow-x: hidden; margin-inline: auto; transform-origin: top; text-indent: 1em; border-width: 1px; line-height: 1.6 }');
        expect(out).toContain(':scope { overflow-wrap: break-word; text-indent: 1em; border-width: 1px; line-height: 1.6 }');
    });

    it('keeps a root rule with nested rules whole', () => {
        expect(blocks('body { margin: 0; & .x { color: red } }')).toContain(':scope { margin: 0; & .x { color: red } }');
    });

    it('scopes rules inside @media, @supports, @container and @layer blocks, keeping the order', () => {
        const out = blocks('.a{color:red} @media (max-width: 768px) { body { font-size: 15px } .a { color: blue } } .b{} @supports (display: grid) { @layer base { .c{} } }');
        const media = out.indexOf('@media (max-width: 768px) {');
        expect(out.indexOf('.a { color:red }')).toBeLessThan(media);
        expect(out.indexOf('.b {}')).toBeGreaterThan(media);
        expect(out).toContain(`@media (max-width: 768px) {\n${SCOPE} {\n:scope { font-size: 15px }\n.a { color: blue }\n}\n}`);
        expect(out).toContain(`@supports (display: grid) {\n@layer base {\n${SCOPE} {\n.c {}\n}\n}\n}`);
        expect(blocks('@container card (min-width: 400px) { .t { gap: 1rem } }')).toContain(`@container card (min-width: 400px) {\n${SCOPE}`);
    });

    it('hoists the rules @scope cannot hold, and layer order statements', () => {
        const out = scopeCss(
            '@layer reset, base; @font-face { font-family: Site; src: url(../fonts/site.woff2) } .a{} @keyframes spin { to { transform: rotate(1turn) } } @property --x { syntax: "<length>"; inherits: false; initial-value: 0px }',
            OPTIONS,
        );
        expect(out.hoisted).toEqual([
            '@layer reset, base;',
            '@font-face { font-family: Site; src: url("/assets/fonts/site.woff2") }',
            '@keyframes spin { to { transform: rotate(1turn) } }',
            '@property --x { syntax: "<length>"; inherits: false; initial-value: 0px }',
        ]);
        expect(out.blocks).toEqual([`${SCOPE} {\n.a {}\n}`]);
    });

    it('keeps a hoistable rule inside a group in place, outside the scope', () => {
        expect(blocks('@media print { @font-face { font-family: P } .a{} }')).toBe(`@media print {\n@font-face { font-family: P }\n${SCOPE} {\n.a {}\n}\n}`);
    });

    it('returns @imports for the caller, resolved, and does not leave them in', () => {
        const out = scopeCss(
            '@charset "utf-8"; @import url("parts/type.css") screen; @import \'https://fonts.example/css?family=A\'; @import "/x.css" layer(base); .a{}',
            { ...OPTIONS, baseUrl: '/assets/css/site.css?v=abc' },
        );
        expect(out.imports).toEqual([
            { url: '/assets/css/parts/type.css', condition: 'screen' },
            { url: 'https://fonts.example/css?family=A', condition: '' },
            { url: '/x.css', condition: 'layer(base)' },
        ]);
        expect([...out.hoisted, ...out.blocks].join('\n')).not.toMatch(/@import|@charset/);
    });

    it('nests the site\'s own @scope inside the look\'s', () => {
        expect(blocks('@scope (.card) to (.inner) { img { border: 0 } }')).toBe(`${SCOPE} {\n@scope (.card) to (.inner) { img { border: 0 } }\n}`);
    });

    it('leaves out at-rules that are not about the body, so they cannot reach the admin', () => {
        const out = scopeCss('@page { margin: 2cm } @namespace svg url(http://www.w3.org/2000/svg); @-moz-document url-prefix() { .a{} } .b{}', OPTIONS);
        expect([...out.hoisted, ...out.blocks].join('\n')).toBe(`${SCOPE} {\n.b {}\n}`);
    });

    it('is not confused by braces, commas and semicolons in strings, comments and brackets', () => {
        const out = blocks('/* .x { } */ .a::before { content: "}{;," } [data-x="a,b"], .c { quotes: "«" "»" } /* body {} */');
        expect(out).toBe(`${SCOPE} {\n.a::before { content: "}{;," }\n[data-x="a,b"], .c { quotes: "«" "»" }\n}`);
    });

    it('keeps !important and custom properties', () => {
        expect(blocks(':root { --brand: #e33 !important } .a { color: var(--brand) !important }'))
            .toBe(`${SCOPE} {\n:scope { --brand: #e33 !important }\n.a { color: var(--brand) !important }\n}`);
    });

    it('skips stray braces and rules with no block', () => {
        expect(blocks('} .a{} .b; .c{color:red')).toBe(`${SCOPE} {\n.a {}\n.c { color:red }\n}`);
    });

    it('gives nothing for an empty sheet', () => {
        expect(scopeCss('  /* nothing */ ', OPTIONS)).toEqual({ hoisted: [], blocks: [], imports: [] });
    });
});

describe('resolveUrls', () => {
    it.each([
        ['url(img/a.png)', '/assets/css/site.css', 'url("/assets/css/img/a.png")'],
        ['url("../fonts/a.woff2")', '/assets/css/site.css?v=1', 'url("/assets/fonts/a.woff2")'],
        ["url('b.svg#icon')", '/assets/css/site.css', 'url("/assets/css/b.svg#icon")'],
        ['url( c.png )', '/articles/an-entry', 'url("/articles/c.png")'],
        ['url(/root.png)', '/assets/css/site.css', 'url(/root.png)'],
        ['url(//cdn.example/a.png)', '/assets/css/site.css', 'url(//cdn.example/a.png)'],
        ['url(https://cdn.example/a.png)', '/assets/css/site.css', 'url(https://cdn.example/a.png)'],
        ['url(data:image/svg+xml;utf8,<svg/>)', '/assets/css/site.css', 'url(data:image/svg+xml;utf8,<svg/>)'],
        ['url(#grad)', '/assets/css/site.css', 'url(#grad)'],
        ['url()', '/assets/css/site.css', 'url()'],
    ])('%s from %s is %s', (input, base, output) => {
        expect(resolveUrls(`background: ${input}`, base)).toBe(`background: ${output}`);
    });
});

describe('assembleSiteLook', () => {
    it('puts every hoisted rule first, then the root defaults, then the rules in sheet order', () => {
        const main = scopeCss('@keyframes a {} body { color: #111 }', { ...OPTIONS, baseUrl: '/assets/css/main.css' });
        const site = scopeCss('@font-face { font-family: S } body { color: #222 }', OPTIONS);
        const css = assembleSiteLook(OPTIONS, [main, site]);
        const order = ['@keyframes a', '@font-face', 'var(--bs-body-font-family)', 'color: #111', 'color: #222'].map((part) => css.indexOf(part));
        expect(order.every((at) => at >= 0)).toBe(true);
        expect([...order].sort((a, b) => a - b)).toEqual(order);
    });

    it('prefixes the sheets\' own keyframes and their uses, so the admin\'s animations of the same name are untouched', () => {
        const main = scopeCss('@keyframes pulse { to { opacity: .5 } } .dot { animation: pulse 2s infinite }', { ...OPTIONS, baseUrl: '/assets/css/main.css' });
        const site = scopeCss(
            '@-webkit-keyframes "spin" {} @media (prefers-reduced-motion: no-preference) { .a { -webkit-animation-name: spin; animation: 1s spin, pulse-ring 1s } } .b { animation-name: spinner-border; animation-duration: 1s }',
            OPTIONS,
        );
        const css = assembleSiteLook({ ...OPTIONS, keyframesPrefix: 'arc-site-look-1-' }, [main, site]);
        expect(css).toContain('@keyframes arc-site-look-1-pulse');
        expect(css).toContain('@-webkit-keyframes arc-site-look-1-spin');
        expect(css).toContain('animation: arc-site-look-1-pulse 2s infinite');
        expect(css).toContain('-webkit-animation-name: arc-site-look-1-spin');
        // Only names the sheets define: pulse-ring and Bootstrap's spinner-border are left alone.
        expect(css).toContain('animation: 1s arc-site-look-1-spin, pulse-ring 1s');
        expect(css).toContain('animation-name: spinner-border; animation-duration: 1s');
        // Without a prefix nothing is renamed.
        expect(assembleSiteLook(OPTIONS, [main])).toContain('@keyframes pulse');
    });

    it('gives the root Bootstrap\'s body defaults inside the scope', () => {
        expect(rootDefaults(OPTIONS)).toMatch(new RegExp(`^${SCOPE.replace(/[().]/g, '\\$&')} \\{\\n:scope \\{`));
        for (const variable of ['font-family', 'font-size', 'font-weight', 'line-height', 'color', 'text-align', 'bg']) {
            expect(rootDefaults(OPTIONS)).toContain(`var(--bs-body-${variable})`);
        }
    });
});

describe('underImportCondition', () => {
    const sheet = () => scopeCss('@font-face { font-family: F } .a { color: red }', OPTIONS);

    it.each([
        ['', [`${SCOPE} {\n.a { color: red }\n}`]],
        ['screen and (min-width: 40em)', [`@media screen and (min-width: 40em) {\n${SCOPE} {\n.a { color: red }\n}\n}`]],
        ['layer(base)', [`@layer base {\n${SCOPE} {\n.a { color: red }\n}\n}`]],
        ['layer', [`@layer {\n${SCOPE} {\n.a { color: red }\n}\n}`]],
        ['supports(display: grid) print', [`@supports (display: grid) {\n@media print {\n${SCOPE} {\n.a { color: red }\n}\n}\n}`]],
        ['layer(x.y) supports(selector(:has(a)))', [`@layer x.y {\n@supports (selector(:has(a))) {\n${SCOPE} {\n.a { color: red }\n}\n}\n}`]],
    ])('puts an import with condition "%s" under it', (condition, blocks) => {
        const out = underImportCondition(sheet(), condition);
        expect(out.blocks).toEqual(blocks);
        // Hoisted rules stay global, as an imported @font-face is.
        expect(out.hoisted).toEqual(['@font-face { font-family: F }']);
    });

    it('leaves an empty sheet empty', () => {
        expect(underImportCondition(scopeCss('', OPTIONS), 'print').blocks).toEqual([]);
    });
});

describe('ADMIN_BOOTSTRAP_VARIABLES', () => {
    it('lists every Bootstrap variable the admin sets on its own elements, so the look gives each its page value', () => {
        const theme = readFileSync(join(__dirname, '../../../admin-theme.css'), 'utf8');
        const block = theme.match(/:is\(\.arc-admin, \.arc-onboarding, \.arc-admin-overlay\) \{([^}]*)\}/)![1];
        const set = [...block.matchAll(/(--bs-[\w-]+)\s*:/g)].map((m) => m[1]);
        expect(set.length).toBeGreaterThan(0);
        expect([...ADMIN_BOOTSTRAP_VARIABLES].sort()).toEqual([...set].sort());
    });

    it('puts the page values on the look\'s root, ignoring empty or unsafe ones', () => {
        const css = rootDefaults({ ...OPTIONS, rootVariables: { '--bs-primary': ' #0d6efd ', '--bs-link-color': '', '--x': 'red; } body { color: red', 'color': 'red' } });
        expect(css).toContain('--bs-primary: #0d6efd;');
        expect(css).not.toContain('--bs-link-color');
        expect(css).not.toContain('body { color: red');
        expect(css).not.toMatch(/^color: red/m);
    });
});
