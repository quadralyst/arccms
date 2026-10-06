/**
 * The site's own details on its pages (specs/site-sections-spec.md, SS3): the
 * helpers, and the three appliers (the app's and publishing's applySiteInfo on
 * HTML strings, and the app's on live DOM) agreeing on the same page.
 */
import { describe, it, expect } from 'vitest';
import * as cheerio from 'cheerio';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { hasSiteInfo, mailHref, siteInfoValue, socialLinks, telHref, SiteInfoSource } from './site-info';
import * as published from '../../../functions/src/shared/site-info';
import { TemplateHydrationService as AppHydration } from '../../app/core/services/template-hydration.service';
import { TemplateHydrationService as PublishHydration } from '../../../functions/src/shared/template-hydration';
import { applySiteInfoToElement, applySiteInfoToHtml } from '../../app/core/site/apply-site-info-dom';

const ABOUT: SiteInfoSource = {
    name: 'Kumar & Sons <Studio>',
    description: 'Websites for small businesses.',
    contactEmail: 'hello@kumar.example',
    phone: '+91 98765 43210',
    address: '12 MG Road\nBengaluru 560001',
    logoUrl: 'https://kumar.example/logo.png',
    sameAs: ['https://www.instagram.com/kumarstudio', 'https://x.com/kumar', 'https://kumar.example/blog', 'not a url'],
};

const PAGE = `<footer>
<img data-arc-site="logo" class="logo">
<h2 data-arc-site="name">Name</h2>
<p data-arc-site="description"></p>
<a data-arc-site="email" href="#">email</a>
<p data-arc-site-if="phone">Call <a data-arc-site="phone">phone</a></p>
<address data-arc-site="address"></address>
<ul data-arc-site-loop="social"><li><a href="{{ url }}" aria-label="{{ label }}"><i class="{{ icon }}"></i> {{ platform }}</a></li></ul>
<p data-arc-site-if="social">Follow us</p>
</footer>`;

/** The body's markup as the browser serializes it, so the three outputs compare fairly. */
function serialize(html: string): string {
    const body = cheerio.load(html)('body').html() ?? html;
    const div = document.createElement('div');
    div.innerHTML = body;
    return div.innerHTML.replace(/\s+/g, ' ').trim();
}

function viaDom(html: string, source: SiteInfoSource): string {
    const div = document.createElement('div');
    div.innerHTML = html;
    applySiteInfoToElement(div, source);
    return div.innerHTML.replace(/\s+/g, ' ').trim();
}

describe('site info', () => {
    describe('helpers', () => {
        it('reads each value, and nothing for a key it does not know', () => {
            expect(siteInfoValue(ABOUT, 'email')).toBe('hello@kumar.example');
            expect(siteInfoValue(ABOUT, 'phone')).toBe('+91 98765 43210');
            expect(siteInfoValue(ABOUT, 'logo')).toBe('https://kumar.example/logo.png');
            expect(siteInfoValue(ABOUT, 'social')).toBe('');
            expect(siteInfoValue(ABOUT, 'password')).toBe('');
            expect(siteInfoValue(null, 'name')).toBe('');
            expect(hasSiteInfo(ABOUT, 'social')).toBe(true);
            expect(hasSiteInfo({ sameAs: ['nope'] }, 'social')).toBe(false);
            // SS6: any way to reach the site.
            expect(hasSiteInfo({ phone: '1' }, 'contact')).toBe(true);
            expect(hasSiteInfo({ sameAs: ['https://x.com/a'] }, 'contact')).toBe(true);
            expect(hasSiteInfo({ name: 'Only a name' }, 'contact')).toBe(false);
        });

        it('makes tel: and mailto: links', () => {
            expect(telHref('+91 98765 43210')).toBe('tel:+919876543210');
            expect(telHref('(080) 2345-6789')).toBe('tel:08023456789');
            expect(telHref('call us')).toBe('');
            expect(mailHref(' a@b.c ')).toBe('mailto:a@b.c');
            expect(mailHref('')).toBe('');
        });

        it('names social links from their address, in the order typed', () => {
            expect(socialLinks(ABOUT.sameAs)).toEqual([
                { url: 'https://www.instagram.com/kumarstudio', platform: 'instagram', label: 'Instagram', icon: 'fa-brands fa-instagram' },
                { url: 'https://x.com/kumar', platform: 'x', label: 'X', icon: 'fa-brands fa-x-twitter' },
                { url: 'https://kumar.example/blog', platform: 'link', label: 'kumar.example', icon: 'fa-solid fa-link' },
            ]);
            expect(socialLinks(['https://in.linkedin.com/in/asha', 'javascript:alert(1)'])).toEqual([
                { url: 'https://in.linkedin.com/in/asha', platform: 'linkedin', label: 'LinkedIn', icon: 'fa-brands fa-linkedin' },
            ]);
        });

        it('match the copy publishing uses', () => {
            expect(published.socialLinks(ABOUT.sameAs)).toEqual(socialLinks(ABOUT.sameAs));
            expect(published.telHref('+1 (555) 010-9999')).toBe(telHref('+1 (555) 010-9999'));
            for (const key of ['name', 'email', 'phone', 'address', 'logo', 'social']) {
                expect(published.siteInfoValue(ABOUT, key)).toBe(siteInfoValue(ABOUT, key));
                expect(published.hasSiteInfo(ABOUT, key)).toBe(hasSiteInfo(ABOUT, key));
            }
        });
    });

    describe('applying it to a page', () => {
        it('fills every value, link and social row, escaped', () => {
            const $ = cheerio.load(AppHydration.applySiteInfo(PAGE, ABOUT));
            expect($('img.logo').attr('src')).toBe('https://kumar.example/logo.png');
            expect($('img.logo').attr('alt')).toBe('Kumar & Sons <Studio>');
            expect($('h2').text()).toBe('Kumar & Sons <Studio>');
            expect($('a[href^="mailto:"]').text()).toBe('hello@kumar.example');
            expect($('a[href="tel:+919876543210"]').text()).toBe('+91 98765 43210');
            expect($('address').html()).toBe('12 MG Road<br>Bengaluru 560001');
            expect($('ul li').length).toBe(3);
            expect($('ul li a').first().attr('href')).toBe('https://www.instagram.com/kumarstudio');
            expect($('ul li a i').first().attr('class')).toBe('fa-brands fa-instagram');
            expect($('ul li').last().text().trim()).toBe('link');
            expect($.html()).not.toContain('data-arc-site');
            expect($.html()).not.toContain('{{');
        });

        it('removes what the site does not have', () => {
            const $ = cheerio.load(AppHydration.applySiteInfo(PAGE, { name: 'Solo' }));
            expect($('h2').text()).toBe('Solo');
            expect($('img').length).toBe(0);
            expect($('a').length).toBe(0);
            expect($('p').length).toBe(0); // description, the phone line and "Follow us"
            expect($('address').length).toBe(0);
            expect($('ul').children().length).toBe(0);
        });

        // SS6: the standard pages and the year, as the default footer uses them.
        it('lists the published standard pages and prints the year', () => {
            const html = '<ul data-arc-site-if="pages" data-arc-site-loop="pages"><li><a href="{{ url }}">{{ title }}</a></li></ul>'
                + '<p>&copy; <span data-arc-site="year"></span> <span data-arc-site="name"></span></p>';
            const source = { name: 'Kumar', year: 2027, pages: [{ title: 'About <us>', url: '/info/about' }, { title: 'Terms', url: '/info/terms' }, { title: '', url: '/info/x' }] };
            const $ = cheerio.load(AppHydration.applySiteInfo(html, source));
            expect($('li a').toArray().map((a) => [$(a).attr('href'), $(a).text()])).toEqual([['/info/about', 'About <us>'], ['/info/terms', 'Terms']]);
            expect($('p').text()).toBe('© 2027 Kumar');
            expect(serialize(PublishHydration.applySiteInfo(html, source))).toBe(serialize(AppHydration.applySiteInfo(html, source)));
            expect(viaDom(html, source)).toBe(serialize(AppHydration.applySiteInfo(html, source)));

            const none = cheerio.load(AppHydration.applySiteInfo(html, { name: 'Kumar' }));
            expect(none('ul').length).toBe(0);
            expect(none('p').text()).toBe(`© ${new Date().getFullYear()} Kumar`);
        });

        it('gives Arc CMS\'s default footer the site\'s pages and name, and nothing of Arc CMS\'s own', () => {
            const footer = readFileSync(join(__dirname, '../../../public/_site/footer.html'), 'utf8');
            expect(footer).not.toMatch(/Coming Soon|GitHub|Documentation|Community/);
            const $ = cheerio.load(AppHydration.applySiteInfo(footer, { name: 'Kumar', year: 2026, pages: [{ title: 'Privacy Policy', url: '/info/privacy-policy' }] }));
            expect($('.footer-pages a').attr('href')).toBe('/info/privacy-policy');
            expect($('.footer-copyright').text().replace(/\s+/g, ' ').trim()).toBe('© 2026 Kumar');
        });

        it('leaves a page that does not ask exactly as it was', () => {
            const html = '<p>Plain {{ title }}</p>';
            expect(AppHydration.applySiteInfo(html, ABOUT)).toBe(html);
            expect(PublishHydration.applySiteInfo(html, ABOUT)).toBe(html);
            expect(applySiteInfoToHtml(html, ABOUT)).toBe(html);
        });

        it('fills a whole static page given as text, keeping its head', () => {
            const page = '<!doctype html><html><head><title>Terms</title></head><body><p data-arc-site="email">x</p></body></html>';
            const out = applySiteInfoToHtml(page, ABOUT);
            expect(out).toContain('<title>Terms</title>');
            expect(out).toContain('<p>hello@kumar.example</p>');
        });

        it.each([
            ['every value', ABOUT],
            ['almost nothing', { name: 'Solo', sameAs: ['https://github.com/solo'] }],
        ])('gives the same page in the app, when published and on live DOM: %s', (_label, source) => {
            const app = serialize(AppHydration.applySiteInfo(PAGE, source));
            expect(serialize(PublishHydration.applySiteInfo(PAGE, source))).toBe(app);
            expect(viaDom(PAGE, source)).toBe(app);
        });
    });
});
