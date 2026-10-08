/**
 * The sign-in page is the site's, not Arc CMS's: its brand panel is the site's
 * own HTML, its name and logo come from Settings, About, and its colours from
 * the site's stylesheet.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { panelLanguage } from './sign-in-panel.component';

// Arc CMS's own panel, not the app's (src/custom/site/sign-in.html may replace it).
const signIn = readFileSync(resolve(__dirname, '../../../../public/_site/sign-in.html'), 'utf8');

const page = (file: string) => readFileSync(resolve(__dirname, '../(auth)/(signup)', file), 'utf8');

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

    it('shows the panel\'s column from the width the panel is drawn at, never as an empty half', () => {
        // Bootstrap's lg is 992px: the column (d-lg-block) and the panel (min-width: 992px) agree,
        // and below it the form column takes the whole width, centred.
        const html = page('signup.page.html');
        expect(html).toMatch(/class="col-lg-6 d-none d-lg-block[^"]*">[\s\S]{0,200}<div class="auth-container">/);
        expect(html).toContain('class="col-lg-6 auth-form-column"');
        expect(html).not.toMatch(/col-md-6/);
        expect(page('signup.page.scss')).toMatch(/@media \(min-width: 992px\) \{[^}]*?\.auth-left \{\s*display: block;/);
    });

    it('fills the whole brand panel with the app\'s image when it has one, in place of the panel\'s text', () => {
        const html = page('signup.page.html');
        expect(html).toMatch(/@if \(signInImage\) \{\s*<!--[^>]*-->\s*<img class="auth-left-image" \[src\]="signInImage" alt="">\s*\} @else \{[\s\S]{0,120}<arc-sign-in-panel>/);
        expect(page('signup.page.scss')).toMatch(/\.auth-left-image \{[^}]*inset: 0;[^}]*object-fit: cover;/);
        expect(page('signup.page.ts')).toContain('readonly signInImage = SIGN_IN_IMAGE;');
    });

    it('switches the site\'s stylesheet on', () => {
        expect(page('signup.page.ts')).toContain("useSiteStyles(['site'])");
    });

    it('ships a neutral brand panel, translatable, that never advertises Arc CMS', () => {
        expect(signIn).toContain('data-arc-t="sign_in_title"');
        expect(signIn).not.toMatch(/Arc CMS|waitlist|founder/i);
    });
});
