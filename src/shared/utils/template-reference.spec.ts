/**
 * The admin's Template Reference (template-reference.ts) against what publishing
 * really gives each page (B3 in specs/website-docs-review.md): every binding it
 * lists must hold a value, every card binding must be listed, and each custom
 * field's snippet must render that field when a template uses it.
 */
import { describe, it, expect, vi } from 'vitest';

vi.mock('../../../functions/src/init', () => ({ db: {} }));

import {
    DETAIL_FIELDS, DETAIL_LOOPS, ITEM_FIELDS, LIST_FIELDS, PARTIALS_FIELDS, customFieldReference, templateKey,
    templateReference, type TemplateRefField,
} from './template-reference';
import { buildTemplateData } from '../../../functions/src/pages/deployContentPage';
import { listPageData } from '../../../functions/src/pages/deployContentListPage';
import { partialPageData } from '../../../functions/src/pages/deployHomePage';
import { cardData } from '../../../functions/src/shared/content-cards';
import { TemplateHydrationService } from '../../../functions/src/shared/template-hydration';

const TYPE = { slug: 'events', name: 'Events', description: 'What is on' };
const SITE = { siteName: 'Site', baseUrl: 'https://example.com' };
const AUTHOR = { id: 'a1', name: 'Asha Rao', bio: 'Cook', photoUrl: 'https://x/a.jpg', jobTitle: 'Chef', url: 'https://asha.example' };

const ENTRY: Record<string, any> = {
    id: 'e1',
    title: 'Spring fair',
    urlSlug: 'spring-fair',
    summary: 'A day out',
    metaDescription: 'The spring fair',
    content: '<p>Stalls and music all day long.</p>',
    coverImage: 'https://firebasestorage.googleapis.com/v0/b/b/o/mediaImages%2Ffair-m.webp?alt=media',
    publishedOn: { seconds: 1767600000 },
    updatedOn: { seconds: 1767700000 },
    isRevision: true,
    authorName: 'Asha Rao',
    tags: ['Food', 'Music'],
    tagsWithColors: [{ name: 'Food', color: '#f00' }, { name: 'Music', color: '#0f0' }],
    references: [{ title: 'Council notice', url: 'https://council.example/notice' }],
    nextContent: { id: 'e2', title: 'Summer fair', slug: 'summer-fair', summary: '' },
    previousContent: { id: 'e0', title: 'Winter fair', slug: 'winter-fair', summary: '' },
};

/** A value by dotted path, as {{ a.b }} reads it. */
const at = (data: Record<string, any>, path: string) =>
    path.split('.').reduce<any>((v, k) => (v == null ? undefined : v[k]), data);

/** The detail page's data as publishing builds it, with the related loop it adds after. */
function detailData(entry = ENTRY) {
    return { ...buildTemplateData(entry, TYPE, SITE, 'en', 'en', undefined, AUTHOR as any), related: [], hasRelated: false };
}

describe('Template Reference', () => {
    it('lists only detail bindings that publishing fills', () => {
        const data = detailData();
        for (const row of [...DETAIL_FIELDS, ...DETAIL_LOOPS]) {
            expect(at(data, row.key), row.key).toBeDefined();
        }
    });

    it('lists only list and card block bindings that publishing fills', () => {
        const list = { ...listPageData(TYPE, 'en', ''), items: [] };
        for (const row of LIST_FIELDS) expect(at(list, row.key), row.key).toBeDefined();
        const partial = { ...partialPageData(TYPE, 'en', '', '', 0), items: [] };
        for (const row of PARTIALS_FIELDS) expect(at(partial, row.key), row.key).toBeDefined();
    });

    it('lists every binding a card has, and nothing it lacks', () => {
        const card = cardData(ENTRY, 'events', 'Events', 'en', '');
        const listed = new Set(ITEM_FIELDS.map((r) => r.key));
        // Kept for older templates; the reference points at the better binding.
        const aliases = new Set(['tags', 'author', 'cat']);
        expect(Object.keys(card).filter((k) => !listed.has(k) && !aliases.has(k))).toEqual([]);
        for (const key of listed) expect(card[key], key).toBeDefined();
    });

    it('never offers summary, isFeatured or nextContent.url, which published pages leave empty', () => {
        const keys = [...ITEM_FIELDS, ...DETAIL_FIELDS].map((r) => r.key);
        expect(ITEM_FIELDS.map((r) => r.key)).not.toContain('summary');
        expect(keys).not.toContain('isFeatured');
        expect(keys).not.toContain('nextContent.url');
    });

    describe('custom fields', () => {
        it('uses the short key, and the full key where the short one is a built-in', () => {
            expect(templateKey('events-price', 'events')).toBe('price');
            expect(templateKey('events_price', 'events')).toBe('price');
            expect(templateKey('events-title', 'events')).toBe('events-title');
            expect(templateKey('price', 'events')).toBe('price');
        });

        /** Renders a field's snippet the way a detail page is rendered. */
        function render(field: TemplateRefField, value: unknown): string {
            const entry = { ...ENTRY, customFields: { [field.key]: value } };
            const snippet = customFieldReference(field, 'events').syntax;
            const html = snippet.startsWith('data-arc-loop=')
                ? `<div ${snippet}><p>{{ label }}{{ headline }}{{ caption }}</p></div>`
                : snippet.startsWith('data-arc-') || snippet.startsWith('[')
                    ? `<div ${snippet}>empty</div>`
                    : snippet.includes('="{{') && !snippet.startsWith('<') ? `<i ${snippet}></i>` : snippet;
            const looped = TemplateHydrationService.processLoops(html, TemplateHydrationService.arrayLoopData(
                entry.customFields as Record<string, any>, ['tags', 'items'], 'events'));
            return TemplateHydrationService.hydrateTemplate(looped, detailData(entry));
        }

        const cases: [TemplateRefField, unknown, string][] = [
            [{ key: 'events-venue', label: 'Venue', type: 'text' }, 'Town hall', 'Town hall'],
            [{ key: 'events-price', label: 'Price', type: 'number' }, '25', '25'],
            [{ key: 'events-agenda', label: 'Agenda', type: 'richtext' }, '<ul><li>Talks</li></ul>', '<li>Talks</li>'],
            [{ key: 'events-photo', label: 'Photo', type: 'image' }, 'https://x/photo.jpg', 'src="https://x/photo.jpg"'],
            [{ key: 'events-badge', label: 'Badge', type: 'icon' }, { classes: 'fa-solid fa-star', name: 'star' }, 'class="fa-solid fa-star"'],
            [{ key: 'events-brand', label: 'Brand', type: 'color' }, '#1a73e8', '#1a73e8'],
            [{ key: 'events-free', label: 'Free', type: 'boolean' }, true, 'empty'],
            [{ key: 'events-day', label: 'Day', type: 'date' }, '2026-10-05', 'datetime="2026-10-05"'],
            [{ key: 'events-starts', label: 'Starts', type: 'datetime' }, '2026-10-05T18:30', 'datetime="2026-10-05T18:30"'],
            [{ key: 'events-level', label: 'Level', type: 'dropdown' }, 'Beginner', 'Beginner'],
            [{ key: 'events-format', label: 'Format', type: 'radio' }, 'Online', 'Online'],
            [{ key: 'events-topics', label: 'Topics', type: 'checkbox' }, ['Design', 'Code'], 'Design,Code'],
            [{ key: 'events-details', label: 'Details', type: 'labelvalue' }, [{ label: 'Entry', value: 'Free' }], 'Entry'],
            [{ key: 'events-cards', label: 'Cards', type: 'infocard' }, [{ headline: 'Stalls', info: '' }], 'Stalls'],
            [{ key: 'events-photos', label: 'Photos', type: 'gallery' }, [{ image: 'https://x/g.jpg', caption: 'Crowd' }], 'Crowd'],
        ];

        it.each(cases)('the %s snippet renders the field', (field, value, expected) => {
            expect(render(field, value)).toContain(expected);
        });

        // SS4: the FAQ field's loop, with the answer as paragraphs and links.
        it('renders an FAQ field\'s rows in order, the answer as HTML', () => {
            const field = { key: 'events-faq', label: 'FAQ', type: 'faq' };
            const snippet = customFieldReference(field, 'events');
            expect(snippet.syntax).toBe('data-arc-loop="faq"');
            expect(snippet.note).toContain('{{ faq_heading }}');
            const entry = { ...ENTRY, customFields: { 'events-faq': [
                { id: 'b', position: 1, question: 'Parking?', answer: 'Free after 6.' },
                { id: 'a', position: 0, question: 'Tickets?', answer: 'At the door.\n\nOr online: https://x.example/t' },
            ] } };
            const looped = TemplateHydrationService.processLoops(
                `<div ${snippet.syntax}><details><summary>{{ question }}</summary><div data-arc-bind="answer_html"></div></details></div>`,
                TemplateHydrationService.arrayLoopData(entry.customFields as Record<string, any>, ['tags', 'items'], 'events'));
            const html = TemplateHydrationService.hydrateTemplate(looped, detailData(entry));
            expect(html.indexOf('Tickets?')).toBeLessThan(html.indexOf('Parking?'));
            expect(html).toContain('<p>At the door.</p><p>Or online: <a href="https://x.example/t">https://x.example/t</a></p>');
        });

        it('renders a field from another content type by its copied title', () => {
            const field = { key: 'events-speaker', label: 'Speaker', type: 'dropdown', useCollectionRef: true };
            const entry = { ...ENTRY, customFields: { 'events-speaker': 's1' }, 'ref_events-speaker': { id: 's1', title: 'Dr Mehta' } };
            const snippet = customFieldReference(field, 'events').syntax;
            expect(TemplateHydrationService.hydrateTemplate(`<p>${snippet}</p>`, detailData(entry))).toContain('Dr Mehta');
        });
    });

    it('puts the type\'s own fields first, then each page', () => {
        const ids = templateReference('events', [{ key: 'events-price', label: 'Price', type: 'number' }]).map((s) => s.id);
        expect(ids).toEqual(['custom', 'detail', 'detail-loops', 'list', 'partials', 'items', 'directives']);
        expect(templateReference('events').map((s) => s.id)[0]).toBe('detail');
    });
});
