/**
 * The website's stylesheets are on only while a page of the website is shown, so
 * they never style the admin area or the member area (site-styles.ts).
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { TestBed } from '@angular/core/testing';
import { SiteStylesService, signInSheet } from './site-styles';
import { siteManifest } from './site';

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
