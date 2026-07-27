/**
 * Guards the seeded content types against re-declaring built-in fields.
 *
 * This is the regression that prompted the test: the seed shipped `title`,
 * `urlSlug`, `coverImage`, `body`, `excerpt` and `publishDate` as custom
 * fields, so every seeded site gave authors two Title inputs and two URL Slug
 * inputs — and because `buildTemplateData` spreads `customFields` last, the
 * duplicate silently outranked the real field on the published page.
 */

import { describe, it, expect } from 'vitest';
import { DEFAULT_CONTENT_TYPES } from './onboarding-defaults';

/**
 * Field names the content document already carries and the editor already has
 * a control for. `body` and `publishDate` are the names the seed used for
 * `content` and `publishedOn`; they are listed because a field *called*
 * something else that means the same thing is the same duplicate.
 */
const BUILT_IN_FIELD_KEYS = [
    'title',
    'content',
    'body',
    'urlSlug',
    'coverImage',
    'summary',
    'excerpt',
    'seoTitle',
    'metaDescription',
    'canonicalUrl',
    'publishedOn',
    'publishDate',
    'tags',
    'status',
    'isFeatured',
    'readTime',
];

describe('DEFAULT_CONTENT_TYPES', () => {
    it.each(DEFAULT_CONTENT_TYPES.map(t => [t.slug, t] as const))(
        '%s declares no field the content document already has',
        (_slug, contentType) => {
            const duplicates = (contentType.fields || [])
                .map(field => field.key)
                .filter(key => BUILT_IN_FIELD_KEYS.includes(key));

            expect(duplicates).toEqual([]);
        },
    );

    it('keeps the fields that are genuinely specific to a type', () => {
        const byslug = Object.fromEntries(
            DEFAULT_CONTENT_TYPES.map(t => [t.slug, (t.fields || []).map(f => f.key)]),
        );

        // A type with no fields is correct, not a mistake: an article *is* a
        // title, a body and a cover image.
        expect(byslug['articles']).toEqual([]);
        expect(byslug['user-manuals']).toEqual(['category']);
        expect(byslug['release-notes']).toEqual(['version', 'releaseDate', 'isBreaking']);
    });

    it('numbers each type its own fields from 1', () => {
        for (const contentType of DEFAULT_CONTENT_TYPES) {
            const orders = (contentType.fields || []).map(f => f.order);
            expect(orders).toEqual(orders.map((_, index) => index + 1));
        }
    });

    it('lists only built-in columns in listColumns', () => {
        // listColumns names document fields, so a column pointing at a removed
        // custom field would render blank.
        for (const contentType of DEFAULT_CONTENT_TYPES) {
            const custom = new Set((contentType.fields || []).map(f => f.key));
            for (const column of contentType.listColumns || []) {
                const known = BUILT_IN_FIELD_KEYS.includes(column)
                    || custom.has(column)
                    || ['createdAt', 'modifiedAt'].includes(column);
                expect(known, `${contentType.slug}.listColumns has unknown "${column}"`).toBe(true);
            }
        }
    });
});
