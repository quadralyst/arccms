/**
 * The live parts in the app's previews (specs/site-sections-spec.md, SS5):
 * the same notices publishing adds, contact forms only with the feature, and
 * arc-site.js only for a page with forms.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { on } = vi.hoisted(() => ({ on: { contact: true } as Record<string, boolean> }));
vi.mock('../features/features', () => ({ isOn: (id: string) => on[id] !== false }));

import { attachLiveParts, prepareLiveParts } from './live-parts';

const CONTACT = '<form data-arc-contact-form><input name="email"><textarea name="message"></textarea><button type="submit">Send</button></form>';
const SIGNUP = '<form data-waitlist-form><input name="email"><button type="submit">Join</button></form>';

function host(html: string): HTMLElement {
    const div = document.createElement('div');
    div.innerHTML = html;
    document.body.appendChild(div);
    return div;
}

describe('live parts in the app', () => {
    beforeEach(() => {
        on['contact'] = true;
        document.body.innerHTML = '';
        document.documentElement.lang = 'en';
    });

    it('puts the privacy line above a contact form\'s button and the terms notice on a signup form', () => {
        const root = host(CONTACT + SIGNUP);
        expect(prepareLiveParts(root, document)).toBe(true);
        const notice = root.querySelector('[data-arc-contact-form] [data-contact-notice]')!;
        expect(notice.textContent).toContain('We use your details only to reply.');
        expect(notice.nextElementSibling!.tagName).toBe('BUTTON');
        expect(root.querySelector('[data-waitlist-form] [data-legal-notice]')).not.toBeNull();
    });

    it('writes the line in the page\'s language', () => {
        document.documentElement.lang = 'hi';
        const root = host(CONTACT);
        prepareLiveParts(root, document);
        expect(root.querySelector('[data-contact-notice]')!.textContent).toContain('जवाब देने');
    });

    it('removes contact forms when the app has no contact form feature', () => {
        on['contact'] = false;
        const root = host(`${CONTACT}<p>Rest</p>`);
        expect(prepareLiveParts(root, document)).toBe(false);
        expect(root.querySelector('form')).toBeNull();
        expect(root.textContent).toContain('Rest');
    });

    it('adds arc-site.js only for a page with forms', () => {
        expect(attachLiveParts(host('<p>No forms</p>'), document)).toBeNull();
        const script = attachLiveParts(host(CONTACT), document)!;
        expect(script.getAttribute('src')).toMatch(/^\/assets\/js\/arc-site\.js/);
        expect(script.getAttribute('data-functions')).toMatch(/^https:\/\/.+cloudfunctions\.net$/);
        expect(document.body.contains(script)).toBe(true);
    });
});
