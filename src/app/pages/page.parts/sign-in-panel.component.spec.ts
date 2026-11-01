/**
 * The sign-in page is the site's, not Arc CMS's: its brand panel is the site's
 * own HTML, its name and logo come from Settings, About, and its colours from
 * the site's stylesheet.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { compile } from 'sass';
import { resolve } from 'node:path';
import { panelLanguage } from './sign-in-panel.component';

// Arc CMS's own panel, not the app's (src/custom/site/sign-in.html may replace it).
const signIn = readFileSync(resolve(__dirname, '../../../../public/_site/sign-in.html'), 'utf8');

const page = (file: string) => readFileSync(resolve(__dirname, '../(auth)/(signup)', file), 'utf8');
const shared = (file: string) => readFileSync(resolve(__dirname, '../../../shared/components', file), 'utf8');
const docs = readFileSync(resolve(__dirname, '../../../../docs/website/sign-in-page.html'), 'utf8');

// The parts of the sign-in page that read the --arc-sign-in-* variables: the page and
// the shared pieces it shows (the code boxes, the phone country chip, the language
// picker and the legal notice).
const styles = {
    page: page('signup.page.scss'),
    codeBoxes: shared('code-input/code-input.component.ts'),
    phoneCountry: shared('phone-country/phone-country.component.ts'),
    languagePicker: shared('member-language-picker/member-language-picker.component.ts'),
    legalNotice: shared('legal-notice/legal-notice.component.ts'),
};
const allStyles = Object.values(styles).join('\n');

// Every variable a site can set, for docs/website/sign-in-page.html.
const VARIABLES = [
    // The first six, from before the page could be restyled whole.
    'panel-background', 'panel-color', 'button-background', 'button-hover-background', 'accent', 'font',
    'page-background', 'text-color', 'panel', 'logo', 'logo-height',
    'name-size', 'name-weight', 'name-letter-spacing', 'name-transform', 'name-color', 'name-align',
    'card-background', 'card-radius', 'card-shadow', 'card-max-width', 'gutter',
    'title-color', 'title-align', 'muted-color', 'label-color',
    'field-background', 'field-border', 'field-focus-border', 'field-radius', 'field-height', 'field-color',
    'field-shadow', 'field-focus-shadow', 'field-icons',
    'button-color', 'button-radius', 'button-height', 'button-shadow',
    'secondary-background', 'secondary-color', 'secondary-border',
    'link-color', 'language-background', 'language-border', 'language-color',
].map((name) => `--arc-sign-in-${name}`);

describe('panelLanguage', () => {
    it('shows the panel as written for English, and through the site strings for another member language', () => {
        expect(panelLanguage('en')).toBe('');
        expect(panelLanguage('de')).toBe('de');
        expect(panelLanguage('hi')).toBe('hi');
    });
});

describe('the sign-in page', () => {
    it('shows the site\'s brand panel and names, with no Arc CMS text of its own', () => {
        const html = page('signup.page.html');
        expect(html).toContain('<arc-sign-in-panel></arc-sign-in-panel>');
        expect(html).not.toMatch(/>\s*Arc CMS\s*</);
        expect(html).not.toContain('Your Landing Page, Supercharged');
        expect(html).not.toContain('APPLICATION_NAME');
    });

    it('takes its panel, button and accent colours and its font from the site\'s stylesheet', () => {
        const scss = page('signup.page.scss');
        for (const name of ['--arc-sign-in-panel-background', '--arc-sign-in-panel-color', '--arc-sign-in-button-background',
            '--arc-sign-in-button-hover-background', '--arc-sign-in-accent', '--arc-sign-in-font']) {
            expect(scss).toContain(`var(${name}`);
        }
    });

    it('reads every sign-in variable, and the docs list each one', () => {
        for (const name of VARIABLES) {
            expect(allStyles, name).toContain(`var(${name},`);
            expect(docs, name).toContain(`<code>${name}</code>`);
        }
        // Nothing the styles read is missing from the list (and so from the docs).
        const read = new Set([...allStyles.matchAll(/var\((--arc-sign-in-[a-z-]+)/g)].map((m) => m[1]));
        expect([...read].filter((name) => !VARIABLES.includes(name))).toEqual([]);
    });

    it('looks as before for a site that sets none: every variable falls back to Arc CMS\'s own look', () => {
        for (const [part, source] of Object.entries(styles)) {
            const bare = [...source.matchAll(/var\((--arc-sign-in-[a-z-]+)\)/g)].map((m) => m[1]);
            expect(bare, part).toEqual([]);
        }
        expect(styles.page).toContain('border-radius: var(--arc-sign-in-card-radius, 10px);');
        expect(styles.page).toContain('color: var(--arc-sign-in-title-color, rgba(var(--bs-primary-rgb), 1));');
        expect(styles.page).toContain('font-size: var(--arc-sign-in-name-size, 1.5rem);');
        expect(styles.page).toContain('min-height: var(--arc-sign-in-logo-height, 60px);');
    });

    it('gives the code boxes, the phone country chip and the language picker the page\'s field and chip variables', () => {
        for (const name of ['field-background', 'field-border', 'field-focus-border', 'field-radius', 'field-height',
            'field-color', 'field-shadow', 'field-focus-shadow']) {
            expect(styles.codeBoxes).toContain(`var(--arc-sign-in-${name},`);
        }
        for (const name of ['field-background', 'field-border', 'field-radius', 'field-color']) {
            expect(styles.phoneCountry).toContain(`var(--arc-sign-in-${name},`);
        }
        for (const name of ['language-background', 'language-border', 'language-color']) {
            expect(styles.languagePicker).toContain(`var(--arc-sign-in-${name},`);
        }
    });

    it('keeps Bootstrap\'s !important colour and alignment classes off the parts the variables style', () => {
        // .text-primary, .text-dark, .text-center and .d-inline-block would beat the variables on some steps.
        const html = page('signup.page.html');
        expect(html).not.toMatch(/\btext-primary\b|\btext-dark\b|\bd-inline-block\b|\bd-lg-block\b/);
        for (const [, classes] of html.matchAll(/class="([^"]*)"/g)) {
            if (/title|card-body|auth-logo|verification-message|subtitle/.test(classes)) expect(classes).not.toContain('text-center');
        }
        expect(html.match(/<div class="auth-logo">/g)).toHaveLength(html.match(/<div class="auth-form-container">/g)!.length);
    });

    it('shows the site\'s name above the card on every step, and in place of the tile when a site hides it', () => {
        const html = page('signup.page.html');
        // Every brand block has the name line; beside a tile it is there for --arc-sign-in-logo: none.
        const blocks = html.split('<div class="auth-logo">').slice(1);
        expect(blocks).toHaveLength(10);
        for (const block of blocks) {
            expect(block).toMatch(/^[\s\S]{0,600}?<div class="auth-logo-line">\s*<h2 class="auth-logo-text"[^>]*>\{\{ brandName\(\) \}\}<\/h2>/);
        }
        expect(html.match(/\[class\.auth-logo-text-by-tile\]="!!brandLogo\(\)"/g)).toHaveLength(3);
        // The name is read in place of the tile, so the tile has no alt of its own.
        expect(html.match(/<img class="auth-logo-image" \[src\]="brandLogo\(\)" alt="">/g)).toHaveLength(3);
        // A fixed string in the stylesheet (the old --arc-sign-in-logo-text) is gone: the name is the site's.
        expect(allStyles + docs).not.toContain('--arc-sign-in-logo-text');
        // The tile hides with --arc-sign-in-logo: none, which also lifts the name's no-height limit beside it.
        expect(styles.page).toMatch(/\.auth-logo img \{\s*display: var\(--arc-sign-in-logo, inline-block\);/);
        expect(styles.page).toMatch(/\.auth-logo-text-by-tile \{\s*max-height: var\(--arc-sign-in-logo, 0\);\s*overflow: hidden;/);
        expect(styles.page).not.toMatch(/\.auth-logo-text \{[^}]*display:/);
    });

    it('lines a name aligned left up with the card\'s words, and keeps a centred one where it was', () => {
        const css = compile(resolve(__dirname, '../(auth)/(signup)/signup.page.scss')).css;
        const block = (selector: string) => css.match(new RegExp(`(^|\\n)${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\{([^}]*)\\}`))?.[2] ?? '';
        // The track is the card's width less its padding, centred like the card; the form column is the cqi container.
        expect(block('.auth-form-column')).toContain('container-type: inline-size');
        const line = block('.auth-logo-line');
        expect(line).toContain('--sign-in-card-width: min(var(--arc-sign-in-card-max-width, 500px), 100cqi - 2 * var(--arc-sign-in-gutter, 20px))');
        expect(line).toContain('grid-template-columns: calc(var(--sign-in-card-width) - 2 * var(--sign-in-card-inset))');
        expect(line).toContain('justify-content: unsafe center');
        // The name may be wider than the track; centred it overflows both sides and wraps at the old room.
        const name = block('.auth-logo-text');
        expect(name).toContain('justify-self: unsafe var(--arc-sign-in-name-align, center)');
        expect(name).toContain('width: max-content');
        expect(name).toContain('max-width: var(--sign-in-line-width)');
        expect(name).toContain('margin: 0');
        // The card's padding plus its body's: 1rem below 992px, 40px (customPadding) from it.
        expect(css).toMatch(/@media \(min-width: 992px\) \{[\s\S]*?\.auth-logo-line \{\s*--sign-in-card-inset: 50px;/);
    });

    it('shows the panel\'s column from the width the panel is drawn at, never as an empty half', () => {
        // Bootstrap's lg is 992px: the column and the panel (min-width: 992px) agree, and
        // below it, or with the panel switched off, the form column (.col) takes the whole width, centred.
        const html = page('signup.page.html');
        expect(html).toMatch(/class="col-lg-6 auth-panel-column[^"]*">[\s\S]{0,200}<div class="auth-container">/);
        expect(html).toContain('class="col auth-form-column"');
        expect(html).not.toMatch(/col-md-6/);
        const scss = page('signup.page.scss');
        expect(scss).toMatch(/\n\.auth-panel-column \{\s*display: none;\s*\}/);
        expect(scss).toMatch(/@media \(min-width: 992px\) \{\s*\.auth-panel-column \{\s*display: var\(--arc-sign-in-panel, block\);\s*\}[^}]*?\.auth-left \{\s*display: block;/);
    });

    it('fills the whole brand panel with the app\'s image when it has one, in place of the panel\'s text', () => {
        const html = page('signup.page.html');
        expect(html).toMatch(/@if \(signInImage\) \{\s*<!--[^>]*-->\s*<img class="auth-left-image" \[src\]="signInImage" alt="">\s*\} @else \{[\s\S]{0,120}<arc-sign-in-panel>/);
        expect(page('signup.page.scss')).toMatch(/\.auth-left-image \{[^}]*inset: 0;[^}]*object-fit: cover;/);
        expect(page('signup.page.ts')).toContain('readonly signInImage = SIGN_IN_IMAGE;');
    });

    it('switches the site\'s stylesheet on: its sign-in.css when it has one, else site.css', () => {
        expect(page('signup.page.ts')).toContain('useSiteStyles([signInSheet()])');
    });

    it('ships a neutral brand panel, translatable, that never advertises Arc CMS', () => {
        expect(signIn).toContain('data-arc-t="sign_in_title"');
        expect(signIn).not.toMatch(/Arc CMS|waitlist|founder/i);
    });
});
