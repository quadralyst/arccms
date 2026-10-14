import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ChangeDetectorRef, signal } from '@angular/core';
import { PublicPageRendererComponent } from './public-page-renderer.component';
import { HttpClientTestingModule, HttpTestingController } from '@angular/common/http/testing';
import { ActivatedRoute, Router } from '@angular/router';
import { Title, Meta } from '@angular/platform-browser';
import { BehaviorSubject, EMPTY } from 'rxjs';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

import { GaTrackingService } from '../../../shared/services/ga-tracking.service';
import { LocalizationService } from '../../core/services/localization.service';
import { setSiteManifestForTesting } from '../../core/site/site';

// A plain header and footer, not the app's own: an app's may hold card blocks,
// which read Firestore, and these tests are about the page between them.
vi.mock('virtual:arc-site', async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    header: '<header class="site-header"><a href="/">Home</a></header>',
    footer: '<footer class="site-footer"><a href="/">Home</a></footer>',
}));

describe('PublicPageRendererComponent', () => {
    let component: PublicPageRendererComponent;
    let fixture: ComponentFixture<PublicPageRendererComponent>;
    let httpMock: HttpTestingController;
    let router: Router;
    let titleService: Title;
    let metaService: Meta;
    let mockGaTrackingService: any;

    // Spy objects
    // The header's language switcher reads `url` and subscribes to `events`.
    const routerSpy = { navigate: vi.fn(), url: '/', events: EMPTY };
    const titleSpy = { setTitle: vi.fn() };
    const metaSpy = { updateTag: vi.fn() };

    // Fresh per test: a shared subject would keep feeding components from
    // earlier tests whose injectors are already destroyed.
    let paramsSubject: BehaviorSubject<any>;

    // The header (language switcher, public search) loads localization
    // settings; a single-language stub keeps these tests off Firestore.
    const mockLocalization = {
        load: vi.fn().mockResolvedValue(undefined),
        enabledLanguages: signal([]),
        defaultLanguage: signal('en'),
        languageVariants: signal(null),
    };

    beforeEach(async () => {
        // Clear mocks before each test
        vi.clearAllMocks();
        // The pages these tests open, as the site's manifest lists them.
        setSiteManifestForTesting({
            version: 1, home: {}, templates: {}, strings: [], files: {},
            pages: { 'test-page': 'app', 'regression-test': 'app', other: 'app', 'error-page': 'core' },
        });

        paramsSubject = new BehaviorSubject<any>({ fileName: 'test-page' });
        const mockActivatedRoute = {
            params: paramsSubject.asObservable()
        };

        mockGaTrackingService = {
            trackPublicPageView: vi.fn()
        };

        await TestBed.configureTestingModule({
            imports: [PublicPageRendererComponent, HttpClientTestingModule],
            providers: [
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: Router, useValue: routerSpy },
                { provide: Title, useValue: titleSpy },
                { provide: Meta, useValue: metaSpy },
                { provide: GaTrackingService, useValue: mockGaTrackingService },
                { provide: LocalizationService, useValue: mockLocalization }
            ]
        }).compileComponents();

        httpMock = TestBed.inject(HttpTestingController);
        router = TestBed.inject(Router);
        titleService = TestBed.inject(Title);
        metaService = TestBed.inject(Meta);
    });

    afterEach(() => {
        if (httpMock) {
            httpMock.verify();
        }
        setSiteManifestForTesting();
    });

    function createComponent() {
        fixture = TestBed.createComponent(PublicPageRendererComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    }

    it('should create', () => {
        paramsSubject.next({ fileName: 'test-page' });
        createComponent();
        expect(component).toBeTruthy();
        const req = httpMock.expectOne('/_site/pages/test-page.html');
        req.flush('');
    });

    it('should fetch page and process content correctly', () => {
        paramsSubject.next({ fileName: 'test-page' });
        createComponent();

        const mockHtml = `
      <html>
        <head>
          <title>Test Title</title>
          <meta name="description" content="Test Desc">
        </head>
        <body>
          <arc-header></arc-header>
          <h1>Content</h1>
          <arc-footer></arc-footer>
        </body>
      </html>
    `;

        const req = httpMock.expectOne('/_site/pages/test-page.html');
        req.flush(mockHtml);

        expect(titleSpy.setTitle).toHaveBeenCalledWith('Test Title');
        expect(metaSpy.updateTag).toHaveBeenCalledWith({ name: 'description', content: 'Test Desc' });
        expect(component.hasHeader).toBe(true);
        expect(component.hasFooter).toBe(true);
    });

    // specs/form-gamification-spec.md G-D4: the default language's strings file words a static page.
    it('applies the default language\'s strings file to a page that uses data-arc-t', async () => {
        setSiteManifestForTesting({
            version: 1, home: {}, templates: {}, strings: ['en'], files: {},
            pages: { 'test-page': 'app' },
        });
        mockLocalization.load.mockResolvedValue({ defaultLanguage: 'en' });
        paramsSubject.next({ fileName: 'test-page' });
        createComponent();

        httpMock.expectOne('/_site/pages/test-page.html').flush('<body><h1 data-arc-t="page_heading">Hello</h1></body>');
        await new Promise((resolve) => setTimeout(resolve, 0));
        httpMock.expectOne('/_site/strings/en.json').flush({ page_heading: 'Welcome aboard' });
        await new Promise((resolve) => setTimeout(resolve, 0));
        fixture.detectChanges();

        expect((fixture.nativeElement as HTMLElement).textContent).toContain('Welcome aboard');
        mockLocalization.load.mockResolvedValue(undefined);
    });

    it('should trigger change detection after content loads (regression test)', () => {
        // This test ensures that detectChanges is called manually after the async fetch
        // preventing the blank page issue in SSG/SSR scenarios.
        paramsSubject.next({ fileName: 'regression-test' });
        createComponent();

        // Spy on the private cdr property
        const cdr = (component as any).cdr;
        const detectChangesSpy = vi.spyOn(cdr, 'detectChanges');

        const mockHtml = '<body><p>Updated Content</p></body>';
        const req = httpMock.expectOne('/_site/pages/regression-test.html');
        req.flush(mockHtml);

        expect(detectChangesSpy).toHaveBeenCalled();
    });

    it('should handle extension in fileName', () => {
        paramsSubject.next({ fileName: 'other.html' });
        createComponent();

        const req = httpMock.expectOne('/_site/pages/other.html');
        req.flush('<div>Content</div>');
    });

    it('should redirect to 404 on error', () => {
        paramsSubject.next({ fileName: 'error-page' });
        createComponent();

        const req = httpMock.expectOne('/_site/pages/error-page.html');
        req.flush('Not Found', { status: 404, statusText: 'Not Found' });

        expect(routerSpy.navigate).toHaveBeenCalledWith(['/404']);
    });

    it('takes only the site\'s own pages from its manifest, not names every object has', () => {
        for (const fileName of ['constructor', '__proto__', 'toString', 'hasOwnProperty']) {
            routerSpy.navigate.mockClear();
            paramsSubject.next({ fileName });
            createComponent();
            httpMock.expectNone(`/_site/pages/${fileName}.html`);
            expect(routerSpy.navigate).toHaveBeenCalledWith(['/404']);
            fixture.destroy();
        }
    });

    it('goes to the not-found page without a request for a page the site does not have', () => {
        paramsSubject.next({ fileName: 'no-such-page' });
        createComponent();

        httpMock.expectNone('/_site/pages/no-such-page.html');
        expect(routerSpy.navigate).toHaveBeenCalledWith(['/404']);
    });

    // A hand-written page's own <head>: its styles and scripts, as when published.
    describe('the page\'s own styles and scripts', () => {
        const ran = () => ((window as any).__arcPageRan ??= []) as string[];
        const PAGE = `<!DOCTYPE html><html><head>
            <title>Launch</title>
            <link rel="canonical" href="https://example.com/launch">
            <link rel="icon" href="/favicon.ico">
            <link rel="preconnect" href="https://fonts.googleapis.com">
            <link href="https://fonts.googleapis.com/css2?family=Poppins" rel="stylesheet">
            <style>.hero { min-height: 80vh; }</style>
            <script type="application/ld+json">{"@type":"Event"}</script>
            <script>window.__arcPageRan.push('head');</script>
        </head><body>
            <arc-header></arc-header>
            <section class="hero">Hi</section>
            <script>window.__arcPageRan.push('body ' + !!document.querySelector('.public-page-content .hero'));</script>
            <arc-footer></arc-footer>
        </body></html>`;
        const added = () => Array.from(document.head.querySelectorAll('[data-arc-page-head]'));

        beforeEach(() => { (window as any).__arcPageRan = []; });
        afterEach(() => {
            fixture?.destroy();
            delete (window as any).__arcPageRan;
        });

        function open(html: string, platform = 'browser') {
            paramsSubject.next({ fileName: 'test-page' });
            createComponent();
            // Where the page is drawn, read when it arrives.
            (component as any).platformId = platform;
            httpMock.expectOne('/_site/pages/test-page.html').flush(html);
        }

        it('keeps its stylesheets, <style> blocks and font links, after the app\'s styles', () => {
            const appSheet = document.createElement('link');
            appSheet.rel = 'stylesheet';
            appSheet.href = '/assets/css/site.css';
            document.head.appendChild(appSheet);
            open(PAGE);

            const styles = added().filter((el) => el.tagName !== 'SCRIPT');
            expect(styles.map((el) => el.outerHTML)).toEqual([
                '<link rel="preconnect" href="https://fonts.googleapis.com" data-arc-page-head="">',
                '<link href="https://fonts.googleapis.com/css2?family=Poppins" rel="stylesheet" data-arc-page-head="">',
                '<style data-arc-page-head="">.hero { min-height: 80vh; }</style>',
            ]);
            // After the app's own stylesheets, so the page's rules win.
            expect(appSheet.compareDocumentPosition(styles[0]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
            // Not the page's canonical or icon: the app's head keeps its own.
            expect(document.head.querySelector('link[rel="canonical"][data-arc-page-head]')).toBeNull();
            appSheet.remove();
        });

        it('runs its scripts once, in document order, after the page is drawn', () => {
            open(PAGE);
            expect(ran()).toEqual(['head', 'body true']);

            fixture.detectChanges();
            expect(ran()).toEqual(['head', 'body true']);
            // Data such as JSON-LD is not run.
            expect(added().some((el) => el.getAttribute('type') === 'application/ld+json')).toBe(false);
        });

        it('waits for a script it loads before running the next', async () => {
            open(`<html><head><script src="/site/pages/lib.js"></script></head>
                <body><p>Page</p><script>window.__arcPageRan.push('after lib');</script></body></html>`);

            const lib = document.head.querySelector('script[src="/site/pages/lib.js"]') as HTMLScriptElement;
            expect(lib).not.toBeNull();
            await Promise.resolve();
            expect(ran()).toEqual([]);

            lib.dispatchEvent(new Event('load'));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(ran()).toEqual(['after lib']);
        });

        it('takes what it added out of the head when the page is left', () => {
            open(PAGE);
            expect(added().length).toBeGreaterThan(0);

            fixture.destroy();
            expect(added()).toEqual([]);
        });

        it('stops loading a page\'s scripts once it is left', async () => {
            open(`<html><head><script src="/site/pages/lib.js"></script></head>
                <body><script>window.__arcPageRan.push('after lib');</script></body></html>`);
            const lib = document.head.querySelector('script[src="/site/pages/lib.js"]') as HTMLScriptElement;

            fixture.destroy();
            lib.dispatchEvent(new Event('load'));
            await new Promise((resolve) => setTimeout(resolve, 0));
            expect(ran()).toEqual([]);
        });

        it('skips a nomodule script, which a browser with modules never loads, and runs the next', async () => {
            open(`<html><head><script nomodule src="/site/pages/legacy.js"></script>
                <script>window.__arcPageRan.push('after legacy');</script></head><body><p>Page</p></body></html>`);
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(ran()).toEqual(['after legacy']);
            expect(document.head.querySelector('script[src="/site/pages/legacy.js"]')).toBeNull();
        });

        /** A page that waits for the default language's strings file before it is drawn. */
        const WORDED = `<html><head><style>.worded { color: red; }</style>
            <script>window.__arcPageRan.push('worded');</script></head>
            <body><h1 data-arc-t="page_heading">Hello</h1></body></html>`;

        async function openWorded(): Promise<void> {
            setSiteManifestForTesting({
                version: 1, home: {}, templates: {}, strings: ['en'], files: {},
                pages: { 'test-page': 'app', other: 'app' },
            });
            mockLocalization.load.mockResolvedValue({ defaultLanguage: 'en' });
            open(WORDED);
            await new Promise((resolve) => setTimeout(resolve, 0));
        }

        afterEach(() => mockLocalization.load.mockResolvedValue(undefined));

        it('draws nothing of a page left while its strings were still loading', async () => {
            await openWorded();
            const strings = httpMock.expectOne('/_site/strings/en.json');

            fixture.destroy();
            strings.flush({ page_heading: 'Welcome' });
            await new Promise((resolve) => setTimeout(resolve, 0));

            expect(added()).toEqual([]);
            expect(ran()).toEqual([]);
        });

        it('draws only the page opened next, when the one before was still loading its strings', async () => {
            await openWorded();
            const strings = httpMock.expectOne('/_site/strings/en.json');

            paramsSubject.next({ fileName: 'other' });
            httpMock.expectOne('/_site/pages/other.html')
                .flush('<html><head><style>.other { color: blue; }</style></head><body><p class="other">Other</p></body></html>');
            strings.flush({ page_heading: 'Welcome' });
            await new Promise((resolve) => setTimeout(resolve, 0));
            fixture.detectChanges();

            expect(added().map((el) => el.textContent)).toEqual(['.other { color: blue; }']);
            expect(ran()).toEqual([]);
            const content = (fixture.nativeElement as HTMLElement).querySelector('.public-page-content')!;
            expect(content.textContent).toContain('Other');
            expect(content.textContent).not.toContain('Hello');
        });

        it('adds and runs nothing when rendered on the server', () => {
            open(PAGE, 'server');

            expect(added()).toEqual([]);
            expect(ran()).toEqual([]);
        });
    });
});
