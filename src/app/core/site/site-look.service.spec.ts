/**
 * The site look service (site-look.service.ts, specs/editor-site-look-spec.md ES2):
 * finds the entry's template as the page does, builds its scoped stylesheet once,
 * and keeps it on the page while an editor uses it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { PLATFORM_ID } from '@angular/core';
import { of, throwError } from 'rxjs';
import { SiteLookService, fieldNames } from './site-look.service';
import { setSiteManifestForTesting, siteManifest } from './site';
import { coreSiteManifest } from '../../../test/core-site';

const MAIN = `/assets/css/main.css?v=${coreSiteManifest().files['assets/css/main.css']}`;

describe('SiteLookService', () => {
    let files: Record<string, string>;
    let http: { get: ReturnType<typeof vi.fn> };
    let service: SiteLookService;

    function setUp(platform = 'browser'): void {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                { provide: HttpClient, useValue: http },
                { provide: PLATFORM_ID, useValue: platform },
            ],
        });
        service = TestBed.inject(SiteLookService);
    }

    beforeEach(() => {
        const core = coreSiteManifest();
        setSiteManifestForTesting({
            ...core,
            templates: { ...core.templates, notes: { detail: 'app' } },
            layouts: { notes: { wide: 'app' } },
        });
        const site = siteManifest().files['assets/css/site.css'];
        files = {
            [MAIN]: 'body { font-family: Georgia; } @keyframes pulse { to { opacity: .5 } }',
            [`/assets/css/site.css${site ? `?v=${site}` : ''}`]: '@import url(type.css) screen; :root { --brand: #e33; }',
            '/assets/css/type.css': 'h2 { letter-spacing: 1px; }',
            '/_site/templates/notes/detail.html':
                '<div class="page"><div class="col"><div class="note-body" [innerHTML]="content"></div><aside class="aside" [innerHTML]="extra"></aside></div></div>'
                + '<style>.note-body p { margin: 0 0 1em; } .page { background: url(bg.png); }</style>',
            '/_site/templates/notes/detail-wide.html': '<!doctype html><html><arc-root></arc-root></html>',
            '/_site/templates/default/detail.html': '<div class="article-content" [innerHTML]="content"></div><style>.article-content{}</style>',
        };
        http = {
            get: vi.fn((url: string) => (url in files ? of(files[url]) : throwError(() => new Error(`404 ${url}`)))),
        };
        // jsdom has no @scope; the browsers the look is for do.
        (globalThis as Record<string, unknown>)['CSSScopeRule'] = class {};
        setUp();
    });

    afterEach(() => {
        delete (globalThis as Record<string, unknown>)['CSSScopeRule'];
        setSiteManifestForTesting();
        document.querySelectorAll('style[data-arc-site-look]').forEach((style) => style.remove());
    });

    const request = (extra: Partial<Parameters<SiteLookService['forField']>[0]> = {}) =>
        ({ folder: 'notes', layout: '', typeSlug: 'notes', key: 'content', lang: 'en', ...extra });

    it('finds where the type\'s template puts the field, with a scope class and the language', async () => {
        const look = await service.forField(request({ lang: 'hi' }));
        expect(look).toEqual({
            chain: {
                ancestors: [{ tag: 'div', classes: ['page'], id: null }, { tag: 'div', classes: ['col'], id: null }],
                body: { tag: 'div', classes: ['note-body'], id: null },
            },
            scopeClass: 'arc-site-look-1',
            lang: 'hi',
        });
        expect((await service.forField(request({ key: 'extra' })))?.chain.body.classes).toEqual(['aside']);
    });

    it('finds a custom field by its key, else by its name without the type slug, never the body\'s place', async () => {
        files['/_site/templates/notes/detail.html'] =
            '<div class="page"><div class="note-body" [innerHTML]="content"></div><aside class="agenda" [innerHTML]="agenda"></aside>'
            + '<section class="full" data-arc-bind="notes-summary"></section><p class="bare" [innerHTML]="summary"></p></div>';
        setUp();
        expect((await service.forField(request({ key: 'notes-agenda' })))?.chain.body.classes).toEqual(['agenda']);
        expect((await service.forField(request({ key: 'notes_agenda' })))?.chain.body.classes).toEqual(['agenda']);
        // The full key wins over the bare name.
        expect((await service.forField(request({ key: 'notes-summary' })))?.chain.body.classes).toEqual(['full']);
        // A field stored as notes-content is not the body.
        expect(await service.forField(request({ key: 'notes-content' }))).toBeNull();
    });

    it('gives null in a browser without @scope, so the editor keeps its own look', async () => {
        delete (globalThis as Record<string, unknown>)['CSSScopeRule'];
        expect(await service.forField(request())).toBeNull();
        expect(http.get).not.toHaveBeenCalled();
    });

    it('gives null for a field the template does not place', async () => {
        expect(await service.forField(request({ key: 'missing' }))).toBeNull();
    });

    it('skips a layout file that is not a template, as the page does', async () => {
        const look = await service.forField(request({ layout: 'wide' }));
        expect(look?.chain.body.classes).toEqual(['note-body']);
        expect(http.get.mock.calls.map((call) => call[0])).toContain('/_site/templates/notes/detail-wide.html');
    });

    it('gives null when no template can be loaded, and on the server', async () => {
        delete files['/_site/templates/notes/detail.html'];
        delete files['/_site/templates/default/detail.html'];
        expect(await service.forField(request())).toBeNull();

        setUp('server');
        expect(await service.forField(request({ folder: 'default' }))).toBeNull();
    });

    it('builds one stylesheet from main.css, site.css with its imports, and the template, all scoped', async () => {
        const look = (await service.forField(request()))!;
        const release = service.use(look);
        const css = document.getElementById('arc-site-look-1')!.textContent!;

        const scope = '@scope (.arc-site-look.arc-site-look-1) to (.arc-editor-ui)';
        expect(css).toContain(`${scope} {\n:scope { font-family: Georgia }`);
        expect(css).toContain('@keyframes arc-site-look-1-pulse');
        expect(css).toContain(':scope { --brand: #e33 }');
        // The import is fetched, scoped and kept under its condition, before the sheet importing it.
        expect(css).toContain(`@media screen {\n${scope} {\nh2 { letter-spacing: 1px; }`);
        expect(css.indexOf('letter-spacing')).toBeLessThan(css.indexOf('--brand'));
        // The template's inline url() resolves against the page's address.
        expect(css).toContain('.page { background: url("/notes/bg.png"); }');
        expect(css.indexOf('Georgia')).toBeLessThan(css.indexOf('.note-body p'));
        expect(css).not.toContain('@import');
        release();
    });

    it('leaves out an import it cannot fetch, and still builds the look', async () => {
        delete files['/assets/css/type.css'];
        const look = (await service.forField(request()))!;
        service.use(look);
        const css = document.getElementById(look.scopeClass)!.textContent!;
        expect(css).not.toContain('letter-spacing');
        expect(css).toContain('--brand');
    });

    it('fetches each file once, and shares the stylesheet of a template and type', async () => {
        const first = await service.forField(request());
        const second = await service.forField(request({ key: 'extra', lang: 'hi' }));
        expect(second?.scopeClass).toBe(first?.scopeClass);
        const urls = http.get.mock.calls.map((call) => call[0]);
        expect(urls.length).toBe(new Set(urls).size);

        // Another type's page sits elsewhere, so its inline url()s resolve differently: its own stylesheet.
        const other = await service.forField(request({ typeSlug: 'memos' }));
        expect(other?.scopeClass).toBe('arc-site-look-2');
    });

    it('puts the stylesheet on the page once while editors use it, and takes it off with the last one', async () => {
        const look = (await service.forField(request()))!;
        const one = service.use(look);
        const two = service.use(look);
        expect(document.querySelectorAll('#arc-site-look-1')).toHaveLength(1);
        expect(document.head.lastElementChild?.id).toBe('arc-site-look-1');

        one();
        one();
        expect(document.getElementById('arc-site-look-1')).not.toBeNull();
        two();
        expect(document.getElementById('arc-site-look-1')).toBeNull();

        service.use(look);
        expect(document.getElementById('arc-site-look-1')?.textContent).toContain('note-body');
    });
});

describe('fieldNames', () => {
    it.each([
        ['content', 'events', ['content']],
        ['events-agenda', 'events', ['events-agenda', 'agenda']],
        ['events_agenda', 'events', ['events_agenda', 'agenda']],
        ['events-content', 'events', ['events-content']],
        ['events-', 'events', ['events-']],
        ['other-agenda', 'events', ['other-agenda']],
        ['agenda', '', ['agenda']],
    ])('%s on %s is looked for as %j', (key, typeSlug, names) => {
        expect(fieldNames(key, typeSlug)).toEqual(names);
    });
});
