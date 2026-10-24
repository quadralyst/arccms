/**
 * Tests for ItemsFromTypeService: the rows of a detail template's
 * data-arc-items-src loops when the app draws the page. The reads match
 * publishing (functions/src/__tests__/itemsFromType.spec.ts covers that side).
 */
import { TestBed } from '@angular/core/testing';
import { Firestore, getDoc, getDocs } from '@angular/fire/firestore';
import { ArcZones } from '../time/arc-zones.service';
import { vi, describe, beforeEach, afterEach, it, expect } from 'vitest';
import { ItemsFromTypePage, ItemsFromTypeService } from './items-from-type.service';

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    collection: vi.fn((_db: unknown, path: string) => ({ path })),
    doc: vi.fn((_db: unknown, ...segments: string[]) => ({ path: segments.join('/') })),
    query: vi.fn((ref: { path: string }, ...constraints: unknown[]) => ({ path: ref.path, constraints })),
    where: vi.fn((field: string, op: string, value: unknown) => ({ kind: 'where', field, op, value })),
    orderBy: vi.fn((field: string, direction: string) => ({ kind: 'orderBy', field, direction })),
    limit: vi.fn((n: number) => ({ kind: 'limit', n })),
    getDocs: vi.fn(),
    getDoc: vi.fn(),
}));

type Constraint = { kind: string; field?: string; value?: unknown; n?: number };
type Ref = { path: string; constraints?: Constraint[] };

const day = (n: number) => ({ seconds: 1767600000 + n * 86400 });

const EVENTS = [
    { id: 'e1', title: 'Fair', urlSlug: 'fair', publishedOn: day(1), customFields: { 'events-venue': 'Hall' } },
    { id: 'e2', title: 'Walk', urlSlug: 'walk', publishedOn: day(3) },
    { id: 'e3', title: 'Talk', urlSlug: 'talk', publishedOn: day(2) },
    { id: 'e4', title: 'Gone', urlSlug: 'gone', publishedOn: day(0), publishedStatus: false },
];

const PAGE: ItemsFromTypePage = { lang: 'en', langPrefix: '', translated: false, type: 'services', id: 's1' };

/** The reads of a type's published entries: the limit of each, or 'whole' for a read of the whole collection. */
let entryReads: (number | 'whole')[];

/** An in-memory Firestore: content types by slug, published entries by type, translations by path. */
function wireDb(
    types: Record<string, Record<string, unknown>>,
    entries: Record<string, Record<string, any>[]>,
    translations: Record<string, Record<string, unknown>> = {},
): void {
    entryReads = [];
    vi.mocked(getDocs).mockImplementation((async (ref: Ref) => {
        if (ref.path === 'ContentTypes') {
            const slug = ref.constraints?.find((c) => c.kind === 'where')?.value as string;
            const type = types[slug];
            return { empty: !type, docs: type ? [{ id: slug, data: () => type }] : [] };
        }
        const rows = entries[ref.path.replace(/^arc_/, '')] || [];
        const cap = ref.constraints?.find((c) => c.kind === 'limit')?.n;
        entryReads.push(cap ?? 'whole');
        const read = cap === undefined
            ? rows
            : [...rows].sort((a, b) => b['publishedOn'].seconds - a['publishedOn'].seconds).slice(0, cap);
        return { docs: read.map(({ id, ...data }) => ({ id, data: () => data })) };
    }) as never);
    vi.mocked(getDoc).mockImplementation((async (ref: Ref) => {
        const data = translations[ref.path];
        return { exists: () => !!data, data: () => data };
    }) as never);
}

describe('ItemsFromTypeService', () => {
    let service: ItemsFromTypeService;

    beforeEach(() => {
        vi.clearAllMocks();
        TestBed.configureTestingModule({
            // The site's zone for the cards' dates (docs/app/clock-and-zones.html): a fixed one, so only the entries are read here.
            providers: [ItemsFromTypeService, { provide: Firestore, useValue: {} }, { provide: ArcZones, useValue: { site: () => 'Europe/Zurich' } }],
        });
        service = TestBed.inject(ItemsFromTypeService);
    });

    afterEach(() => vi.restoreAllMocks());

    it('reads the type newest first up to the limit, as cards, skipping unpublished entries', async () => {
        wireDb({ events: { name: 'Events' } }, { events: EVENTS });
        const rows = await service.rows({ type: 'events', limit: 6 }, PAGE);
        expect(rows.map((r) => r['title'])).toEqual(['Walk', 'Talk', 'Fair']);
        expect(entryReads).toEqual([6]);
        expect(rows[2]['url']).toBe('/events/fair');
        expect(rows[2]['events-venue']).toBe('Hall');
        expect(rows[2]['contentType']).toBe('Events');
    });

    it('reads one more than the limit when it leaves out the page\'s own entry, so the limit is still filled', async () => {
        wireDb({ events: { name: 'Events' } }, { events: EVENTS });
        const rows = await service.rows({ type: 'events', limit: 2 }, { ...PAGE, type: 'events', id: 'e2' });
        expect(entryReads).toEqual([3]);
        expect(rows.map((r) => r['id'])).toEqual(['e3', 'e1']);

        // A page of another type has no entry to leave out: the read is the limit.
        await service.rows({ type: 'events', limit: 2 }, PAGE);
        expect(entryReads).toEqual([3, 2]);
    });

    it('reads a type in its own order whole, then cuts it to the limit', async () => {
        wireDb({ events: { name: 'Events', entryOrder: 'manual' } }, {
            events: [{ ...EVENTS[0], sortOrder: 2 }, { ...EVENTS[1], sortOrder: 3 }, { ...EVENTS[2], sortOrder: 1 }],
        });
        const rows = await service.rows({ type: 'events', limit: 2 }, PAGE);
        expect(entryReads).toEqual(['whole']);
        expect(rows.map((r) => r['id'])).toEqual(['e3', 'e1']);
    });

    it('uses each entry\'s translation for the page\'s language, with links and the type\'s name in that language', async () => {
        wireDb(
            { events: { name: 'Events', nameTranslations: { hi: { name: 'कार्यक्रम' } } } },
            { events: EVENTS.slice(0, 2) },
            { 'arc_events/e1/translations/hi': { title: 'मेला' } },
        );
        const rows = await service.rows({ type: 'events', limit: 6 }, { ...PAGE, lang: 'hi', langPrefix: '/hi', translated: true });
        expect(rows.map((r) => [r['title'], r['url']])).toEqual([['Walk', '/hi/events/walk'], ['मेला', '/hi/events/fair']]);
        expect(rows[0]['contentType']).toBe('कार्यक्रम');
        expect(getDoc).toHaveBeenCalledTimes(2);
    });

    it('reads no translations on the default language', async () => {
        wireDb({ events: { name: 'Events' } }, { events: EVENTS }, { 'arc_events/e1/translations/hi': { title: 'मेला' } });
        const rows = await service.rows({ type: 'events', limit: 6 }, PAGE);
        expect(rows.map((r) => r['title'])).toContain('Fair');
        expect(getDoc).not.toHaveBeenCalled();
    });

    it('shows an entry in the default language when its translation cannot be read', async () => {
        wireDb({ events: { name: 'Events' } }, { events: EVENTS.slice(0, 1) });
        vi.mocked(getDoc).mockRejectedValue(new Error('denied'));
        const rows = await service.rows({ type: 'events', limit: 6 }, { ...PAGE, lang: 'hi', langPrefix: '/hi', translated: true });
        expect(rows.map((r) => [r['title'], r['url']])).toEqual([['Fair', '/hi/events/fair']]);
    });

    it('gives cards without links for a type without public pages, and no rows for a type that does not exist', async () => {
        wireDb({ events: { name: 'Events', hasPublicUrl: false } }, { events: EVENTS.slice(0, 1) });
        expect((await service.rows({ type: 'events', limit: 6 }, PAGE))[0]['url']).toBe('');
        expect(await service.rows({ type: 'nothing', limit: 6 }, PAGE)).toEqual([]);
        expect(entryReads).toEqual([6]);
    });

    it('gives no rows, rather than throwing, when a read fails', async () => {
        const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(getDocs).mockRejectedValue(new Error('permission-denied'));
        await expect(service.rows({ type: 'events', limit: 6 }, PAGE)).resolves.toEqual([]);

        // The type reads, its entries do not.
        wireDb({ events: { name: 'Events' } }, { events: EVENTS });
        vi.mocked(getDocs).mockImplementation((async (ref: Ref) => {
            if (ref.path === 'ContentTypes') return { empty: false, docs: [{ id: 'events', data: () => ({ name: 'Events' }) }] };
            throw new Error('unavailable');
        }) as never);
        await expect(service.rows({ type: 'events', limit: 6 }, PAGE)).resolves.toEqual([]);
        expect(errors).toHaveBeenCalledTimes(2);
        expect(String(errors.mock.calls[0][0])).toContain("'events'");
    });
});
