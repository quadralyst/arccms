/**
 * Versioned links to the site's files (site-urls.ts), the same in the app's
 * preview and on published pages (functions/src/shared/site-urls.ts).
 */
import { describe, it, expect } from 'vitest';
import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { firstValueFrom } from 'rxjs';
import { versionSiteUrls } from './site-urls';
import { versionSiteUrls as versionSiteUrlsServer } from '../../../../functions/src/shared/site-urls';
import { siteFilesInterceptor } from './site-files.interceptor';
import { setSiteManifestForTesting, siteManifest } from './site';

const FILES = { 'site/home.css': 'c1', 'site/hero.webp': 'h1', 'site/hero@2x.webp': 'h2', 'site/home.js': 'j1', 'assets/css/main.css': 'm1' };

describe('versionSiteUrls', () => {
    it('versions the site\'s files in src, href, poster and srcset', () => {
        const html = '<link rel="stylesheet" href="/site/home.css"><script src="/site/home.js" defer></script>'
            + '<img src="/site/hero.webp" srcset="/site/hero.webp 1x, /site/hero@2x.webp 2x"><video poster=\'/site/hero.webp\'></video>';
        expect(versionSiteUrls(html, FILES)).toBe(
            '<link rel="stylesheet" href="/site/home.css?v=c1"><script src="/site/home.js?v=j1" defer></script>'
            + '<img src="/site/hero.webp?v=h1" srcset="/site/hero.webp?v=h1 1x, /site/hero@2x.webp?v=h2 2x"><video poster=\'/site/hero.webp?v=h1\'></video>');
    });

    it('leaves pages, other sites, unlisted files and links that already have a query', () => {
        const html = '<a href="/articles">A</a><a href="https://x.test/site/home.css">X</a><img src="/site/missing.png">'
            + '<link href="/assets/css/main.css?v=old"><img src="site/hero.webp">';
        expect(versionSiteUrls(html, FILES)).toBe(html);
    });

    it('keeps a fragment after the version', () => {
        expect(versionSiteUrls('<a href="/site/home.css#x">c</a>', FILES)).toBe('<a href="/site/home.css?v=c1#x">c</a>');
    });

    it('does nothing without a file list', () => {
        expect(versionSiteUrls('<img src="/site/hero.webp">', null)).toBe('<img src="/site/hero.webp">');
    });

    it('agrees with the publish functions', () => {
        const html = '<link href="/site/home.css"><img src="/site/hero.webp" srcset="/site/hero.webp 1x, /site/hero@2x.webp 2x"><a href="/articles">A</a>';
        expect(versionSiteUrls(html, FILES)).toBe(versionSiteUrlsServer(html, FILES));
    });
});

describe('siteFilesInterceptor', () => {
    it('versions the links in the site pages the app fetches, and nothing else', async () => {
        setSiteManifestForTesting({ ...siteManifest(), files: FILES });
        TestBed.configureTestingModule({
            providers: [provideHttpClient(withInterceptors([siteFilesInterceptor])), provideHttpClientTesting()],
        });
        const http = TestBed.inject(HttpClient);
        const backend = TestBed.inject(HttpTestingController);

        const page = firstValueFrom(http.get('/_site/templates/default/detail.html', { responseType: 'text' }));
        backend.expectOne('/_site/templates/default/detail.html').flush('<img src="/site/hero.webp">');
        expect(await page).toBe('<img src="/site/hero.webp?v=h1">');

        // Absolute, as Analog's request interceptor makes it in the browser.
        const absolute = firstValueFrom(http.get('http://localhost:5173/_site/home.html', { responseType: 'text' }));
        backend.expectOne('http://localhost:5173/_site/home.html').flush('<link href="/site/home.css">');
        expect(await absolute).toBe('<link href="/site/home.css?v=c1">');

        const other = firstValueFrom(http.get('/api/thing.html', { responseType: 'text' }));
        backend.expectOne('/api/thing.html').flush('<img src="/site/hero.webp">');
        expect(await other).toBe('<img src="/site/hero.webp">');
        setSiteManifestForTesting();
    });
});
