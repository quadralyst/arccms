import { describe, it, expect, afterEach, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
    APP_NOTICES, buildContactNoticeElement, buildLegalNoticeElement, contactNoticeParts, LEGAL_NOTICE, legalNoticeLang, legalNoticeParts,
    legalNoticeUrls, legalNoticeWithPages, signupNoticeParts,
} from './legal-notice';
import { setSiteManifestForTesting } from '../../app/core/site/site';
import { coreSiteManifest } from '../../test/core-site';
import { prepareLiveParts as publish } from '../../../functions/src/shared/live-parts';
import { loadHtml } from '../../../functions/src/shared/lazy-cheerio';
import type { SiteManifest } from '../../../functions/src/shared/site-files';
import type { SiteNotices } from '../utils/notice-text';

vi.mock('../../../functions/src/init', () => ({ db: {} }));
vi.mock('../../../functions/src/feature-flags', () => ({ isFeatureOn: () => true }));

// Arc CMS on its own: no terms or privacy page of the app's (an app's src/custom/site/ may have them).
const NO_APP_PAGES = { ...LEGAL_NOTICE, ...legalNoticeUrls(() => false) };

describe('legal notice', () => {
    afterEach(() => setSiteManifestForTesting());

    it('reads as plain text while no URLs are set', () => {
        const parts = legalNoticeParts('en', NO_APP_PAGES);
        expect(parts.map((p) => p.text).join('')).toBe(
            'By signing up, you agree to our Terms of Service and Privacy Policy, and to receive emails from us.',
        );
        expect(parts.some((p) => p.href)).toBe(false);
    });

    it('links the terms and privacy pages the app supplies, and only those', () => {
        expect(legalNoticeUrls(() => false)).toEqual({ termsUrl: '', privacyUrl: '' });
        expect(legalNoticeUrls((name) => name === 'terms')).toEqual({ termsUrl: '/p/terms', privacyUrl: '' });
        expect(legalNoticeUrls(() => true)).toEqual({ termsUrl: '/p/terms', privacyUrl: '/p/privacy-policy' });
    });

    it('never links Arc CMS\'s own sample policy', () => {
        // Arc CMS ships public/_site/pages/privacy-policy.html; only an app's own page is linked.
        setSiteManifestForTesting({ ...coreSiteManifest(), pages: { 'privacy-policy': 'core' } });
        expect(legalNoticeUrls().privacyUrl).toBe('');
        setSiteManifestForTesting({ ...coreSiteManifest(), pages: { 'privacy-policy': 'app' } });
        expect(legalNoticeUrls().privacyUrl).toBe('/p/privacy-policy');
    });

    it('links a label once its URL is set', () => {
        const parts = legalNoticeParts('en', { ...NO_APP_PAGES, termsUrl: '/terms' });
        expect(parts.find((p) => p.text === 'Terms of Service')?.href).toBe('/terms');
        expect(parts.find((p) => p.text === 'Privacy Policy')?.href).toBeUndefined();
    });

    it('speaks the page language, English otherwise', () => {
        expect(legalNoticeLang('hi')).toBe('hi');
        expect(legalNoticeLang('en-US')).toBe('en');
        expect(legalNoticeLang('fr')).toBe('en');
        expect(legalNoticeLang('')).toBe('en');
        expect(legalNoticeParts('hi').map((p) => p.text).join('')).toContain('सेवा की शर्तें');
    });

    it('builds the element without innerHTML, marked so it is added only once', () => {
        const el = buildLegalNoticeElement(document, 'en', NO_APP_PAGES);
        expect(el.hasAttribute('data-legal-notice')).toBe(true);
        expect(el.textContent).toContain('Privacy Policy');
        expect(el.querySelector('a')).toBeNull();
    });

    // SS6: the published standard pages first.
    it('links the published standard pages over the app\'s static ones', () => {
        const notice = legalNoticeWithPages([{ url: '/info/privacy-policy' }], { ...LEGAL_NOTICE, termsUrl: '/p/terms', privacyUrl: '' });
        expect(notice.termsUrl).toBe('/p/terms');
        expect(notice.privacyUrl).toBe('/info/privacy-policy');
        const p = buildContactNoticeElement(document, 'en', notice);
        expect(p.querySelector('a')!.getAttribute('href')).toBe('/info/privacy-policy');
        expect(p.textContent).toBe('We use your details only to reply. Privacy Policy');
    });
});

/** An app's own notices (src/custom/notices.ts, docs/app/sign-up-notice.html). */
const APP: SiteNotices = {
    signup: {
        en: 'By signing up you accept the {terms} of Acme Ltd and its [Privacy Policy]({privacy}). [Cookies](/p/cookies).',
        de: 'Mit der Anmeldung akzeptierst du die [AGB]({terms}) und den [Datenschutz](https://acme.example/datenschutz) der Acme GmbH.',
        fr: 'En vous inscrivant, vous acceptez nos [conditions]({terms}).',
    },
    contact: { de: 'Wir nutzen deine Angaben nur für die Antwort. [Datenschutz]({privacy})' },
};
const WITH_PAGES = { ...LEGAL_NOTICE, termsUrl: '/info/terms', privacyUrl: '/info/privacy-policy' };
const text = (parts: { text: string }[]) => parts.map((p) => p.text).join('');
const links = (el: Element) => Array.from(el.querySelectorAll('a')).map((a) => [a.textContent, a.getAttribute('href')]);

describe('the app\'s own notice', () => {
    it('ships empty, so Arc CMS\'s own notice shows exactly as before', () => {
        expect(APP_NOTICES).toEqual({});
        for (const lang of ['en', 'hi', 'de', 'en-US']) {
            expect(signupNoticeParts(lang, WITH_PAGES)).toEqual(legalNoticeParts(legalNoticeLang(lang), WITH_PAGES));
        }
        expect(text(contactNoticeParts('hi', WITH_PAGES))).toBe('हम आपकी जानकारी सिर्फ़ जवाब देने के लिए इस्तेमाल करते हैं। गोपनीयता नीति');
    });

    it('shows the app\'s German notice on a German page, with its links', () => {
        const el = buildLegalNoticeElement(document, 'de', WITH_PAGES, { notices: APP });
        expect(el.textContent).toBe('Mit der Anmeldung akzeptierst du die AGB und den Datenschutz der Acme GmbH.');
        expect(links(el)).toEqual([['AGB', '/info/terms'], ['Datenschutz', 'https://acme.example/datenschutz']]);
        expect(el.innerHTML).not.toContain('[');
    });

    it('finds de for de-CH, then the site\'s default language, then English', () => {
        expect(text(signupNoticeParts('de-CH', WITH_PAGES, { notices: APP }))).toContain('Acme GmbH');
        expect(text(signupNoticeParts('ta', WITH_PAGES, { notices: APP, defaultLang: 'fr' }))).toBe('En vous inscrivant, vous acceptez nos conditions.');
        expect(text(signupNoticeParts('ta', WITH_PAGES, { notices: APP, defaultLang: 'ja' })))
            .toBe('By signing up you accept the Terms of Service of Acme Ltd and its Privacy Policy. Cookies.');
        // No text in any of them: Arc CMS's own, in the page's language.
        expect(signupNoticeParts('hi', WITH_PAGES, { notices: { signup: { de: 'DE' } } })).toEqual(legalNoticeParts('hi', WITH_PAGES));
    });

    it('keeps the {terms} and {privacy} placeholders, labelled in the page\'s language and linking the site\'s pages', () => {
        const parts = signupNoticeParts('hi', WITH_PAGES, { notices: { signup: { hi: '{terms} और {privacy} देखें।' } } });
        expect(parts).toEqual([
            { text: 'सेवा की शर्तें', href: '/info/terms' },
            { text: ' और ' },
            { text: 'गोपनीयता नीति', href: '/info/privacy-policy' },
            { text: ' देखें।' },
        ]);
        // No page: the words, not a link.
        expect(signupNoticeParts('en', { ...WITH_PAGES, termsUrl: '' }, { notices: APP }).find((p) => p.text === 'Terms of Service')?.href).toBeUndefined();
    });

    it('shows a javascript: link as text', () => {
        const el = buildLegalNoticeElement(document, 'en', WITH_PAGES, { notices: { signup: { en: 'Read the [terms](javascript:alert`x`).' } } });
        expect(el.textContent).toBe('Read the terms.');
        expect(el.querySelector('a')).toBeNull();
    });

    it('gives the contact form its line from the same file', () => {
        const el = buildContactNoticeElement(document, 'de-AT', WITH_PAGES, { notices: APP });
        expect(el.textContent).toBe('Wir nutzen deine Angaben nur für die Antwort. Datenschutz');
        expect(links(el)).toEqual([['Datenschutz', '/info/privacy-policy']]);
        // The app has no English contact line: Arc CMS's.
        expect(buildContactNoticeElement(document, 'en', WITH_PAGES, { notices: APP }).textContent).toBe('We use your details only to reply. Privacy Policy');
    });

    it('says the same words, with the same links, on a published page and in the app', () => {
        const manifest = { version: 1, home: {}, templates: {}, pages: {}, strings: [], files: {} } as SiteManifest;
        const pages = [{ url: '/info/terms' }, { url: '/info/privacy-policy' }];
        const form = '<form data-waitlist-form><input name="email"><button type="submit">Go</button></form>'
            + '<form data-arc-contact-form><textarea name="message"></textarea><button type="submit">Send</button></form>';
        for (const [lang, defaultLang] of [['de', 'en'], ['de-CH', 'en'], ['ta', 'fr'], ['ja', 'ja'], ['hi', 'en']]) {
            const $ = loadHtml(form, { xmlMode: false });
            // Publishing words the labels from the page's strings file, as the site serves it.
            const strings = lang === 'hi' ? JSON.parse(readFileSync(join(__dirname, '../../../public/_site/strings/hi.json'), 'utf8')) : {};
            publish($, strings, manifest, pages, { lang, defaultLang, notices: APP });
            const notice = legalNoticeWithPages(pages);
            const inApp = [
                buildLegalNoticeElement(document, lang, notice, { notices: APP, defaultLang }),
                buildContactNoticeElement(document, lang, notice, { notices: APP, defaultLang }),
            ];
            const published = ['[data-legal-notice]', '[data-contact-notice]'].map((sel) => {
                const div = document.createElement('div');
                div.innerHTML = $.html($(sel));
                return div.firstElementChild!;
            });
            for (const i of [0, 1]) {
                expect(published[i].textContent, `${lang} ${i}`).toBe(inApp[i].textContent);
                expect(links(published[i]), `${lang} ${i}`).toEqual(links(inApp[i]));
                // The same look, each value a variable the app can set (docs/app/sign-up-notice.html#style-it).
                expect(published[i].getAttribute('style'), `${lang} ${i}`).toBe(inApp[i].getAttribute('style'));
                expect(inApp[i].getAttribute('style')).toContain('var(--arc-notice-font-size, 0.8rem)');
                const linkStyles = (el: Element) => Array.from(el.querySelectorAll('a')).map((a) => a.getAttribute('style'));
                expect(linkStyles(published[i])).toEqual(linkStyles(inApp[i]));
            }
        }
    });
});

