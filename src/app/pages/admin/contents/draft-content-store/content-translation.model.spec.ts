/**
 * Tests for the content-translation helpers.
 *
 * The fallback semantics tested here are what let a half-finished translation
 * still render a complete page, so they are pinned down carefully.
 */
import { describe, it, expect } from 'vitest';
import {
    IContentTranslation,
    isTranslatableField,
    isTranslationEmpty,
    localizedPageTitle,
    mergeTranslation,
    pruneTranslation,
    TRANSLATABLE_BUILTIN_FIELDS,
} from './content-translation.model';
import { ContentTypeField } from '../content-types/content-types.model';
import {
    localizedPageTitle as localizedPageTitleServer,
    mergeTranslation as mergeTranslationServer,
    TRANSLATABLE_BUILTIN_FIELDS as SERVER_TRANSLATABLE_FIELDS,
} from '../../../../../../functions/src/shared/content-translation';

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

function field(partial: Partial<ContentTypeField>): ContentTypeField {
    return { key: 'k', label: 'L', type: 'text', required: false, order: 0, ...partial } as ContentTypeField;
}

describe('isTranslatableField', () => {
    it('accepts free-text field types', () => {
        expect(isTranslatableField(field({ type: 'text' }))).toBe(true);
        expect(isTranslatableField(field({ type: 'richtext' }))).toBe(true);
    });

    it('rejects language-independent field types', () => {
        for (const type of ['number', 'date', 'datetime', 'image', 'boolean'] as const) {
            expect(isTranslatableField(field({ type }))).toBe(false);
        }
    });

    it('rejects option fields, whose values are keys rather than prose', () => {
        for (const type of ['dropdown', 'checkbox', 'radio'] as const) {
            expect(isTranslatableField(field({ type }))).toBe(false);
        }
    });

    it('rejects collection references even when typed as text', () => {
        expect(isTranslatableField(field({ type: 'text', useCollectionRef: true }))).toBe(false);
    });
});

describe('mergeTranslation', () => {
    it('returns the base untouched when there is no translation', () => {
        expect(mergeTranslation(base, null)).toEqual(base);
        expect(mergeTranslation(base, undefined)).toEqual(base);
    });

    it('overlays translated fields', () => {
        const merged = mergeTranslation(base, {
            lang: 'hi',
            title: 'नमस्ते दुनिया',
            content: '<p>हिन्दी सामग्री</p>',
        });

        expect(merged.title).toBe('नमस्ते दुनिया');
        expect(merged.content).toBe('<p>हिन्दी सामग्री</p>');
    });

    it('falls back to the base for untranslated fields', () => {
        const merged = mergeTranslation(base, { lang: 'hi', title: 'नमस्ते' });

        expect(merged.summary).toBe('English summary');
        expect(merged.seoTitle).toBe('English SEO');
        expect(merged.metaDescription).toBe('English meta');
    });

    it('never touches language-independent fields', () => {
        const merged = mergeTranslation(base, { lang: 'hi', title: 'नमस्ते' });

        expect(merged.urlSlug).toBe('hello-world');
        expect(merged.coverImage).toBe('/cover.png');
    });

    it('treats blank, whitespace and empty HTML as untranslated', () => {
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

    it('merges customFields key-by-key rather than replacing the bag', () => {
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

    it('does not mutate the base object', () => {
        const original = JSON.parse(JSON.stringify(base));
        mergeTranslation(base, { lang: 'hi', title: 'नमस्ते', customFields: { blurb: 'x' } });
        expect(base).toEqual(original);
    });
});

describe('pruneTranslation', () => {
    it('drops blank fields so they fall back instead of persisting as overrides', () => {
        const pruned = pruneTranslation({
            lang: 'hi',
            title: 'नमस्ते',
            summary: '',
            content: '<p></p>',
            customFields: { blurb: 'सारांश', empty: '' },
        });

        expect(pruned).toEqual({
            lang: 'hi',
            title: 'नमस्ते',
            customFields: { blurb: 'सारांश' },
        });
    });

    it('keeps provenance metadata when present', () => {
        const at = new Date('2026-07-27T00:00:00Z');
        const pruned = pruneTranslation({
            lang: 'hi',
            title: 'नमस्ते',
            aiGenerated: true,
            translatedBy: 'user-1',
            translatedAt: at,
        });

        expect(pruned.aiGenerated).toBe(true);
        expect(pruned.translatedBy).toBe('user-1');
        expect(pruned.translatedAt).toBe(at);
    });

    it('omits an empty customFields bag entirely', () => {
        const pruned = pruneTranslation({ lang: 'hi', title: 'x', customFields: { a: '' } });
        expect(pruned.customFields).toBeUndefined();
    });
});

describe('isTranslationEmpty', () => {
    it('is true for a translation with nothing translated', () => {
        expect(isTranslationEmpty({ lang: 'hi' })).toBe(true);
        expect(isTranslationEmpty({ lang: 'hi', title: '   ', content: '<p></p>' })).toBe(true);
        expect(isTranslationEmpty({ lang: 'hi', customFields: { a: '' } })).toBe(true);
    });

    it('is false as soon as any field carries content', () => {
        expect(isTranslationEmpty({ lang: 'hi', title: 'नमस्ते' })).toBe(false);
        expect(isTranslationEmpty({ lang: 'hi', customFields: { blurb: 'x' } })).toBe(false);
    });

    it('ignores provenance-only metadata', () => {
        const translation: IContentTranslation = { lang: 'hi', aiGenerated: true, translatedBy: 'u' };
        expect(isTranslationEmpty(translation)).toBe(true);
    });
});

describe('TRANSLATABLE_BUILTIN_FIELDS', () => {
    it('covers exactly the prose fields of a content item', () => {
        expect([...TRANSLATABLE_BUILTIN_FIELDS]).toEqual([
            'title',
            'content',
            'summary',
            'seoTitle',
            'metaDescription',
        ]);
    });
});

/**
 * The server has a hand-mirrored copy of `mergeTranslation` (the publish
 * pipeline cannot import Angular code). Drift between them would mean the
 * editor previews something different from what gets deployed, so the two are
 * pinned together here.
 */
describe('parity with the server implementation', () => {
    const cases: (IContentTranslation | null)[] = [
        null,
        { lang: 'hi' },
        { lang: 'hi', title: 'नमस्ते' },
        { lang: 'hi', title: '', summary: '  ', content: '<p></p>' },
        { lang: 'hi', customFields: { blurb: 'सारांश', empty: '' } },
        { lang: 'hi', title: 'नमस्ते', customFields: { author: 'आदा' } },
        { lang: 'hi', seoTitle: 'SEO', metaDescription: 'meta', summary: 'सार' },
    ];

    it.each(cases)('merges identically to the server for %j', (translation) => {
        expect(mergeTranslation(base, translation)).toEqual(
            mergeTranslationServer(base, translation as never),
        );
    });

    it('agrees on the translatable field list', () => {
        expect([...TRANSLATABLE_BUILTIN_FIELDS]).toEqual([...SERVER_TRANSLATABLE_FIELDS]);
    });
});

describe('localizedPageTitle', () => {
    const base = { title: 'Test page version 0.1', seoTitle: 'test page' };

    it('prefers the translated SEO title', () => {
        const translation: IContentTranslation = { lang: 'hi', title: 'शीर्षक', seoTitle: 'एसईओ' };
        expect(localizedPageTitle(mergeTranslation(base, translation), translation)).toBe('एसईओ');
    });

    it('uses the translated title when the translator left the SEO title blank', () => {
        // The bug this exists for: `seoTitle || title` on the merged document
        // hands back the base language's seoTitle, so a fully translated page
        // was served with an English <title>.
        const translation: IContentTranslation = { lang: 'hi', title: 'शीर्षक' };
        expect(localizedPageTitle(mergeTranslation(base, translation), translation)).toBe('शीर्षक');
    });

    it('keeps seoTitle precedence within a single language', () => {
        expect(localizedPageTitle(base)).toBe('test page');
    });

    it('falls back to the base language when nothing is translated', () => {
        const translation: IContentTranslation = { lang: 'hi', summary: 'सार' };
        expect(localizedPageTitle(mergeTranslation(base, translation), translation)).toBe('test page');
    });

    it('returns an empty string when there is no title at all', () => {
        expect(localizedPageTitle({})).toBe('');
    });

    it('matches the server implementation', () => {
        const cases: (IContentTranslation | null)[] = [
            null,
            { lang: 'hi' },
            { lang: 'hi', title: 'शीर्षक' },
            { lang: 'hi', seoTitle: 'एसईओ' },
            { lang: 'hi', title: 'शीर्षक', seoTitle: 'एसईओ' },
        ];
        for (const translation of cases) {
            const merged = mergeTranslation(base, translation);
            expect(localizedPageTitle(merged, translation))
                .toBe(localizedPageTitleServer(merged, translation as never));
        }
    });
});
