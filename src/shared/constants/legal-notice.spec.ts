import { describe, it, expect } from 'vitest';
import { buildLegalNoticeElement, LEGAL_NOTICE, legalNoticeLang, legalNoticeParts } from './legal-notice';

describe('legal notice', () => {
    it('reads as plain text while no URLs are set', () => {
        const parts = legalNoticeParts('en');
        expect(parts.map((p) => p.text).join('')).toBe(
            'By signing up, you agree to our Terms of Service and Privacy Policy, and to receive emails from us.',
        );
        expect(parts.some((p) => p.href)).toBe(false);
    });

    it('links a label once its URL is set', () => {
        const parts = legalNoticeParts('en', { ...LEGAL_NOTICE, termsUrl: '/terms' });
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
        const el = buildLegalNoticeElement(document, 'en');
        expect(el.hasAttribute('data-legal-notice')).toBe(true);
        expect(el.textContent).toContain('Privacy Policy');
        expect(el.querySelector('a')).toBeNull();
    });
});
