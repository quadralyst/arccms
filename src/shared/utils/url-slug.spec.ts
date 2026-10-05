import { describe, expect, it } from 'vitest';
import { nextUrlSlug, toUrlSlug } from './url-slug';

describe('toUrlSlug', () => {
    it('makes lowercase words joined by single hyphens', () => {
        expect(toUrlSlug('  Pricing Guide: 2026 Edition! ')).toBe('pricing-guide-2026-edition');
        expect(toUrlSlug('Already-a_slug')).toBe('already-a-slug');
        expect(toUrlSlug('pricing-guide -1 ')).toBe('pricing-guide-1');
    });

    it('is empty for text with no letters it can use', () => {
        expect(toUrlSlug('!!!')).toBe('');
        expect(toUrlSlug(undefined)).toBe('');
    });
});

describe('nextUrlSlug', () => {
    it('numbers a taken slug, and counts up from a numbered one', () => {
        expect(nextUrlSlug('pricing-guide')).toBe('pricing-guide-2');
        expect(nextUrlSlug('pricing-guide-2')).toBe('pricing-guide-3');
        expect(nextUrlSlug('top-10')).toBe('top-11');
    });
});
