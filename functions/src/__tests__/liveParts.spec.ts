/**
 * The live parts every published page gets (shared/live-parts.ts,
 * specs/site-sections-spec.md SS5): the notices on signup and contact forms,
 * contact forms only with the feature, and arc-site.js with its strings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { featureOn } = vi.hoisted(() => ({ featureOn: { contact: true } as Record<string, boolean> }));
vi.mock('../init', () => ({ db: {} }));
vi.mock('../feature-flags', () => ({ isFeatureOn: (id: string) => featureOn[id] !== false }));
const { siteFile } = vi.hoisted(() => ({ siteFile: vi.fn<(path: string) => Promise<string | null>>() }));
vi.mock('../shared/site-files.js', async (actual) => ({ ...(await actual<object>()), getSiteFile: siteFile }));

import { arcSiteScript, loadSiteNotices, noticePageUrl, prepareLiveParts, withLiveParts } from '../shared/live-parts.js';
import { loadHtml } from '../shared/lazy-cheerio.js';
import type { SiteManifest } from '../shared/site-files.js';

const MANIFEST = { version: 1, home: {}, templates: {}, pages: { 'privacy-policy': 'app' }, strings: [], files: {} } as SiteManifest;
const CONTACT = '<form data-arc-contact-form><input name="email"><textarea name="message"></textarea><button type="submit">Send</button></form>';

describe('live parts', () => {
    beforeEach(() => { featureOn['contact'] = true; });

    it('puts the privacy line above a contact form\'s button, linking the app\'s privacy page', () => {
        const $ = loadHtml(CONTACT, { xmlMode: false });
        prepareLiveParts($, {}, MANIFEST);
        const notice = $('form [data-contact-notice]');
        expect(notice.text()).toBe('We use your details only to reply. Privacy Policy');
        expect(notice.find('a').attr('href')).toBe('/p/privacy-policy');
        expect(notice.next().is('button')).toBe(true);
    });

    it('writes the line in the page\'s language, and plain text without the app\'s privacy page', () => {
        const $ = loadHtml(CONTACT, { xmlMode: false });
        prepareLiveParts($, { contact_notice: 'आपकी जानकारी सिर्फ़ जवाब देने के लिए। {privacy}', legal_privacy: 'गोपनीयता नीति' }, null);
        expect($('[data-contact-notice]').text()).toBe('आपकी जानकारी सिर्फ़ जवाब देने के लिए। गोपनीयता नीति');
        expect($('[data-contact-notice] a').length).toBe(0);
    });

    it('leaves a form that brings its own line', () => {
        const $ = loadHtml('<form data-arc-contact-form><p data-contact-notice>Mine</p><button>Go</button></form>', { xmlMode: false });
        prepareLiveParts($, {}, MANIFEST);
        expect($('[data-contact-notice]').text()).toBe('Mine');
    });

    it('removes contact forms when the app has no contact form feature, so no dead form shows', () => {
        featureOn['contact'] = false;
        const html = withLiveParts(`<main>${CONTACT}<p>Rest</p></main>`, {}, MANIFEST);
        expect(html).not.toContain('data-arc-contact-form');
        expect(html).toContain('Rest');
    });

    it('still gives signup forms their terms notice', () => {
        const html = withLiveParts('<form data-waitlist-form><input name="email"><button type="submit">Join</button></form>', {}, MANIFEST);
        expect(html).toContain('data-legal-notice');
    });

    // SS6: a published standard page wins over the app's static file.
    it('links the published standard page first, then the app\'s own page, else nothing', () => {
        const pages = [{ title: 'Privacy Policy', url: '/info/privacy-policy' }];
        expect(noticePageUrl('privacy-policy', MANIFEST, pages)).toBe('/info/privacy-policy');
        expect(noticePageUrl('privacy-policy', MANIFEST, [])).toBe('/p/privacy-policy');
        expect(noticePageUrl('terms', MANIFEST, pages)).toBe('');
        const $ = loadHtml(CONTACT, { xmlMode: false });
        prepareLiveParts($, {}, MANIFEST, pages);
        expect($('[data-contact-notice] a').attr('href')).toBe('/info/privacy-policy');
    });

    it('leaves a page without forms exactly as it was', () => {
        expect(withLiveParts('<p>Plain</p>', {}, MANIFEST)).toBe('<p>Plain</p>');
    });

    it('gives arc-site.js the signup and contact strings, and no others', () => {
        const $ = loadHtml(arcSiteScript('/assets/js/arc-site.js', '', { contact_sent: 'धन्यवाद', signup_on_list: 'सूची', read_more: 'और' }));
        expect(JSON.parse($('script').attr('data-strings')!)).toEqual({ contact_sent: 'धन्यवाद', signup_on_list: 'सूची' });
    });
});

describe('the app\'s own notices on a published page', () => {
    const SIGNUP = '<form data-waitlist-form><input name="email"><button type="submit">Go</button></form>';
    const NOTICES = {
        signup: {
            en: 'Join and accept {terms}.',
            de: 'Mit der Anmeldung akzeptierst du die [AGB]({terms}) der Acme GmbH. [Cookies](/p/cookies) <b>x</b> [weg](javascript:alert`1`)',
        },
        contact: { de: 'Nur für die Antwort. {privacy}' },
    };
    const WITH_FILE = { ...MANIFEST, files: { '_site/notices.json': 'abc' } } as SiteManifest;

    it('writes the German notice on a German page, its links drawn, its words escaped', () => {
        const html = withLiveParts(SIGNUP + CONTACT, {}, MANIFEST, [{ url: '/info/terms', title: 'Terms' }], { lang: 'de-CH', defaultLang: 'en', notices: NOTICES });
        const $ = loadHtml(html, { xmlMode: false });
        expect($('[data-legal-notice]').text()).toBe('Mit der Anmeldung akzeptierst du die AGB der Acme GmbH. Cookies <b>x</b> weg');
        expect($('[data-legal-notice] a').map((_, a) => $(a).attr('href')).get()).toEqual(['/info/terms', '/p/cookies']);
        expect($('[data-legal-notice] b').length).toBe(0);
        expect($('[data-contact-notice]').text()).toBe('Nur für die Antwort. Privacy Policy');
        expect($('[data-contact-notice] a').attr('href')).toBe('/p/privacy-policy');
    });

    it('falls back on the site\'s default language, then English, then Arc CMS\'s words', () => {
        const notice = (lang: string, defaultLang: string, notices: object = NOTICES) =>
            loadHtml(withLiveParts(SIGNUP, {}, MANIFEST, [], { lang, defaultLang, notices }), { xmlMode: false })('[data-legal-notice]').text();
        expect(notice('fr', 'de')).toContain('Acme GmbH');
        expect(notice('fr', 'ja')).toBe('Join and accept Terms of Service.');
        expect(notice('fr', 'ja', { signup: {}, contact: {} })).toBe('By signing up, you agree to our Terms of Service and Privacy Policy, and to receive emails from us.');
    });

    it('reads the notices the live site serves, and none from a site without them or with a broken file', async () => {
        const good = { signup: { de: 'Es gelten die [AGB]({terms}).' }, contact: {} };
        siteFile.mockResolvedValue(JSON.stringify(good));
        expect(await loadSiteNotices(WITH_FILE)).toEqual(good);
        expect(siteFile).toHaveBeenCalledWith('notices.json');
        siteFile.mockClear();
        expect(await loadSiteNotices(MANIFEST)).toEqual({});
        expect(await loadSiteNotices(null)).toEqual({});
        expect(siteFile).not.toHaveBeenCalled();
        siteFile.mockResolvedValue('{ not json');
        expect(await loadSiteNotices(WITH_FILE)).toEqual({});
        // A file the build would have refused (a javascript: link, an unknown placeholder): none.
        siteFile.mockResolvedValue(JSON.stringify(NOTICES));
        expect(await loadSiteNotices(WITH_FILE)).toEqual({});
    });
});

