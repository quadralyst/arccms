/**
 * Entries of another content type in a detail template (data-arc-items-src):
 * this file is the source and functions/src/shared/items-from-type.ts its mirror.
 * Both are checked here, and the loops are filled with both copies of
 * TemplateHydrationService, so the app and a published page show the same rows.
 */
import { describe, it, expect } from 'vitest';
import {
    ITEMS_FROM_TYPE_DEFAULT, ITEMS_FROM_TYPE_MAX, itemsFromTypeLimit, itemsFromTypeSources, nameItemsFromTypeLoops, pickItemsFromType,
} from './items-from-type';
import * as published from '../../../../functions/src/shared/items-from-type';
import { cardData } from './content-cards';
import { TemplateHydrationService } from '../services/template-hydration.service';
import { TemplateHydrationService as PublishedHydration } from '../../../../functions/src/shared/template-hydration';

const day = (n: number) => ({ seconds: 1767600000 + n * 86400 });

const ENTRIES = [
    { id: 'a', title: 'A', publishedOn: day(1) },
    { id: 'b', title: 'B', publishedOn: day(4), sortOrder: 2 },
    { id: 'c', title: 'C', publishedOn: day(3), sortOrder: 1 },
    { id: 'd', title: 'D', publishedOn: day(5), publishedStatus: false },
    { id: 'e', title: 'E', publishedOn: day(2), publishedStatus: true },
];
const ids = (entries: { id: string }[]) => entries.map((e) => e.id);

/** A full event list, mixing the binding styles a real template uses: {{ }} with and without spaces, data-arc-bind over placeholder text, a custom field and a comment. */
const EVENT_LIST = `<section class="event-list">
    <ul class="event-list__items" data-arc-loop="items" data-arc-items-src="events" data-limit="6">
        <li class="event-list__item">
            <a class="event-list__link" href="{{ url }}">
                <img class="event-list__image" src="{{coverImage}}" alt="{{ title }}" loading="lazy">
                <span class="event-list__title" data-arc-bind="title">Sample event</span>
                <span class="event-list__venue" data-arc-bind="events_venue"></span>
            </a>
        </li>
    </ul>
    <!-- Empty state -->
    <div class="empty-state" id="eventsEmptyState"><h3>No events yet</h3></div>
</section>`;

describe('items from another type', () => {
    it('limits rows to the data-limit, a default without one, and a cap', () => {
        expect(itemsFromTypeLimit('3')).toBe(3);
        expect(itemsFromTypeLimit(undefined)).toBe(ITEMS_FROM_TYPE_DEFAULT);
        expect(itemsFromTypeLimit('0')).toBe(ITEMS_FROM_TYPE_DEFAULT);
        expect(itemsFromTypeLimit('-2')).toBe(ITEMS_FROM_TYPE_DEFAULT);
        expect(itemsFromTypeLimit('many')).toBe(ITEMS_FROM_TYPE_DEFAULT);
        expect(itemsFromTypeLimit('500')).toBe(ITEMS_FROM_TYPE_MAX);
        for (const raw of ['3', undefined, '0', 'many', '500']) expect(published.itemsFromTypeLimit(raw)).toBe(itemsFromTypeLimit(raw));
    });

    it('names the types a template reads, each once, in either attribute order and quote', () => {
        const html = `<ul data-arc-items-src="events" data-arc-loop="items"></ul>
            <div data-arc-loop='items' data-arc-items-src='news'></div><ol data-arc-loop="items" data-arc-items-src="events"></ol>`;
        expect(itemsFromTypeSources(html)).toEqual(['events', 'news']);
        expect(published.itemsFromTypeSources(html)).toEqual(['events', 'news']);
        expect(itemsFromTypeSources('<ul data-arc-loop="items"></ul>')).toEqual([]);
        expect(itemsFromTypeSources(null)).toEqual([]);
    });

    it('does not count a loop in an HTML comment, in either copy', () => {
        const html = `<!-- <ul data-arc-loop="items" data-arc-items-src="events"></ul> -->
            <ul data-arc-loop="items" data-arc-items-src="news"></ul><!--
            <ol data-arc-loop="items" data-arc-items-src="old"></ol>
            -->`;
        expect(itemsFromTypeSources(html)).toEqual(['news']);
        expect(published.itemsFromTypeSources(html)).toEqual(['news']);
    });

    it('gives every container a loop of its own, leaving a plain items loop alone', () => {
        const html = `<ul data-arc-loop="items" data-arc-items-src="events" data-limit="3"><li>{{ title }}</li></ul>
            <ul data-arc-loop="items"><li>own</li></ul>
            <div data-arc-items-src="news" data-arc-loop="items"><p>{{ title }}</p></div>`;
        const named = nameItemsFromTypeLoops(html);
        expect(named.loops).toEqual([
            { name: 'arc-items-from-0', type: 'events', limit: 3 },
            { name: 'arc-items-from-1', type: 'news', limit: ITEMS_FROM_TYPE_DEFAULT },
        ]);
        expect(named.html).not.toContain('data-arc-items-src');
        expect(named.html).toContain('<ul data-arc-loop="items"><li>own</li></ul>');
        expect(named.html).not.toContain('<html');
        expect(published.nameItemsFromTypeLoops(html)).toEqual(named);
    });

    it('empties a container whose value is not a type slug, reading nothing', () => {
        const html = '<ul data-arc-loop="items" data-arc-items-src="../Settings/site"><li>x</li></ul><ul data-arc-loop="items" data-arc-items-src=" "><li>y</li></ul>';
        expect(nameItemsFromTypeLoops(html)).toEqual({ html: '<ul></ul><ul></ul>', loops: [] });
        expect(published.nameItemsFromTypeLoops(html)).toEqual(nameItemsFromTypeLoops(html));
    });

    it('leaves a template without such loops exactly as it is', () => {
        const html = '<div><ul data-arc-loop="tags"><li>{{ name }}</li></ul></div>';
        expect(nameItemsFromTypeLoops(html)).toEqual({ html, loops: [] });
        // Without a loop to fill, the attribute is dropped and nothing is read.
        expect(nameItemsFromTypeLoops('<p data-arc-items-src="events">x</p>')).toEqual({ html: '<p>x</p>', loops: [] });
    });

    it('picks published entries only, never the page\'s own, in the type\'s order, up to the limit', () => {
        expect(ids(pickItemsFromType(ENTRIES, 'newest', 10))).toEqual(['b', 'c', 'e', 'a']);
        expect(ids(pickItemsFromType(ENTRIES, 'newest', 2))).toEqual(['b', 'c']);
        expect(ids(pickItemsFromType(ENTRIES, 'newest', 2, 'b'))).toEqual(['c', 'e']);
        expect(ids(pickItemsFromType(ENTRIES, 'manual', 10))).toEqual(['c', 'b', 'a', 'e']);
        for (const [order, limit, exclude] of [['newest', 2, 'b'], ['manual', 3, ''], ['manual', 10, 'c']] as const) {
            expect(published.pickItemsFromType(ENTRIES, order, limit, exclude)).toEqual(pickItemsFromType(ENTRIES, order, limit, exclude));
        }
    });

    describe('filled into a template, the same by the app and by publishing', () => {
        const events = [
            { id: 'x1', title: 'Open day', urlSlug: 'open-day', coverImage: 'https://img.example/o.jpg', publishedOn: day(2), customFields: { events_venue: 'Main hall' } },
            { id: 'x2', title: 'Talk "live" & more', urlSlug: 'talk', publishedOn: day(1), customFields: {} },
        ];
        const rows = events.map((e) => cardData(e, 'events', 'Events', 'hi', '/hi'));

        function fill(Hydration: typeof TemplateHydrationService | typeof PublishedHydration, html: string, data: Record<string, any[]>) {
            const named = nameItemsFromTypeLoops(html);
            const byName = Object.fromEntries(named.loops.map((loop, i) => [loop.name, data[i] ?? []]));
            return Hydration.processLoops(named.html, byName) as string;
        }

        it('fills a full template: links in the page\'s language, custom fields, escaped values', () => {
            for (const Hydration of [TemplateHydrationService, PublishedHydration]) {
                const html = fill(Hydration, EVENT_LIST, { 0: rows });
                expect(html).toContain('href="/hi/events/open-day"');
                expect(html).toContain('src="https://img.example/o.jpg"');
                expect(html).toContain('Main hall');
                expect(html).toContain('alt="Talk &quot;live&quot; &amp; more"');
                expect(html).not.toContain('Sample event');
                expect((html.match(/class="event-list__item"/g) || []).length).toBe(2);
            }
            expect(fill(TemplateHydrationService, EVENT_LIST, { 0: rows })).toBe(fill(PublishedHydration, EVENT_LIST, { 0: rows }));
        });

        it('empties the container when there are no rows, so CSS such as :empty + .empty-state can show the empty state', () => {
            for (const Hydration of [TemplateHydrationService, PublishedHydration]) {
                const html = fill(Hydration, EVENT_LIST, {});
                expect(html).toContain('<ul class="event-list__items"></ul>');
                expect(html).not.toContain('Sample event');
                expect(html).toContain('No events yet');
            }
        });

        it('fills several containers, each from its own type and with its own row', () => {
            const html = `<ul data-arc-loop="items" data-arc-items-src="events"><li class="a">{{ title }}</li></ul>
                <ol data-arc-loop="items" data-arc-items-src="news"><li class="n">{{ title }}</li></ol>`;
            const news = [cardData({ id: 'n1', title: 'Headline', urlSlug: 'h' }, 'news', 'News', 'en', '')];
            for (const Hydration of [TemplateHydrationService, PublishedHydration]) {
                const out = fill(Hydration, html, { 0: rows, 1: news });
                expect(out).toContain('<li class="a">Open day</li>');
                expect(out).toContain('<li class="n">Headline</li>');
                expect(out).not.toContain('<li class="a">Headline</li>');
                expect(out).not.toContain('<li class="n">Open day</li>');
            }
        });
    });
});
