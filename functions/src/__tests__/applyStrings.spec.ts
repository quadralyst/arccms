/**
 * Tests for static-text translation (`data-arc-t`).
 *
 * The contract that matters: the authored English is the fallback, so a
 * partial or missing translation always renders a complete page.
 */
import { describe, it, expect } from 'vitest';
import { TemplateHydrationService } from '../shared/template-hydration.js';

const apply = (html: string, strings?: Record<string, string> | null) =>
    TemplateHydrationService.applyStrings(html, strings);

describe('applyStrings', () => {
    it('should replace annotated text with the translation', () => {
        const html = apply('<span data-arc-t="read_more">Read Article</span>', { read_more: 'लेख पढ़ें' });

        expect(html).toContain('लेख पढ़ें');
        expect(html).not.toContain('Read Article');
    });

    it('should strip the annotation from the output', () => {
        const html = apply('<span data-arc-t="read_more">Read Article</span>', { read_more: 'x' });

        expect(html).not.toContain('data-arc-t');
    });

    it('should keep the authored English when the key is missing', () => {
        const html = apply('<span data-arc-t="read_more">Read Article</span>', { other: 'x' });

        expect(html).toContain('Read Article');
        expect(html).not.toContain('data-arc-t');
    });

    it('should keep the authored English for the default language', () => {
        // The default language has no strings file at all.
        for (const strings of [{}, null, undefined]) {
            expect(apply('<span data-arc-t="read_more">Read Article</span>', strings))
                .toContain('Read Article');
        }
    });

    it('should treat a blank translation as untranslated', () => {
        // A blank entry must not silently erase a label.
        const html = apply('<span data-arc-t="read_more">Read Article</span>', { read_more: '   ' });

        expect(html).toContain('Read Article');
    });

    it('should leave unannotated text alone', () => {
        const html = apply('<p>Untouched</p><span data-arc-t="k">A</span>', { k: 'B' });

        expect(html).toContain('Untouched');
        expect(html).toContain('B');
    });

    it('should preserve interpolation carried by the translation', () => {
        // Strings are applied before hydration, so a translated value may hold
        // its own {{ }} — "Back to {{ contentType }}".
        const html = apply(
            '<span data-arc-t="back_to">Back to {{ contentType }}</span>',
            { back_to: 'वापस {{ contentType }} पर' },
        );

        expect(html).toContain('वापस {{ contentType }} पर');
    });

    it('should translate several elements independently', () => {
        const html = apply(
            '<a data-arc-t="one">One</a><a data-arc-t="two">Two</a>',
            { one: 'एक' },
        );

        expect(html).toContain('एक');
        expect(html).toContain('Two');
    });

    it('should translate annotated attributes', () => {
        const html = apply(
            '<input data-arc-t-attr="placeholder:search" placeholder="Search">',
            { search: 'खोजें' },
        );

        expect(html).toContain('placeholder="खोजें"');
        expect(html).not.toContain('data-arc-t-attr');
    });

    it('should translate several attributes on one element', () => {
        const html = apply(
            '<img data-arc-t-attr="alt:alt_key,title:title_key" alt="A" title="B">',
            { alt_key: 'क', title_key: 'ख' },
        );

        expect(html).toContain('alt="क"');
        expect(html).toContain('title="ख"');
    });

    it('should keep the authored attribute when its key is missing', () => {
        const html = apply(
            '<input data-arc-t-attr="placeholder:search" placeholder="Search">',
            {},
        );

        expect(html).toContain('placeholder="Search"');
    });

    it('should handle empty input', () => {
        expect(apply('', { a: 'b' })).toBe('');
    });
});
