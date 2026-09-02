/**
 * Tests for server-side translation merging (functions/src/shared/content-translation.ts).
 *
 * The publish pipeline renders pages from `mergeTranslation`, so its fallback
 * behaviour is what decides whether a half-finished translation deploys a
 * complete page or one with holes in it.
 *
 * Parity with the editor's mirrored implementation is asserted from the
 * frontend side, in content-translation.model.spec.ts — this file cannot
 * import across the boundary because the functions `tsc` build compiles its
 * own specs and does not see src/.
 */
import { describe, it, expect } from 'vitest';
import { mergeTranslation, TRANSLATABLE_BUILTIN_FIELDS } from '../shared/content-translation.js';

const base = {
    title: 'Hello world',
    content: '<p>English body</p>',
    summary: 'English summary',
    seoTitle: 'English SEO',
    metaDescription: 'English meta',
    urlSlug: 'hello-world',
    coverImage: '/cover.png',
    customFields: { author: 'Ada', readingLevel: 5, blurb: 'English blurb' },
};

describe('mergeTranslation (server)', () => {
    it('should return the base untouched when there is no translation', () => {
        expect(mergeTranslation(base, null)).toEqual(base);
        expect(mergeTranslation(base, undefined)).toEqual(base);
    });

    it('should overlay translated fields', () => {
        const merged = mergeTranslation(base, {
            lang: 'hi',
            title: 'नमस्ते दुनिया',
            content: '<p>हिन्दी सामग्री</p>',
        });

        expect(merged.title).toBe('नमस्ते दुनिया');
        expect(merged.content).toBe('<p>हिन्दी सामग्री</p>');
    });

    it('should fall back to the base for untranslated fields', () => {
        const merged = mergeTranslation(base, { lang: 'hi', title: 'नमस्ते' });

        expect(merged.summary).toBe('English summary');
        expect(merged.metaDescription).toBe('English meta');
    });

    it('should never touch language-independent fields', () => {
        const merged = mergeTranslation(base, { lang: 'hi', title: 'नमस्ते' });

        expect(merged.urlSlug).toBe('hello-world');
        expect(merged.coverImage).toBe('/cover.png');
    });

    it('should treat blank, whitespace and empty HTML as untranslated', () => {
        const merged = mergeTranslation(base, {
            lang: 'hi',
            title: '',
            summary: '   ',
            content: '<p></p>',
            seoTitle: '<p>&nbsp;</p>',
        });

        expect(merged.title).toBe('Hello world');
        expect(merged.summary).toBe('English summary');
        expect(merged.content).toBe('<p>English body</p>');
        expect(merged.seoTitle).toBe('English SEO');
    });

    it('should merge customFields key-by-key rather than replacing the bag', () => {
        const merged = mergeTranslation(base, {
            lang: 'hi',
            customFields: { blurb: 'हिन्दी सारांश' },
        });

        expect(merged.customFields).toEqual({
            author: 'Ada',
            readingLevel: 5,
            blurb: 'हिन्दी सारांश',
        });
    });

    it('should not mutate the base object', () => {
        const original = JSON.parse(JSON.stringify(base));
        mergeTranslation(base, { lang: 'hi', title: 'नमस्ते', customFields: { blurb: 'x' } });
        expect(base).toEqual(original);
    });

    it('should expose the same translatable field list as the editor', () => {
        expect([...TRANSLATABLE_BUILTIN_FIELDS]).toEqual([
            'title',
            'content',
            'summary',
            'seoTitle',
            'metaDescription',
        ]);
    });
});

