/**
 * Content, More Pages (more-pages.service.ts, specs/visual-editing-spec.md VE-D48).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { setSiteManifestForTesting } from '../../../core/site/site';
import { PageTextService } from '../../../core/site/page-text.service';
import { MorePagesService, morePageStatus } from './more-pages.service';

const at = (ms: number) => ({ toMillis: () => ms });

describe('MorePagesService', () => {
    const files: Record<string, string> = {
        '/_site/pages/about-us.html': '<html><head><title>About us</title></head><body><h1 data-arc-edit="heading">About</h1></body></html>',
        '/_site/pages/privacy-policy.html': '<html><body><h1>Privacy</h1></body></html>',
        '/_site/pages/terms.html': '<html><body><script data-arc-edit="x">1</script></body></html>',
    };
    const drafts: Record<string, unknown> = {};
    const published: Record<string, unknown> = {};

    beforeEach(() => {
        setSiteManifestForTesting({ version: 1, home: {}, templates: {}, strings: [], files: {}, pages: { 'about-us': 'app', 'privacy-policy': 'core', terms: 'app', missing: 'app' } });
        TestBed.configureTestingModule({
            providers: [
                { provide: HttpClient, useValue: { get: vi.fn((path: string) => (files[path] ? of(files[path]) : throwError(() => new Error('404')))) } },
                { provide: PageTextService, useValue: { draft: vi.fn(async (id: string) => drafts[id] ?? null), published: vi.fn(async (id: string) => published[id] ?? null) } },
            ],
        });
    });
    afterEach(() => setSiteManifestForTesting());

    it('lists the home page first, then only the static pages with an area to change', async () => {
        drafts['home'] = { updatedAt: at(5) };
        published['home'] = { draftUpdatedAt: at(4), publishedAt: at(4000) };
        published['p-about-us'] = { draftUpdatedAt: at(1), publishedAt: at(2000) };
        drafts['p-about-us'] = { updatedAt: at(1) };
        const rows = await TestBed.inject(MorePagesService).list();
        expect(rows).toEqual([
            { pageId: 'home', kind: 'home', name: '', title: '', address: '/', status: 'changes', lastPublished: 4000 },
            { pageId: 'p-about-us', kind: 'static', name: 'about-us', title: 'About us', address: '/p/about-us', status: 'published', lastPublished: 2000 },
        ]);
    });

    it('tells where a page stands', () => {
        expect(morePageStatus(null, null)).toBe('file');
        expect(morePageStatus({ updatedAt: at(2) }, null)).toBe('changes');
        expect(morePageStatus({ updatedAt: at(2) }, { draftUpdatedAt: at(2) })).toBe('published');
        expect(morePageStatus(null, { draftUpdatedAt: at(2) })).toBe('published');
    });
});
