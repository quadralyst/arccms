/**
 * The admin's colours (src/admin-theme.css, docs/app/admin-look.html,
 * specs/admin-brand-spec.md AB1): an app sets a few variables, and every admin and
 * setup wizard style reads them. These checks keep that true.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(__dirname, '../..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');

/** Every file under a folder, from the repo root. */
function filesUnder(folder: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) walk(path);
            else out.push(relative(ROOT, path).split('\\').join('/'));
        }
    };
    walk(join(ROOT, folder));
    return out;
}

// Arc CMS's blues, and the other brand blues the admin's styles used to write
// (Bootstrap's primary and its tints, and a few more), as hex and as rgba.
const ARC_BLUES = new RegExp(
    '#(3c76f5|1d47a3|2654bd|24c6dc|1b429a|2a5fd8|163a8a|14808f|2c5ed2' +
        '|0d6efd|0b5ed7|0a58ca|86b7fe|cfe2ff|e7f1ff|e7f3ff|cce5ff|b6d9ff|e9f2ff|eef4ff|f0f7ff' +
        '|3b82f6|93c5fd|bfdbfe|dbeafe|e0f2fe|1e40af|4a6cf7|2196f3|1976d2|e3f2fd|0066cc|0056b3|004085' +
        '|4f46e5|eef2ff|e0e7ff|5c6bc0|283593|e8eaf6|1b98e0|dce8ff|dceeff|bae1ff)\\b' +
        '|rgba?\\(\\s*(60,\\s*118,\\s*245|29,\\s*71,\\s*163|38,\\s*84,\\s*189|36,\\s*198,\\s*220|27,\\s*66,\\s*154|13,\\s*110,\\s*253|20,\\s*128,\\s*143|44,\\s*94,\\s*210)\\b',
    'i',
);

// Where the admin and the setup wizard are styled.
const ADMIN_FOLDERS = ['src/app/pages/admin', 'src/shared', 'src/app/pages/(onboarding)', 'src/app/pages/(auth)/(profile)'];

// Not the admin's own styling (spec, out of scope): stored colour choices and palettes an
// admin picks from, email designs, examples in messages, and the shared parts of the
// public site and the sign-in page, which have their own colours.
const NOT_ADMIN_STYLING = [
    'src/app/pages/admin/(settings)/message/global-message.model.ts',
    'src/app/pages/admin/(contact-tags)/(tag-drawer)/tag-drawer.component.ts',
    'src/app/pages/admin/contents/bulk-import/bulk-import.service.ts',
    'src/app/pages/(onboarding)/onboarding-defaults.ts',
    'src/shared/constants/common-constants.ts',
    'src/shared/email-compiler/email-design.model.ts',
    'src/shared/utils/color.ts',
    'src/shared/components/search-box/search-box.component.ts',
    'src/shared/components/search-results/search-results.component.ts',
    'src/shared/components/phone-country/phone-country.component.ts',
    'src/shared/components/code-input/code-input.component.ts',
    'src/shared/components/country-picker/country-picker.component.ts',
];

describe('the admin\'s colours', () => {
    it('defines every variable on :root with Arc CMS\'s blues as the defaults', () => {
        const css = read('src/admin-theme.css');
        const root = css.match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? '';
        expect(root).toContain('--arc-admin-accent: #3c76f5;');
        expect(root).toContain('--arc-admin-accent-dark: #1d47a3;');
        for (const name of [
            'gradient', 'button-background', 'button-hover-background', 'panel-background',
            'panel-color', 'menu-active-background', 'menu-hover-background',
        ]) {
            expect(root, `--arc-admin-${name}`).toContain(`--arc-admin-${name}:`);
        }
    });

    it('loads the variables with the global styles, before the app\'s own', () => {
        expect(read('src/styles.css')).toContain('@import "./admin-theme.css";');
        const html = read('index.html');
        expect(html.indexOf('/src/styles.css')).toBeLessThan(html.indexOf('/src/custom/styles.css'));
    });

    it('recognises the blues it looks for', () => {
        for (const blue of ['#3c76f5', '#1D47A3', '#0d6efd', 'rgba(60, 118, 245, 0.2)', 'rgba(13,110,253,.5)']) {
            expect(ARC_BLUES.test(blue), blue).toBe(true);
        }
        expect(ARC_BLUES.test('var(--arc-admin-accent)')).toBe(false);
    });

    it('writes none of Arc CMS\'s blues anywhere in the admin or the setup wizard', () => {
        const files = [
            'src/styles.css',
            ...ADMIN_FOLDERS.flatMap(filesUnder).filter((f) => /\.(s?css|ts|html)$/.test(f) && !f.endsWith('.spec.ts')),
        ].filter((f) => !NOT_ADMIN_STYLING.includes(f));
        const offenders = files.flatMap((file) =>
            read(file)
                .split('\n')
                .map((line, i) => (ARC_BLUES.test(line) ? `${file}:${i + 1}: ${line.trim()}` : ''))
                .filter(Boolean),
        );
        expect(offenders).toEqual([]);
    });

    it('keeps the side panel\'s words at 4.5:1 or more on Arc CMS\'s own panel', () => {
        // Every point of the panel mixes its gradient's stops, and a mix is never lighter than
        // its lightest stop, so the stops bound the whole panel. The menu once read at 2.5:1.
        const lin = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
        const lum = ([r, g, b]: number[]) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        const ratio = (a: number[], b: number[]) => {
            const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
            return (hi + 0.05) / (lo + 0.05);
        };
        const white = [255, 255, 255];

        const root = read('src/admin-theme.css').match(/:root \{([\s\S]*?)\n\}/)?.[1] ?? '';
        const panel = root.match(/--arc-admin-panel-background:([^;]*);/)?.[1] ?? '';
        const stops = [...panel.matchAll(/#([0-9a-f]{6})\b/gi)].map((m) => [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16)));
        expect(stops.length).toBeGreaterThanOrEqual(5);
        for (const stop of stops) {
            const name = '#' + stop.map((v) => v.toString(16).padStart(2, '0')).join('');
            expect(ratio(white, stop), `menu words on ${name}`).toBeGreaterThanOrEqual(4.5);
        }
        // The current item and the one under the pointer: a shade, which only adds contrast.
        expect(root).toContain('--arc-admin-menu-active-background: rgba(0, 0, 0, 0.2);');

        const nav = read('src/shared/components/side-navbar/side-navbar.component.scss');
        // Every word at the panel's own colour: a dimmed one fell below 4.5:1.
        expect(nav).toMatch(/\.nav-link \{\s*color: var\(--arc-admin-panel-color\);/);
        expect(nav).toMatch(/\.app-version \{[^}]*\n\s*color: var\(--arc-admin-panel-color\);/);
        // Drawn at full strength: at 95% the page's white showed through and lightened it.
        expect(nav.match(/\.sidebar::before \{[^}]*\}/)?.[0]).not.toContain('opacity');
    });

    it('colours the side panel, its items and the main buttons from the variables', () => {
        const nav = read('src/shared/components/side-navbar/side-navbar.component.scss');
        expect(nav).toMatch(/\.sidebar::before \{[^}]*background: var\(--arc-admin-panel-background\);/);
        expect(nav).toMatch(/\.nav-link:hover \{[^}]*background: var\(--arc-admin-menu-hover-background\);/);
        expect(nav).toMatch(/\.nav-link\.active \{[^}]*background: var\(--arc-admin-menu-active-background\);/);
        expect(nav).toMatch(/\.active-menu \{[^}]*background: var\(--arc-admin-menu-active-background\);/);
        // The panel's logo takes the app's filter, none unless it sets one.
        expect(nav).toMatch(/\.logo \{[^}]*filter: var\(--arc-admin-panel-logo-filter, none\);/);

        const styles = read('src/styles.css');
        expect(styles).toMatch(/\.arc-onboarding \.btn-primary \{\s*background: var\(--arc-admin-button-background\) !important;/);
        expect(styles).toMatch(/\.arc-onboarding \.btn-primary:hover \{[^}]*background: var\(--arc-admin-button-hover-background\) !important;/);
    });

    it('turns each Material token the theme colours indigo or pink to the accent, on the same elements only', () => {
        const COLOURED = /#3f51b5|#ff4081|#7986cb|#f06292|rgba\((63, 81, 181|255, 64, 129)/i;
        const SCOPE = ':is(.arc-admin, .arc-onboarding, .arc-admin-overlay)';
        /** Each selector of a stylesheet, with the custom properties it sets. */
        const rulesOf = (css: string) => {
            const rules = new Map<string, Map<string, string>>();
            for (const [, selectors, body] of css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
                if (selectors.trim().startsWith('@')) continue;
                for (const selector of selectors.split(/,(?![^(]*\))/).map((x) => x.trim().replace(/\s+/g, ' '))) {
                    const tokens = rules.get(selector) ?? new Map<string, string>();
                    for (const decl of body.split(';')) {
                        const [name, value] = decl.split(/:(.*)/s).map((p) => p?.trim());
                        if (name?.startsWith('--mat-')) tokens.set(name, value ?? '');
                    }
                    rules.set(selector, tokens);
                }
            }
            return rules;
        };
        const theme = rulesOf(readFileSync(join(ROOT, 'node_modules/@angular/material/prebuilt-themes/indigo-pink.css'), 'utf8'));
        const ours = rulesOf(read('src/admin-theme.css'));

        const missing: string[] = [];
        let coloured = 0;
        for (const [selector, tokens] of theme) {
            for (const [name, value] of tokens) {
                if (!COLOURED.test(value)) continue;
                coloured++;
                const scoped = selector === 'html' ? SCOPE : `${SCOPE} ${selector}`;
                if (!/var\(--arc-admin-accent\)/.test(ours.get(scoped)?.get(name) ?? '')) missing.push(`${scoped} ${name}`);
            }
        }
        expect(coloured).toBeGreaterThan(200);
        expect(missing).toEqual([]);

        // And nothing more: every token we set, the theme sets on that element in indigo or pink.
        const extra: string[] = [];
        for (const [selector, tokens] of ours) {
            if (!selector.startsWith(SCOPE)) continue;
            const original = selector === SCOPE ? 'html' : selector.slice(SCOPE.length + 1);
            for (const name of tokens.keys()) {
                if (!COLOURED.test(theme.get(original)?.get(name) ?? '')) extra.push(`${selector} ${name}`);
            }
        }
        expect(extra).toEqual([]);
    });

    it('colours the dialog layer only while the admin or the setup wizard is open', () => {
        expect(read('src/admin-theme.css')).not.toContain('.cdk-overlay-container');
        expect(read('src/app/pages/admin.page.ts')).toContain('useAdminOverlay();');
        expect(read('src/app/pages/(onboarding)/onboarding.page.ts')).toContain('useAdminOverlay();');
    });
});

describe('the setup wizard', () => {
    it('shows the panel\'s column from the width the panel is drawn at, never as an empty half', () => {
        // Bootstrap's lg is 992px: the column (d-lg-block) and the panel (min-width: 992px) agree,
        // and below it the wizard takes the whole width.
        const html = read('src/app/pages/(onboarding)/onboarding.page.html');
        expect(html).toMatch(/class="col-lg-6 d-none d-lg-block[^"]*">\s*<div class="auth-container">/);
        expect(html).toContain('class="col-lg-6 wizard-right-panel"');
        expect(html).not.toMatch(/col-md-6/);
        expect(read('src/app/pages/(onboarding)/onboarding.page.scss')).toMatch(/@media \(min-width: 992px\) \{\s*\.auth-left \{\s*display: block;/);
    });

    it('draws its panel with the admin\'s panel background', () => {
        const wizard = read('src/app/pages/(onboarding)/onboarding.page.scss');
        expect(wizard).toContain('background: var(--arc-admin-panel-background);');
        // Its words at full strength on the panel, as the side panel's.
        expect(wizard.match(/\.auth-left-description \{[^}]*\}/)?.[0]).not.toContain('opacity');
    });
});
