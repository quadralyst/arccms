/**
 * The sign-in page is the site's, not Arc CMS's: its brand panel is the site's
 * own HTML, its name and logo come from Settings, About, and its colours from
 * the site's stylesheet.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ARC_CMS_LOGO, signInBrand } from './sign-in-panel.component';

// Arc CMS's own panel, not the app's (src/custom/site/sign-in.html may replace it).
const signIn = readFileSync(resolve(__dirname, '../../../../public/_site/sign-in.html'), 'utf8');

const page = (file: string) => readFileSync(resolve(__dirname, '../(auth)/(signup)', file), 'utf8');

describe('signInBrand', () => {
    it('uses the site\'s name and logo', () => {
        expect(signInBrand({ name: 'Deepakam', logoUrl: 'https://x.test/logo.svg' }, 'Arc CMS'))
            .toEqual({ name: 'Deepakam', logo: 'https://x.test/logo.svg' });
    });

    it('shows the site\'s name, not Arc CMS\'s logo, when the site has no logo', () => {
        expect(signInBrand({ name: 'Deepakam', logoUrl: '' }, 'Arc CMS')).toEqual({ name: 'Deepakam', logo: '' });
    });

    it('falls back to Arc CMS\'s name and logo on a site that has not named itself', () => {
        expect(signInBrand({ name: '  ', logoUrl: '' }, 'Arc CMS')).toEqual({ name: 'Arc CMS', logo: ARC_CMS_LOGO });
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

    it('switches the site\'s stylesheet on', () => {
        expect(page('signup.page.ts')).toContain("useSiteStyles(['site'])");
    });

    it('ships a neutral brand panel, translatable, that never advertises Arc CMS', () => {
        expect(signIn).toContain('data-arc-t="sign_in_title"');
        expect(signIn).not.toMatch(/Arc CMS|waitlist|founder/i);
    });
});
