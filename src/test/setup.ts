/**
 * Vitest Setup File for Angular Testing
 * 
 * This file initializes the Angular testing environment for Vitest.
 */


import { ReadableStream } from 'stream/web';
(global as any).ReadableStream = ReadableStream;
import 'zone.js';
import 'zone.js/testing';

import { beforeEach } from 'vitest';
import { getTestBed, TestBed } from '@angular/core/testing';
import {
    BrowserTestingModule,
    platformBrowserTesting,
} from '@angular/platform-browser/testing';
import { translocoTestingModule } from './transloco-test-providers';

// Initialize the Angular testing environment
getTestBed().initTestEnvironment(
    BrowserTestingModule,
    platformBrowserTesting()
);

/**
 * Transloco for every spec, without 150 specs having to ask for it.
 *
 * The admin UI reads its strings through Transloco (M6), so any spec that
 * renders an admin component needs the service present — including the many
 * that render it only incidentally, through <arc-page-header> or the side
 * navbar. `configureTestingModule` accumulates across calls, so this merges
 * with whatever the spec configures next; a spec needing a different language
 * just imports `translocoTestingModule({ lang })` itself, and the later
 * configuration wins.
 */
beforeEach(() => {
    TestBed.configureTestingModule({ imports: [translocoTestingModule()] });
});


/**
 * The icon assets, for every spec that renders an icon picker.
 *
 * `arc-icon-picker` fetches `/assets/icons/fa-index.json` on init, and it is
 * pulled in incidentally by the content-type pages the way Transloco is. In
 * jsdom that relative URL has no origin to resolve against, so each spec
 * logged an ERR_INVALID_URL and silently fell back to the offline list —
 * noise that also meant no spec ever exercised the index-backed path.
 *
 * A spec that wants different icons stubs `IconLibraryService` directly;
 * this only answers requests nothing else has claimed.
 */
const realFetch = globalThis.fetch;
globalThis.fetch = ((input: any, init?: any) => {
    const url = String(typeof input === 'string' ? input : input?.url ?? '');

    if (url.startsWith('/assets/icons/fa-index.json')) {
        return Promise.resolve(new Response(JSON.stringify({
            version: 'test',
            icons: [
                { n: 'folder', l: 'Folder', s: ['solid', 'regular'], t: 'directory archive' },
                { n: 'file', l: 'File', s: ['solid', 'regular'], t: 'document page' },
                { n: 'magnifying-glass', l: 'Magnifying Glass', s: ['solid'], t: 'find zoom', a: 'search' },
                { n: 'github', l: 'GitHub', s: ['brands'], t: 'git code' },
            ],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }

    if (url.startsWith('/assets/icons/fa-paths-')) {
        const style = url.slice('/assets/icons/fa-paths-'.length).replace('.json', '');
        return Promise.resolve(new Response(JSON.stringify({
            version: 'test',
            style,
            paths: {
                folder: ['0 0 512 512', 'M64 480H448'],
                file: ['0 0 384 512', 'M0 64C0 28.7'],
                'magnifying-glass': ['0 0 512 512', 'M416 208c0 45.9'],
                github: ['0 0 496 512', 'M165.9 397.4c0 2'],
            },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }

    return realFetch(input, init);
}) as typeof fetch;
