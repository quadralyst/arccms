/**
 * The live parts every published page gets (shared/live-parts.ts,
 * specs/site-sections-spec.md SS5): the notices on signup and contact forms,
 * contact forms only with the feature, and arc-site.js with its strings.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { featureOn } = vi.hoisted(() => ({ featureOn: { contact: true } as Record<string, boolean> }));
vi.mock('../init', () => ({ db: {} }));
vi.mock('../feature-flags', () => ({ isFeatureOn: (id: string) => featureOn[id] !== false }));

import { arcSiteScript, prepareLiveParts, withLiveParts } from '../shared/live-parts.js';
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

    it('leaves a page without forms exactly as it was', () => {
        expect(withLiveParts('<p>Plain</p>', {}, MANIFEST)).toBe('<p>Plain</p>');
    });

    it('gives arc-site.js the signup and contact strings, and no others', () => {
        const $ = loadHtml(arcSiteScript('/assets/js/arc-site.js', '', { contact_sent: 'धन्यवाद', signup_on_list: 'सूची', read_more: 'और' }));
        expect(JSON.parse($('script').attr('data-strings')!)).toEqual({ contact_sent: 'धन्यवाद', signup_on_list: 'सूची' });
    });
});
