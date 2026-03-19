/**
 * Vitest Setup File for Angular Testing
 * 
 * This file initializes the Angular testing environment for Vitest.
 */


import { ReadableStream } from 'stream/web';
(global as any).ReadableStream = ReadableStream;
import 'zone.js';
import 'zone.js/testing';

import { getTestBed } from '@angular/core/testing';
import {
    BrowserTestingModule,
    platformBrowserTesting,
} from '@angular/platform-browser/testing';

// Initialize the Angular testing environment
getTestBed().initTestEnvironment(
    BrowserTestingModule,
    platformBrowserTesting()
);

