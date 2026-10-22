/**
 * The app's own notices (src/custom/notices.ts, docs/app/sign-up-notice.html) on the
 * forms of a website page the app draws: the page's language, the site's default
 * language, and the placeholders worded by the page's strings, as publishing does.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../features/features', () => ({ isOn: () => true }));
// This spec is about an app's own file, so it mocks the file (src/test/setup.ts gives core specs the empty one).
vi.mock('../../../custom/notices', () => ({
    CUSTOM_NOTICES: {
        signup: { de: 'Es gelten unsere {terms}.', fr: 'Voir nos [conditions]({terms}).' },
        contact: { de: 'Nur für die Antwort. {privacy}' },
    },
}));

import { attachLiveParts, prepareLiveParts } from './live-parts';

const FORMS = '<form data-waitlist-form><input name="email"><button type="submit">Go</button></form>'
    + '<form data-arc-contact-form><textarea name="message"></textarea><button type="submit">Send</button></form>';
const PAGES = [{ url: '/info/terms', title: 'Terms' }, { url: '/info/privacy-policy', title: 'Privacy' }];

function host(): HTMLElement {
    const div = document.createElement('div');
    div.innerHTML = FORMS;
    document.body.appendChild(div);
    return div;
}

describe('the app\'s own notices on a website page in the app', () => {
    beforeEach(() => {
        document.body.innerHTML = '';
        document.documentElement.lang = 'de-CH';
    });

    it('words {terms} and {privacy} from the page\'s strings, as publishing does', () => {
        const root = host();
        prepareLiveParts(root, document, PAGES, { legal_terms: 'AGB', legal_privacy: 'Datenschutz' });
        const signup = root.querySelector('[data-legal-notice]')!;
        expect(signup.textContent).toBe('Es gelten unsere AGB.');
        expect(signup.querySelector('a')!.getAttribute('href')).toBe('/info/terms');
        expect(root.querySelector('[data-contact-notice]')!.textContent).toBe('Nur für die Antwort. Datenschutz');
    });

    it('falls back on the site\'s default language it is given', () => {
        document.documentElement.lang = 'ta';
        const root = host();
        prepareLiveParts(root, document, PAGES, {}, 'fr');
        expect(root.querySelector('[data-legal-notice]')!.textContent).toBe('Voir nos conditions.');
    });

    it('takes the strings through attachLiveParts too', () => {
        const root = host();
        attachLiveParts(root, document, PAGES, { legal_terms: 'AGB' });
        expect(root.querySelector('[data-legal-notice]')!.textContent).toBe('Es gelten unsere AGB.');
    });
});
