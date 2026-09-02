import { TestBed } from '@angular/core/testing';
import { IconLibraryService } from './icon-library.service';
import { FaIndex } from '../models/icon.model';

/** Mirrors the stand-in the setup file serves for the generated assets. */
const INDEX: FaIndex = {
    version: 'test',
    icons: [
        { n: 'folder', l: 'Folder', s: ['solid', 'regular'], t: 'directory archive' },
        { n: 'file', l: 'File', s: ['solid', 'regular'], t: 'document page' },
        { n: 'magnifying-glass', l: 'Magnifying Glass', s: ['solid'], t: 'find zoom', a: 'search' },
        { n: 'github', l: 'GitHub', s: ['brands'], t: 'git code' },
    ],
};

describe('IconLibraryService', () => {
    let service: IconLibraryService;

    beforeEach(() => {
        TestBed.configureTestingModule({});
        service = TestBed.inject(IconLibraryService);
    });

    // Several tests replace global fetch. Without this the mock outlives the
    // test and the next one silently measures the wrong thing.
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe('loadIndex', () => {
        it('fetches and returns the index', async () => {
            const index = await service.loadIndex();
            expect(index?.icons.map(i => i.n)).toEqual(['folder', 'file', 'magnifying-glass', 'github']);
        });

        it('fetches only once across repeated calls', async () => {
            const spy = vi.spyOn(globalThis, 'fetch');
            await Promise.all([service.loadIndex(), service.loadIndex()]);
            await service.loadIndex();

            const indexCalls = spy.mock.calls.filter(([url]) => String(url).includes('fa-index'));
            expect(indexCalls).toHaveLength(1);
            spy.mockRestore();
        });

        it('returns null and allows a retry when the fetch fails', async () => {
            const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValueOnce(new Error('offline'));
            vi.spyOn(console, 'error').mockImplementation(() => { });

            expect(await service.loadIndex()).toBeNull();

            // The failure must not be cached, or one flaky load would leave the
            // picker empty for the rest of the session.
            spy.mockRestore();
            expect(await service.loadIndex()).not.toBeNull();
        });

        it('returns null on a non-ok response', async () => {
            vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(new Response('', { status: 404 }));
            expect(await service.loadIndex()).toBeNull();
        });
    });

    describe('search', () => {
        it('returns nothing without an index', () => {
            expect(service.search(null, 'folder', 'all')).toEqual([]);
        });

        it('returns one result per style an icon exists in', () => {
            const results = service.search(INDEX, 'folder', 'all');
            expect(results.map(r => r.classes)).toEqual([
                'fa-solid fa-folder',
                'fa-regular fa-folder',
            ]);
        });

        it('restricts to a single style when asked', () => {
            const results = service.search(INDEX, 'folder', 'regular');
            expect(results.map(r => r.classes)).toEqual(['fa-regular fa-folder']);
        });

        it('excludes icons that do not exist in the requested style', () => {
            expect(service.search(INDEX, 'github', 'solid')).toEqual([]);
            expect(service.search(INDEX, 'github', 'brands')).toHaveLength(1);
        });

        it('matches on an alias that is absent from the name', () => {
            const results = service.search(INDEX, 'search', 'all');
            expect(results[0].entry.n).toBe('magnifying-glass');
        });

        it('ranks an exact alias above a name that merely starts with the term', () => {
            const index: FaIndex = {
                version: 'test',
                icons: [
                    { n: 'searchengin', l: 'Searchengin', s: ['brands'], t: '' },
                    { n: 'folder-tree', l: 'Folder Tree', s: ['solid'], t: 'search structure' },
                    { n: 'magnifying-glass', l: 'Magnifying Glass', s: ['solid'], t: 'zoom', a: 'search' },
                ],
            };
            // Typing "search" must find the magnifying glass, not a defunct
            // SEO brand logo. This is why aliases are weighted above names.
            expect(service.search(index, 'search', 'all').map(r => r.entry.n))
                .toEqual(['magnifying-glass', 'searchengin', 'folder-tree']);
        });

        it('does not match a term buried inside an alias', () => {
            const index: FaIndex = {
                version: 'test',
                icons: [{ n: 'bolt', l: 'Bolt', s: ['solid'], t: '', a: 'flashlight' }],
            };
            // "flash" sits inside the alias "flashlight". Alias matching is
            // word-bounded for the same reason keyword matching is.
            expect(service.search(index, 'flash', 'all')).toEqual([]);
        });

        it('matches on the display label', () => {
            const results = service.search(INDEX, 'magnifying gl', 'all');
            expect(results[0].entry.n).toBe('magnifying-glass');
        });

        it('ranks an exact name above one that merely contains the term', () => {
            const index: FaIndex = {
                version: 'test',
                icons: [
                    { n: 'user-astronaut', l: 'User Astronaut', s: ['solid'], t: '' },
                    { n: 'circle-user', l: 'Circle User', s: ['solid'], t: '' },
                    { n: 'user', l: 'User', s: ['solid'], t: '' },
                ],
            };
            expect(service.search(index, 'user', 'all').map(r => r.entry.n))
                .toEqual(['user', 'user-astronaut', 'circle-user']);
        });

        it('does not match a search term buried inside a keyword', () => {
            const index: FaIndex = {
                version: 'test',
                icons: [{ n: 'flag-checkered', l: 'Flag', s: ['solid'], t: 'racecar finish' }],
            };
            // "car" sits inside the keyword "racecar". Keyword matching is
            // word-bounded, so this is not a hit — an unbounded one would
            // bury the real `car` icon under everything mentioning a car.
            expect(service.search(index, 'car', 'all')).toEqual([]);
        });

        it('matches a name substring, but ranks it below an exact name', () => {
            const index: FaIndex = {
                version: 'test',
                icons: [
                    { n: 'scarf', l: 'Scarf', s: ['solid'], t: 'winter' },
                    { n: 'car', l: 'Car', s: ['solid'], t: 'vehicle' },
                ],
            };
            expect(service.search(index, 'car', 'all').map(r => r.entry.n))
                .toEqual(['car', 'scarf']);
        });

        it('returns everything when the term is empty', () => {
            // Four icons, six name-and-style combinations.
            expect(service.search(INDEX, '', 'all')).toHaveLength(6);
        });

        it('honours the limit', () => {
            expect(service.search(INDEX, '', 'all', 2)).toHaveLength(2);
        });
    });

    describe('buildToken', () => {
        it('builds a token with classes, label and sanitised markup', async () => {
            const token = await service.buildToken(INDEX.icons[2], 'solid');

            expect(token).toMatchObject({
                set: 'fa',
                name: 'magnifying-glass',
                style: 'solid',
                classes: 'fa-solid fa-magnifying-glass',
                label: 'Magnifying Glass',
            });
            expect(token.markup).toContain('viewBox="0 0 512 512"');
            expect(token.markup).toContain('fill="currentColor"');
        });

        it('omits markup when the style has no path for the icon', async () => {
            const unknown = { n: 'not-in-paths', l: 'Missing', s: ['solid' as const], t: '' };
            const token = await service.buildToken(unknown, 'solid');

            // The class name is what renders; a missing fallback is not fatal.
            expect(token.classes).toBe('fa-solid fa-not-in-paths');
            expect(token.markup).toBeUndefined();
        });

        it('still returns a token when the path file cannot be fetched', async () => {
            vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('offline'));
            vi.spyOn(console, 'error').mockImplementation(() => { });

            const token = await service.buildToken(INDEX.icons[0], 'solid');
            expect(token.classes).toBe('fa-solid fa-folder');
            expect(token.markup).toBeUndefined();
        });

        it('fetches each style at most once', async () => {
            const spy = vi.spyOn(globalThis, 'fetch');
            await service.buildToken(INDEX.icons[0], 'solid');
            await service.buildToken(INDEX.icons[1], 'solid');

            const pathCalls = spy.mock.calls.filter(([url]) => String(url).includes('fa-paths'));
            expect(pathCalls).toHaveLength(1);
            spy.mockRestore();
        });
    });
});
