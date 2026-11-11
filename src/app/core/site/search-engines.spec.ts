/**
 * RF6 6.3: the app shell carries no robots tag; every move adds noindex with JavaScript,
 * and only public pages lift it (content pages, and routes whose data says
 * `searchEngines: 'index'`). Hosting's header for private addresses is in
 * scripts/__tests__/firebase-hosting.spec.ts; the home page's own tag in index.page.spec.ts.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Meta } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet, Routes } from '@angular/router';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { translocoTestingModule } from '../../../test/transloco-test-providers';
import NotFoundComponent from '../../pages/not-found.page';
import { routes as appRoutes } from '../../app.routes';
import { KEEP_OUT_OF_SEARCH, LET_INTO_SEARCH, keepOutOfSearchOnEachMove, letIntoSearch } from './search-engines';

@Component({ selector: 'arc-test-root', imports: [RouterOutlet], template: '<router-outlet />' })
class Root {
    constructor() { keepOutOfSearchOnEachMove(); }
}

@Component({ selector: 'arc-test-content', template: '' })
class ContentPage {
    constructor() { letIntoSearch(TestBed.inject(Meta)); }
}

@Component({ selector: 'arc-test-page', template: '' })
class PlainPage {}

const robots = () => document.head.querySelector('meta[name="robots"]')?.getAttribute('content') ?? null;

async function app(routes: Routes): Promise<(url: string) => Promise<void>> {
    TestBed.configureTestingModule({ imports: [translocoTestingModule()], providers: [provideRouter(routes)] });
    const fixture = TestBed.createComponent(Root);
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    return async (url: string) => {
        await router.navigateByUrl(url);
        fixture.detectChanges();
    };
}

const ROUTES: Routes = [
    { path: 'articles/one', component: ContentPage },
    { path: 'pricing', component: PlainPage, data: { searchEngines: 'index' } },
    { path: 'shop', children: [{ path: 'list', component: PlainPage, data: { searchEngines: 'index' } }] },
    { path: 'admin', component: PlainPage },
    { path: '**', component: NotFoundComponent },
];

describe('search engines and the app', () => {
    beforeEach(() => document.head.querySelector('meta[name="robots"]')?.remove());

    it('ships the shell with no robots tag, so search engines render its pages', () => {
        const shell = readFileSync(join(__dirname, '../../../../index.html'), 'utf8');
        const doc = new DOMParser().parseFromString(shell, 'text/html');
        expect(doc.querySelector('meta[name="robots"]')).toBeNull();
    });

    it('lets a content page in, and adds noindex again on the next move', async () => {
        const go = await app(ROUTES);
        await go('/articles/one');
        expect(robots()).toBe(LET_INTO_SEARCH);
        await go('/admin');
        expect(robots()).toBe(KEEP_OUT_OF_SEARCH);
    });

    it('lets a route whose data says searchEngines: index in, a child route too', async () => {
        const go = await app(ROUTES);
        await go('/pricing');
        expect(robots()).toBe(LET_INTO_SEARCH);
        await go('/admin');
        expect(robots()).toBe(KEEP_OUT_OF_SEARCH);
        await go('/shop/list');
        expect(robots()).toBe(LET_INTO_SEARCH);
    });

    it('keeps an unknown address out of search, through the not-found page', async () => {
        const go = await app(ROUTES);
        await go('/articles/one');
        await go('/no-such-page');
        expect(robots()).toBe(KEEP_OUT_OF_SEARCH);
    });

    it('marks core\'s public /pricing and /waitlist routes as listable, and not setup', () => {
        const listable = (path: string) => appRoutes.find((r) => r.path === path)?.data?.['searchEngines'];
        expect(listable('pricing')).toBe('index');
        expect(listable('waitlist')).toBe('index');
        expect(listable('waitlist/:waitlistId')).toBe('index');
        expect(listable('onboarding')).toBeUndefined();
    });
});
