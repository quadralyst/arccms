/**
 * Content, More Pages (more-pages.service.ts, specs/visual-editing-spec.md VE-D48).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { setSiteManifestForTesting } from '../../../core/site/site';
import { PageTextService } from '../../../core/site/page-text.service';
import { Firestore } from '@angular/fire/firestore';
import { HoldService } from '../../../core/editing/hold.service';
import { MorePagesService, morePageStatus } from './more-pages.service';

const at = (ms: number) => ({ toMillis: () => ms });

const types = vi.hoisted(() => ({ list: [] as Record<string, any>[], fails: false }));
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class {},
    collection: () => ({}),
    getDocs: async () => {
        if (types.fails) throw new Error('offline');
        return { docs: types.list.map((type) => ({ id: type['id'], data: () => type })) };
    },
}));

describe('MorePagesService', () => {
    const FRAGMENT = '<div class="arc-cms-template"><h1>List</h1></div>';
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
                { provide: Firestore, useValue: {} },
                { provide: HoldService, useValue: { me: () => ({ uid: 'me' }) } },
                { provide: HttpClient, useValue: { get: vi.fn((path: string) => (files[path] ? of(files[path]) : throwError(() => new Error('404')))) } },
                { provide: PageTextService, useValue: { draft: vi.fn(async (id: string) => drafts[id] ?? null), published: vi.fn(async (id: string) => published[id] ?? null) } },
            ],
        });
    });
    afterEach(() => setSiteManifestForTesting());

    it('lists the home page first, then only the static pages with an area to change', async () => {
        drafts['home'] = { updatedAt: at(5), text: { en: { hero: { value: 'New' } } } };
        published['home'] = { draftUpdatedAt: at(4), publishedAt: at(4000) };
        published['p-about-us'] = { draftUpdatedAt: at(1), publishedAt: at(2000) };
        drafts['p-about-us'] = { updatedAt: at(1) };
        const rows = await TestBed.inject(MorePagesService).list();
        expect(rows).toEqual([
            { pageId: 'home', kind: 'home', name: '', title: '', address: '/', status: 'changes', lastPublished: 4000 },
            { pageId: 'p-about-us', kind: 'static', name: 'about-us', title: 'About us', address: '/p/about-us', status: 'published', lastPublished: 2000 },
        ]);
    });

    it('lists the list page of every type with public pages, after the home page (VE-D65)', async () => {
        types.list = [
            { id: 't1', slug: 'recipes', name: 'Recipes' },
            { id: 't2', slug: 'articles', name: 'Articles', hasPublicUrl: true },
            { id: 't3', slug: 'quotes', name: 'Quotes', hasPublicUrl: false },
        ];
        drafts['list-articles'] = { updatedAt: at(5), text: { en: { title: { value: 'Our stories' } } }, editing: { by: 'priya', name: 'Priya' } };
        try {
            const rows = await TestBed.inject(MorePagesService).list();
            expect(rows.map((row) => row.pageId)).toEqual(['home', 'list-articles', 'list-recipes', 'p-about-us']);
            expect(rows[1]).toEqual({
                pageId: 'list-articles', kind: 'list', name: 'articles', title: 'Articles', address: '/articles', status: 'changes', lastPublished: null, heldBy: 'Priya',
            });
            expect(rows[2]).toMatchObject({ status: 'file', lastPublished: null });
        } finally {
            types.list = [];
            delete drafts['list-articles'];
        }
    });

    it('lists the home page and the static pages when the content types cannot be read', async () => {
        types.fails = true;
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        try {
            expect((await TestBed.inject(MorePagesService).list()).map((row) => row.pageId)).toEqual(['home', 'p-about-us']);
        } finally {
            types.fails = false;
        }
    });

    it('reads a type\'s list template as its page does: its folder\'s, else the default one\'s', async () => {
        setSiteManifestForTesting({ version: 1, home: {}, templates: { default: { list: 'core' }, blog: { list: 'app' }, shop: { list: 'app' } } as never, strings: [], files: {}, pages: {} });
        files['/_site/templates/default/list.html'] = FRAGMENT;
        files['/_site/templates/blog/list.html'] = FRAGMENT.replace('List', 'Blog');
        // A missing file answers with the app shell.
        files['/_site/templates/shop/list.html'] = '<!doctype html><html><body><app-root></app-root></body></html>';
        const service = TestBed.inject(MorePagesService);
        expect(await service.listTemplate('blog')).toContain('Blog');
        expect(await service.listTemplate('shop')).toBe(FRAGMENT);
        expect(await service.listTemplate('')).toBe(FRAGMENT);
        delete files['/_site/templates/default/list.html'];
        expect(await service.listTemplate('shop')).toBe('');
    });

    it('tells where a page stands', () => {
        expect(morePageStatus(null, null)).toBe('file');
        expect(morePageStatus({ updatedAt: at(2), text: { en: { hero: { value: 'New' } } } }, null)).toBe('changes');
        // Saved since, and the same words: nothing to publish (VE6.B1).
        expect(morePageStatus({ updatedAt: at(3), text: { en: { hero: { value: 'A' } } } }, { draftUpdatedAt: at(2), text: { en: { hero: { value: 'A' } } } })).toBe('published');
        expect(morePageStatus({ updatedAt: at(2) }, { draftUpdatedAt: at(2) })).toBe('published');
        expect(morePageStatus(null, { draftUpdatedAt: at(2) })).toBe('published');
    });
});
