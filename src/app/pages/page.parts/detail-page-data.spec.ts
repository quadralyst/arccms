/**
 * detailPageData and renderDetailPage (specs/visual-editing-spec.md, VE1.1): the
 * data-building half of the detail page, moved out of ContentDetailComponent with
 * no change in output. `before` below is the component's code as it was, kept
 * here as the reference.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { detailPageData, renderDetailPage, readTimeOf, updatedOnText, DetailPageInput } from './detail-page-data';
import { TemplateHydrationService } from '../../core/services/template-hydration.service';
import { nameItemsFromTypeLoops } from '../../core/utils/items-from-type';
import { interpolate } from '../../core/i18n/interpolate';
import { contentTypeName } from '../admin/contents/content-types/content-types.model';

const TYPE: any = { slug: 'events', name: 'Events', fields: [{ key: 'events-faq', type: 'faq' }] };
const CONTENT: any = {
    id: 'e1', title: 'Fair', content: '<p>' + 'word '.repeat(450) + '</p>', summary: 'Sum', urlSlug: 'fair',
    publishedOn: '2026-01-05T10:00:00Z', updatedOn: '2026-02-01T10:00:00Z', tags: ['a', 'b'],
    nextContent: { slug: 'next', title: 'Next' }, previousContent: { slug: 'prev', title: 'Prev' },
    customFields: { 'events-price': '20', 'events-faq': [{ question: 'Q2', answer: 'A2', position: 2 }, { question: 'Q1', answer: 'A1', position: 1 }] },
};
const fmt = (date: unknown) => (date ? `D(${String(date).slice(0, 10)})` : '');

function input(over: Partial<DetailPageInput> = {}): DetailPageInput {
    return {
        contentType: TYPE, content: CONTENT, pageLang: '', defaultLang: 'en', strings: { min_read: '{{ readTime }} min' },
        formatDate: fmt, shareUrl: 'https://site.test/events/fair', shareTitle: 'Fair',
        author: { author: { name: 'Sam' } as any, authorName: 'Sam' }, references: [{ title: 'Src', url: 'https://x' }], related: [],
        ...over,
    };
}

/** The component's hydrateAndSetTemplate before VE1.1, the reference. */
function before(templateHtml: string, i: DetailPageInput): string {
    const content = i.content as any;
    const contentType = i.contentType;
    const nextContent = content.nextContent ? { ...content.nextContent, url: `/${contentType.slug}/${content.nextContent.slug}` } : null;
    const previousContent = content.previousContent ? { ...content.previousContent, url: `/${contentType.slug}/${content.previousContent.slug}` } : null;
    const shareUrl = i.shareUrl;
    const shareTitle = i.shareTitle;
    const shareSummary = content.summary || content.metaDescription || '';
    const share = {
        facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
        twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`,
        linkedin: `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareTitle)}&summary=${encodeURIComponent(shareSummary)}`,
        whatsapp: `https://wa.me/?text=${encodeURIComponent(shareTitle + ' ' + shareUrl)}`,
        email: `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareUrl)}`,
    };
    const typeName = contentTypeName(contentType, i.pageLang);
    const readTime = readTimeOf(content);
    const updated = updatedOnText(content, i.formatDate);
    const templateData: any = {
        contentType: typeName, cat: typeName, contentTypeSlug: contentType.slug, ...content,
        publishedOn: i.formatDate(content.publishedOn), date: i.formatDate(content.publishedOn),
        updatedOn: updated, updatedOnDisplay: updated,
        lang: i.pageLang || i.defaultLang, langPrefix: i.pageLang ? `/${i.pageLang}` : '',
        readTime,
        readingTime: i.strings['min_read'] ? interpolate(i.strings['min_read'], { readTime }) : `${readTime} min read`,
        ...(content.customFields || {}), ...i.author,
        references: i.references, hasReferences: i.references.length > 0, related: i.related, hasRelated: i.related.length > 0,
    };
    templateData['share'] = share;
    if (nextContent) templateData['nextContent'] = nextContent;
    if (previousContent) templateData['previousContent'] = previousContent;
    let html = templateHtml;
    const tagsData = content.tagsWithColors || (content.tags || []).map((t: string) => ({ name: t, color: '#6b7280' }));
    html = TemplateHydrationService.applyStrings(html, i.strings);
    html = TemplateHydrationService.applySiteInfo(html, null);
    const fromTypes = nameItemsFromTypeLoops(html);
    html = fromTypes.html;
    html = TemplateHydrationService.processLoops(html, {
        ...TemplateHydrationService.arrayLoopData(content.customFields, ['tags', 'items'], contentType.slug),
        references: i.references, related: i.related, tags: tagsData,
    });
    return TemplateHydrationService.hydrateTemplate(html, templateData);
}

const context = (strings: Record<string, string>) => ({ strings, siteInfo: null, itemsFromTypeRows: () => ({}) });
const TEMPLATES = ['default', 'articles', 'info', 'manuals'].map((folder) => ({
    folder, html: readFileSync(resolve(__dirname, `../../../../public/_site/templates/${folder}/detail.html`), 'utf8'),
}));
const KITCHEN = `<h1 data-arc-bind="title"></h1><p>{{ cat }} {{ date }} {{ updatedOn }} {{ readingTime }} {{ price }}</p>
<a href="{{ nextContent.url }}">{{ nextContent.title }}</a><a [href]="share.twitter">t</a>
<ul data-arc-loop="faq"><li>{{ question }}</li></ul><ul data-arc-loop="tags"><li>{{ name }}</li></ul>
<ol data-arc-loop="references"><li>{{ title }}</li></ol><p data-arc-if="hasRelated">rel</p><span data-arc-t="min_read">x</span>`;

describe('detailPageData (VE1.1)', () => {
    for (const { folder, html } of [...TEMPLATES, { folder: 'kitchen sink', html: KITCHEN }]) {
        it(`${folder}: the same page as before`, () => {
            const i = input();
            expect(renderDetailPage(html, detailPageData(i), context(i.strings))).toBe(before(html, i));
        });
    }

    it('the same page in a translation, with its prefix and strings', () => {
        const i = input({ pageLang: 'hi', strings: { min_read: '{{ readTime }} मिनट' } });
        expect(renderDetailPage(KITCHEN, detailPageData(i), context(i.strings))).toBe(before(KITCHEN, i));
    });

    it('builds the data a template binds', () => {
        const { templateData, loops } = detailPageData(input());
        expect(templateData['cat']).toBe('Events');
        expect(templateData['date']).toBe('D(2026-01-05)');
        expect(templateData['updatedOn']).toBe('D(2026-02-01)');
        expect(templateData['readingTime']).toBe(`${readTimeOf(CONTENT)} min`);
        expect(templateData['events-price']).toBe('20');
        expect(templateData['nextContent'].url).toBe('/events/next');
        expect(templateData['share'].twitter).toContain(encodeURIComponent('https://site.test/events/fair'));
        expect(templateData['hasReferences']).toBe(true);
        expect(templateData['hasRelated']).toBe(false);
        // Rows in order, under the field's key and its unprefixed name.
        expect(loops['faq'].map((row: any) => row.question)).toEqual(['Q1', 'Q2']);
        expect(loops['events-faq']).toBe(loops['faq']);
        expect(loops['tags']).toEqual([{ name: 'a', color: '#6b7280' }, { name: 'b', color: '#6b7280' }]);
    });

    it('marks fields only when asked (VE-D7)', () => {
        const i = input();
        expect(renderDetailPage(KITCHEN, detailPageData(i), context(i.strings))).not.toContain('data-arc-field');
        const marked = renderDetailPage(KITCHEN, detailPageData(i), { ...context(i.strings), markFields: true });
        expect(marked).toContain('<h1 data-arc-field="title">Fair</h1>');
        expect(marked).toContain('<span data-arc-field="price">20</span>');
        expect(marked).toContain('data-arc-field="faq" data-arc-row="0"');
    });

    it('fills other types\' entries from the rows it is given', () => {
        const html = '<ul data-arc-loop="items" data-arc-items-src="news" data-limit="2"><li>{{ title }}</li></ul>';
        const asked: unknown[] = [];
        const out = renderDetailPage(html, detailPageData(input()), {
            strings: {}, siteInfo: null,
            itemsFromTypeRows: (loops) => {
                asked.push(...loops);
                return Object.fromEntries(loops.map((loop) => [loop.name, [{ title: 'From news' }]]));
            },
        });
        expect(asked).toHaveLength(1);
        expect(out).toContain('<li>From news</li>');
    });
});
