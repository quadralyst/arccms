import { describe, expect, it } from 'vitest';
import { actsForRecipient, emailHasRecipientLinks, emailPreviewDocument, RECIPIENT_LINK_TITLE } from './email-preview';

describe('emailPreviewDocument', () => {
    it('opens a link in a new tab, with no way back to the frame, so the email stays', () => {
        expect(emailPreviewDocument('<p><a href="/admin/reports">Open</a></p>'))
            .toBe('<base target="_blank"><p><a href="/admin/reports" target="_blank" rel="noopener noreferrer">Open</a></p>');
    });

    it('overrides a link that asks to stay in the frame, or for its opener', () => {
        const doc = emailPreviewDocument(`<a href='/x' target='_self' rel=opener>x</a><a target="_top" href=/y>y</a>`);
        expect(doc).toContain(`<a href='/x' target="_blank" rel="noopener noreferrer">x</a>`);
        expect(doc).toContain('<a href=/y target="_blank" rel="noopener noreferrer">y</a>');
        expect(doc).not.toMatch(/_self|_top|rel=opener/);
    });

    it('takes the address off the unsubscribe and preference links, keeps their look, and says why', () => {
        const doc = emailPreviewDocument(
            '<a style="color:#2563eb" href="https://site.example/unsubscribe?e=ab12&t=cd34">Unsubscribe</a> · '
            + '<a href="https://site.example/email-preferences?e=ab12&amp;t=cd34" target="_blank">Preferences</a>',
        );
        const look = 'color:LinkText;text-decoration:underline;cursor:not-allowed;';
        // Its own colour comes after, so it still wins.
        expect(doc).toContain(`<a style="${look}color:#2563eb" aria-disabled="true" title="${RECIPIENT_LINK_TITLE}">Unsubscribe</a>`);
        expect(doc).toContain(`<a aria-disabled="true" title="${RECIPIENT_LINK_TITLE}" style="${look}">Preferences</a>`);
        // No address at all: not even "#", which in a srcdoc frame is the admin page's own and loads the app there.
        expect(doc).not.toMatch(/href="#"|t=cd34|target="_self"/);
    });

    it('goes in the head of a full document, and never before a doctype', () => {
        expect(emailPreviewDocument('<!DOCTYPE html><html><head><title>x</title></head></html>'))
            .toBe('<!DOCTYPE html><html><head><base target="_blank"><title>x</title></head></html>');
        expect(emailPreviewDocument('<!doctype html><p>x</p>')).toBe('<!doctype html><base target="_blank"><p>x</p>');
        expect(emailPreviewDocument('<header>x</header>')).toBe('<base target="_blank"><header>x</header>');
    });

    it('takes the address off a link to a spot in the email, or to a script or data URL', () => {
        // In a srcdoc frame "#top" is the admin page's own address; a script URL would run in the new tab.
        for (const href of ['#top', '#', 'javascript:alert(1)', ' JavaScript:alert(1)', 'data:text/html,x', 'vbscript:x']) {
            const doc = emailPreviewDocument(`<a href="${href}">x</a>`);
            expect(doc, href).not.toContain('href=');
            expect(doc, href).toContain('aria-disabled="true"');
            expect(doc, href).not.toContain(RECIPIENT_LINK_TITLE);
        }
    });

    it('keeps a link\'s own title', () => {
        expect(emailPreviewDocument('<a title="Our shop" href="/shop">Shop</a>')).toContain('<a title="Our shop" href="/shop" target="_blank" rel="noopener noreferrer">');
    });

    it('leaves an anchor without an address alone', () => {
        expect(emailPreviewDocument('<a name="top"></a>')).toBe('<base target="_blank"><a name="top"></a>');
    });
});

describe('actsForRecipient', () => {
    it('knows Arc CMS\'s unsubscribe and preference links, sent or still a tag, under a language too', () => {
        for (const href of ['https://site.example/unsubscribe?e=1&t=2', '/email-preferences?e=1&t=2', '/de/unsubscribe',
            '##UNSUBSCRIBE_LINK##', '##PREFERENCES_LINK##', 'https://site.example/unsubscribe#x']) {
            expect(actsForRecipient(href), href).toBe(true);
        }
    });

    it('lets every other link open, also one that only mentions unsubscribe', () => {
        for (const href of ['/admin/reports', 'https://site.example/blog/how-to-unsubscribe', 'https://site.example/?next=/unsubscribe',
            'mailto:help@site.example', 'https://site.example/unsubscribe-tips']) {
            expect(actsForRecipient(href), href).toBe(false);
        }
    });
});

describe('emailHasRecipientLinks', () => {
    it('finds an unsubscribe or preference link, and nothing else', () => {
        expect(emailHasRecipientLinks('<a href="##UNSUBSCRIBE_LINK##">Unsubscribe</a>')).toBe(true);
        expect(emailHasRecipientLinks('<a href="/admin/reports">Open</a><a name="top"></a>')).toBe(false);
    });
});
