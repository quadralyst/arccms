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

