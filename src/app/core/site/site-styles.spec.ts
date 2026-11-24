/**
 * The website's stylesheets are on only while a page of the website is shown, so
 * they never style the admin area or the member area (site-styles.ts).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { EMPTY_SHEET, SITE_STYLES_WAIT_CLASS, SITE_STYLES_WAIT_MS, SiteStylesService, signInSheet } from './site-styles';
import { setSiteManifestForTesting, siteManifest } from './site';

describe('SiteStylesService', () => {
    let service: SiteStylesService;
    const link = (sheet: string) => document.getElementById(`arc-site-css-${sheet}`) as HTMLLinkElement | null;

    beforeEach(() => {
        document.querySelectorAll('[id^="arc-site-css-"]').forEach((el) => el.remove());
        service = TestBed.inject(SiteStylesService);
    });

    it('adds each sheet once, versioned by its hash', () => {
        service.use(['main', 'site']);
        service.use(['main']);
        expect(document.querySelectorAll('#arc-site-css-main')).toHaveLength(1);
        expect(link('main')!.getAttribute('href')).toBe(`/assets/css/main.css?v=${siteManifest().files['assets/css/main.css']}`);
        expect(link('site')!.getAttribute('href')).toBe(`/assets/css/site.css?v=${siteManifest().files['assets/css/site.css']}`);
    });

    it('switches a sheet off when the last page using it goes, and on again', () => {
        const home = service.use(['main', 'site']);
        const signIn = service.use(['site']);
        home();
        expect(link('main')!.disabled).toBe(true);
        expect(link('site')!.disabled).toBe(false);
        signIn();
        expect(link('site')!.disabled).toBe(true);

        service.use(['site']);
        expect(link('site')!.disabled).toBe(false);
    });

    it('ignores a second release', () => {
        const a = service.use(['site']);
        service.use(['site']);
        a();
        a();
        expect(link('site')!.disabled).toBe(false);
    });

    it('gives the sign-in page the app\'s sign-in.css when it has one, else its site.css', () => {
        expect(signInSheet({ 'assets/css/site.css': 'a' })).toBe('site');
        expect(signInSheet({ 'assets/css/site.css': 'a', 'assets/css/sign-in.css': 'b' })).toBe('sign-in');
        service.use(['sign-in']);
        expect(link('sign-in')!.getAttribute('href')).toMatch(/^\/assets\/css\/sign-in\.css(\?v=\w+)?$/);
    });

    it('reuses a link already in a prerendered page', () => {
        const existing = document.createElement('link');
        existing.id = 'arc-site-css-main';
        existing.href = '/assets/css/main.css?v=prerendered';
        document.head.appendChild(existing);
        service.use(['main']);
        expect(document.querySelectorAll('#arc-site-css-main')).toHaveLength(1);
        expect(link('main')!.getAttribute('href')).toBe('/assets/css/main.css?v=prerendered');
    });
});

/** F51: nobody sees Arc CMS's look before the app's, and no stylesheet keeps anyone waiting for good. */
describe('SiteStylesService: the page waits for its stylesheets', () => {
    let service: SiteStylesService;
    const link = (sheet: string) => document.getElementById(`arc-site-css-${sheet}`) as HTMLLinkElement;
    const waiting = () => document.documentElement.classList.contains(SITE_STYLES_WAIT_CLASS);
    const files = (extra: Record<string, string>) => setSiteManifestForTesting({
        ...siteManifest(), files: { 'assets/css/main.css': 'aaaa', 'assets/css/site.css': 'bbbb', ...extra },
    });
    /** The browser has read the sheet: its rules apply. */
    const loaded = (el: HTMLLinkElement) => Object.defineProperty(el, 'sheet', { value: {}, configurable: true });

    beforeEach(() => {
        vi.useFakeTimers();
        document.querySelectorAll('[id^="arc-site-css-"]').forEach((el) => el.remove());
        document.documentElement.classList.remove(SITE_STYLES_WAIT_CLASS);
        files({});
        service = TestBed.inject(SiteStylesService);
    });

    afterEach(() => {
        vi.useRealTimers();
        setSiteManifestForTesting();
        document.documentElement.classList.remove(SITE_STYLES_WAIT_CLASS);
    });

    it('is not shown before the file loads, and is shown then', () => {
        service.use(['site']);
        expect(waiting()).toBe(true);
        vi.advanceTimersByTime(SITE_STYLES_WAIT_MS - 1);
        expect(waiting()).toBe(true);
        link('site').dispatchEvent(new Event('load'));
        expect(waiting()).toBe(false);
    });

    it('waits for every sheet of the page', () => {
        service.use(['main', 'site']);
        link('main').dispatchEvent(new Event('load'));
        expect(waiting()).toBe(true);
        link('site').dispatchEvent(new Event('load'));
        expect(waiting()).toBe(false);
    });

    it('is shown when the file fails, and asks for it again on the next visit', () => {
        const first = service.use(['site']);
        const broken = link('site');
        broken.dispatchEvent(new Event('error'));
        expect(waiting()).toBe(false);
        first();
        service.use(['site']);
        expect(link('site')).not.toBe(broken);
        expect(document.querySelectorAll('#arc-site-css-site')).toHaveLength(1);
        expect(waiting()).toBe(true);
    });

    it('keeps a sheet that is in when only something it imports failed', () => {
        const first = service.use(['site']);
        const sheet = link('site');
        loaded(sheet);
        sheet.dispatchEvent(new Event('error'));
        first();
        service.use(['site']);
        expect(link('site')).toBe(sheet);
        expect(waiting()).toBe(false);
    });

    it('waits for what the sheet imports: until then the browser draws none of it', () => {
        const imported = { type: CSSRule.IMPORT_RULE, styleSheet: null as unknown };
        service.warmSignIn();
        Object.defineProperty(link('site'), 'sheet', { value: { cssRules: [imported, { type: CSSRule.STYLE_RULE }] }, configurable: true });
        service.use(['site']);
        expect(waiting()).toBe(true);
        imported.styleSheet = {};
        // Seen even when the browser says nothing.
        vi.advanceTimersByTime(200);
        expect(waiting()).toBe(false);
    });

    it('is shown after the limit, and the next page does not wait for that file again', () => {
        const first = service.use(['site']);
        vi.advanceTimersByTime(SITE_STYLES_WAIT_MS);
        expect(waiting()).toBe(false);
        first();
        service.use(['site']);
        expect(waiting()).toBe(false);
    });

    it('has a short limit', () => {
        expect(SITE_STYLES_WAIT_MS).toBeLessThanOrEqual(2000);
    });

    it('does not wait for a sheet that is loaded, as on a second visit', () => {
        const first = service.use(['site']);
        loaded(link('site'));
        link('site').dispatchEvent(new Event('load'));
        first();
        service.use(['site']);
        expect(link('site').disabled).toBe(false);
        expect(waiting()).toBe(false);
    });

    it('does not wait for an empty sheet: an app with no styles of its own', () => {
        expect(createHash('sha256').update('').digest('hex').slice(0, 16)).toBe(EMPTY_SHEET);
        files({ 'assets/css/site.css': EMPTY_SHEET });
        service.use(['site']);
        expect(waiting()).toBe(false);
    });

    it('does not wait on the server, which draws the page for the browser to style', () => {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({ providers: [{ provide: PLATFORM_ID, useValue: 'server' }] });
        TestBed.inject(SiteStylesService).use(['site']);
        expect(waiting()).toBe(false);
    });

    it('stops waiting when the page goes, and a second component of a page shares its wait', () => {
        const header = service.use(['site']);
        const footer = service.use(['site']);
        header();
        expect(waiting()).toBe(true);
        footer();
        expect(waiting()).toBe(false);
        // Nothing left running.
        expect(vi.getTimerCount()).toBe(0);
    });

    it('works out the new look before it shows the page, so nothing fades in from the old one', () => {
        service.use(['site']);
        let hiddenThen: boolean | null = null;
        const read = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => {
            hiddenThen = waiting();
            return 0;
        });
        link('site').dispatchEvent(new Event('load'));
        read.mockRestore();
        expect(hiddenThen).toBe(true);
    });

    it('hides the page with nothing fading while it waits, in the styles every page starts with', () => {
        const css = readFileSync(resolve(__dirname, '../../../styles.css'), 'utf8');
        const rule = new RegExp(`html\\.${SITE_STYLES_WAIT_CLASS} \\.arc-route-host,\\s*html\\.${SITE_STYLES_WAIT_CLASS} \\.arc-route-host \\* \\{([^}]*)\\}`).exec(css);
        expect(rule?.[1]).toContain('visibility: hidden !important');
        expect(rule?.[1]).toContain('transition: none !important');
    });

    describe('warmSignIn()', () => {
        it('loads the sign-in page\'s sheet for no screen, then the page opens with no wait', () => {
            service.warmSignIn();
            service.warmSignIn();
            expect(document.querySelectorAll('#arc-site-css-site')).toHaveLength(1);
            expect(link('site').media).toBe('not all');
            expect(waiting()).toBe(false);
            const warmed = link('site');
            loaded(warmed);

            service.use(['site']);
            expect(link('site')).toBe(warmed);
            expect(link('site').media).toBe('');
            expect(waiting()).toBe(false);
        });

        it('waits for a warmed file still on its way, and asks again for one that failed', () => {
            service.warmSignIn();
            const broken = link('site');
            broken.dispatchEvent(new Event('error'));
            service.warmSignIn();
            expect(link('site')).not.toBe(broken);
            service.use(['site']);
            expect(waiting()).toBe(true);
            link('site').dispatchEvent(new Event('load'));
            expect(waiting()).toBe(false);
        });

        it('warms the app\'s sign-in.css when it has one, and leaves a sheet in use alone', () => {
            service.use(['site']);
            files({ 'assets/css/sign-in.css': 'cccc' });
            service.warmSignIn();
            expect(link('sign-in').media).toBe('not all');
            expect(link('site').media).toBe('');
            files({});
            service.warmSignIn();
            expect(link('site').media).toBe('');
        });

        it('does nothing when the sheet is empty', () => {
            files({ 'assets/css/site.css': EMPTY_SHEET });
            service.warmSignIn();
            expect(link('site')).toBeNull();
        });
    });
});
