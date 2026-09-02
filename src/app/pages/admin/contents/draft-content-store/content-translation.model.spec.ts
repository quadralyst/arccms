/**
 * Tests for the content-translation helpers.
 *
 * The fallback semantics tested here are what let a half-finished translation
 * still render a complete page, so they are pinned down carefully.
 */
import { describe, it, expect } from 'vitest';
import {
    IContentTranslation,
    TRANSLATABLE_BUILTIN_FIELDS,
    isTranslatableField,
    isTranslationEmpty,
    localizedPageTitle,
    mergeTranslation,
    pruneTranslation,
    translatableHeadingKey,
    translatableRepeaterKeys,
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

    describe('repeating fields', () => {
        const ICON = { set: 'fa', name: 'star', classes: 'fa-solid fa-star', label: 'Star' };

        const BASE_CARDS = [
            { id: 'r_a', position: 1, image: '', icon: ICON, headline: 'Find opportunities', info: 'Browse needs.' },
            { id: 'r_b', position: 2, image: 'https://example.com/c.jpg', icon: null, headline: 'Earn coins', info: 'Redeem them.' },
        ];

        function baseDoc(rows = BASE_CARDS) {
            return { title: 'Base', customFields: { events_info_cards: rows, events_details_heading: 'At a glance' } };
        }

        it('overlays translated prose onto the base rows', () => {
            const merged: any = mergeTranslation(baseDoc(), {
                lang: 'hi',
                customFields: {
                    events_info_cards: [
                        { id: 'r_a', headline: 'अवसर खोजें', info: 'ज़रूरतें देखें।' },
                    ],
                },
            });

            const rows = merged.customFields.events_info_cards;
            expect(rows[0].headline).toBe('अवसर खोजें');
            expect(rows[0].info).toBe('ज़रूरतें देखें।');
            // Untranslated row keeps the default language.
            expect(rows[1].headline).toBe('Earn coins');
        });

        it('never lets a translation change a row id or its order', () => {
            const merged: any = mergeTranslation(baseDoc(), {
                lang: 'hi',
                customFields: {
                    events_info_cards: [{ id: 'r_a', headline: 'अवसर', position: 99 }],
                },
            });

            const row = merged.customFields.events_info_cards[0];
            // Identity and order are what a wrong merge corrupts silently, so
            // they are refused here regardless of what the document says.
            // Which *other* keys a translation may carry is decided when it is
            // written — see `translatableCustomFields`, which projects a row
            // down to its id plus the prose.
            expect(row.id).toBe('r_a');
            expect(row.position).toBe(1);
            expect(row.headline).toBe('अवसर');
        });

        it('leaves media alone when the translation omits it, as the editor does', () => {
            const merged: any = mergeTranslation(baseDoc(), {
                lang: 'hi',
                customFields: { events_info_cards: [{ id: 'r_b', headline: 'सिक्के' }] },
            });

            expect(merged.customFields.events_info_cards[1].image).toBe('https://example.com/c.jpg');
            expect(merged.customFields.events_info_cards[0].icon).toEqual(ICON);
        });

        it('matches rows by id, not by index', () => {
            // The translation lists the second card first.
            const merged: any = mergeTranslation(baseDoc(), {
                lang: 'hi',
                customFields: {
                    events_info_cards: [
                        { id: 'r_b', headline: 'सिक्के कमाएँ' },
                        { id: 'r_a', headline: 'अवसर खोजें' },
                    ],
                },
            });

            const rows = merged.customFields.events_info_cards;
            expect(rows[0].headline).toBe('अवसर खोजें');
            expect(rows[1].headline).toBe('सिक्के कमाएँ');
        });

        it('ignores a translation for a row that has been deleted', () => {
            // Deleting the second card must not shift its Hindi text onto
            // another card — the failure an index-based merge would cause.
            const merged: any = mergeTranslation(baseDoc([BASE_CARDS[0]]), {
                lang: 'hi',
                customFields: {
                    events_info_cards: [
                        { id: 'r_a', headline: 'अवसर खोजें' },
                        { id: 'r_gone', headline: 'हटाया गया' },
                    ],
                },
            });

            const rows = merged.customFields.events_info_cards;
            expect(rows).toHaveLength(1);
            expect(rows[0].headline).toBe('अवसर खोजें');
            expect(JSON.stringify(rows)).not.toContain('हटाया गया');
        });

        it('renders a row added after translating in the default language', () => {
            const withExtra = [...BASE_CARDS, { id: 'r_c', position: 3, image: '', icon: null, headline: 'Get recognised', info: 'Badges.' }];
            const merged: any = mergeTranslation(baseDoc(withExtra), {
                lang: 'hi',
                customFields: { events_info_cards: [{ id: 'r_a', headline: 'अवसर खोजें' }] },
            });

            expect(merged.customFields.events_info_cards).toHaveLength(3);
            expect(merged.customFields.events_info_cards[2].headline).toBe('Get recognised');
        });

        it('keeps the base text where the translation left a blank', () => {
            const merged: any = mergeTranslation(baseDoc(), {
                lang: 'hi',
                customFields: { events_info_cards: [{ id: 'r_a', headline: '', info: '   ' }] },
            });

            const row = merged.customFields.events_info_cards[0];
            expect(row.headline).toBe('Find opportunities');
            expect(row.info).toBe('Browse needs.');
        });

        it('translates the block heading like any other scalar', () => {
            const merged: any = mergeTranslation(baseDoc(), {
                lang: 'hi',
                customFields: { events_details_heading: 'एक नज़र में' },
            });

            expect(merged.customFields.events_details_heading).toBe('एक नज़र में');
        });

        it('does not mutate the base rows', () => {
            const rows = BASE_CARDS.map(r => ({ ...r }));
            mergeTranslation(baseDoc(rows), {
                lang: 'hi',
                customFields: { events_info_cards: [{ id: 'r_a', headline: 'अवसर' }] },
            });

            expect(rows[0].headline).toBe('Find opportunities');
        });

        it('replaces wholesale when only one side is a row array', () => {
            // A plain array of strings is not a repeating field.
            const merged: any = mergeTranslation(
                { customFields: { events_keywords: ['one', 'two'] } },
                { lang: 'hi', customFields: { events_keywords: ['एक'] } },
            );

            expect(merged.customFields.events_keywords).toEqual(['एक']);
        });
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

describe('translatable repeating fields', () => {
    const field = (type: string, key = 'events_info_cards') =>
        ({ key, label: 'Cards', type, required: false, order: 0 }) as any;

    it('treats every repeating type as translatable', () => {
        expect(isTranslatableField(field('infocard'))).toBe(true);
        expect(isTranslatableField(field('gallery'))).toBe(true);
        expect(isTranslatableField(field('labelvalue'))).toBe(true);
    });

    it('still refuses the types that are not prose', () => {
        expect(isTranslatableField(field('image'))).toBe(false);
        expect(isTranslatableField(field('icon'))).toBe(false);
        expect(isTranslatableField(field('number'))).toBe(false);
        expect(isTranslatableField(field('dropdown'))).toBe(false);
    });

    it('lists a row id plus the prose keys, and nothing structural', () => {
        // Position, images and icons belong to the default language, so they
        // must never reach a translation document.
        expect(translatableRepeaterKeys(field('infocard'))).toEqual(['id', 'headline', 'info']);
        expect(translatableRepeaterKeys(field('gallery'))).toEqual(['id', 'caption']);
        expect(translatableRepeaterKeys(field('labelvalue'))).toEqual(['id', 'label', 'value']);
    });

    it('includes the id, which is what anchors a translation to its row', () => {
        for (const type of ['infocard', 'gallery', 'labelvalue']) {
            expect(translatableRepeaterKeys(field(type))[0]).toBe('id');
        }
    });

    it('returns no keys for a field that does not repeat', () => {
        expect(translatableRepeaterKeys(field('text'))).toEqual([]);
    });

    it('names the heading key only where the schema has a translatable one', () => {
        expect(translatableHeadingKey(field('labelvalue', 'events_details')))
            .toBe('events_details_heading');
        expect(translatableHeadingKey(field('infocard'))).toBeNull();
        expect(translatableHeadingKey(field('gallery'))).toBeNull();
    });
});
