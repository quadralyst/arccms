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

