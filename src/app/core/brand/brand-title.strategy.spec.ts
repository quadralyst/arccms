/**
 * Every page's browser tab: the page's name, then the site's, never Arc CMS's
 * (specs/admin-brand-spec.md AB-D15 to AB-D18, the Arc POS brief F14).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { DOCUMENT } from '@angular/common';
import { ActivatedRouteSnapshot, RouterStateSnapshot } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { BrandTitleStrategy, pageTitleOf, pathOf, tabTitle } from './brand-title.strategy';
import { SiteBrandService } from './site-brand';
import { withAppTitle } from '../../../../scripts/vite-app-title';

// An app's own title for one page (src/custom/brand.ts).
vi.mock('../../../custom/brand', () => ({ CUSTOM_BRAND: { titles: { '/admin/users': 'Staff' } } }));

const ROOT = resolve(__dirname, '../../../..');

/** A route chain, root first, as the router hands it over. */
function chain(...configs: { title?: string; data?: Record<string, unknown> }[]): ActivatedRouteSnapshot {
    let child: ActivatedRouteSnapshot | null = null;
    for (const config of [...configs].reverse()) {
        child = { routeConfig: config, firstChild: child } as unknown as ActivatedRouteSnapshot;
    }
    return { routeConfig: null, firstChild: child } as unknown as ActivatedRouteSnapshot;
}

const state = (url: string, root: ActivatedRouteSnapshot) => ({ url, root }) as RouterStateSnapshot;

describe('the tab\'s parts', () => {
    it('takes the deepest route\'s title and key', () => {
        expect(pageTitleOf(chain({ title: 'Settings' }, {}))).toEqual({ title: 'Settings', titleKey: undefined });
        expect(pageTitleOf(chain({ title: 'Users' }, { title: 'Add User' }))).toEqual({ title: 'Add User', titleKey: undefined });
        expect(pageTitleOf(chain({ title: 'Profile', data: { titleKey: 'member.titles.profile' } })))
            .toEqual({ title: 'Profile', titleKey: 'member.titles.profile' });
        expect(pageTitleOf(chain({}))).toEqual({});
    });

    it('puts the site\'s name after the page\'s, either alone when the other is missing', () => {
        expect(tabTitle('Users', 'Tapout POS')).toBe('Users | Tapout POS');
        expect(tabTitle('Users', '')).toBe('Users');
        expect(tabTitle('', 'Tapout POS')).toBe('Tapout POS');
        expect(tabTitle('Tapout POS', 'Tapout POS')).toBe('Tapout POS');
    });

    it('keys an app\'s titles by the path alone', () => {
        expect(pathOf('/admin/users?tab=2#x')).toBe('/admin/users');
        expect(pathOf('/admin/users/')).toBe('/admin/users');
        expect(pathOf('/')).toBe('/');
    });
});

describe('BrandTitleStrategy', () => {
    let site: ReturnType<typeof signal<string>>;
    let strategy: BrandTitleStrategy;
    let doc: Document;

    beforeEach(() => {
        site = signal('');
        TestBed.configureTestingModule({
            providers: [{ provide: SiteBrandService, useValue: { name: site, load: () => Promise.resolve() } }],
        });
        strategy = TestBed.inject(BrandTitleStrategy);
        doc = TestBed.inject(DOCUMENT);
        doc.title = 'Loading';
    });

    it('shows the page\'s name alone until the site\'s name is in, then both', () => {
        strategy.updateTitle(state('/admin/settings/about', chain({ title: 'Settings' }, {})));
        expect(doc.title).toBe('Settings');
        site.set('Tapout POS');
        TestBed.tick();
        expect(doc.title).toBe('Settings | Tapout POS');
    });

    it('never shows Arc CMS while the site\'s name loads', () => {
        strategy.updateTitle(state('/signup', chain({ title: 'Sign in', data: { titleKey: 'member.titles.sign_in' } })));
        expect(doc.title).not.toContain('Arc CMS');
    });

    it('shows the site\'s name alone on a page with no title, never the last page\'s', () => {
        site.set('Tapout POS');
        strategy.updateTitle(state('/admin/users', chain({ title: 'Users' })));
        strategy.updateTitle(state('/waitlist', chain({})));
        expect(doc.title).toBe('Tapout POS');
    });

    it('translates the titles members see into the reader\'s language', () => {
        site.set('Tapout POS');
        TestBed.inject(TranslocoService).setActiveLang('hi');
        strategy.updateTitle(state('/user/profile', chain({ title: 'Profile', data: { titleKey: 'member.titles.profile' } })));
        expect(doc.title).toBe('प्रोफ़ाइल | Tapout POS');
    });

    it('uses the app\'s own title for a page (CUSTOM_BRAND.titles)', () => {
        site.set('Tapout POS');
        strategy.updateTitle(state('/admin/users', chain({ title: 'Users' })));
        expect(doc.title).toBe('Staff | Tapout POS');
    });

    it('leaves a title the page set itself when the site\'s name arrives', () => {
        strategy.updateTitle(state('/articles/hello', chain({ title: 'Content Detail' })));
        doc.title = 'Hello, world';
        site.set('Tapout POS');
        TestBed.tick();
        expect(doc.title).toBe('Hello, world');
    });
});

/** Every file under a folder, from the repo root. */
function filesUnder(folder: string): string[] {
    const out: string[] = [];
    const walk = (dir: string) => {
        for (const name of readdirSync(dir)) {
            const path = join(dir, name);
            if (statSync(path).isDirectory()) walk(path);
            else out.push(relative(ROOT, path).split('\\').join('/'));
        }
    };
    walk(join(ROOT, folder));
    return out;
}

describe('no tab names Arc CMS', () => {
    it('has no route title naming Arc CMS', () => {
        const files = [...filesUnder('src/app/pages').filter((f) => f.endsWith('.ts') && !f.endsWith('.spec.ts')), 'src/app/app.routes.ts'];
        const offenders = files.filter((f) => /title: '[^']*Arc CMS/.test(readFileSync(join(ROOT, f), 'utf8')));
        expect(offenders).toEqual([]);
    });

    it('starts with a neutral title in index.html, or the app\'s name', () => {
        const html = readFileSync(join(ROOT, 'index.html'), 'utf8');
        expect(html).toMatch(/<title>Loading<\/title>/);
        expect(html).not.toMatch(/<title>[^<]*Arc CMS/);
        expect(withAppTitle(html, 'Tapout <POS>')).toContain('<title>Tapout &lt;POS&gt;</title>');
        expect(withAppTitle(html, '  ')).toBe(html);
        expect(withAppTitle(html, undefined)).toBe(html);
    });

    it('gives every member-facing route its title in the member strings', () => {
        const routes = readFileSync(join(ROOT, 'src/app/app.routes.ts'), 'utf8');
        for (const path of ['admin/profile', 'user/profile', 'user/dashboard', 'account', 'user/premium', 'user/payments', 'admin/notifications']) {
            expect(routes, path).toMatch(new RegExp(`path: '${path}',[\\s\\S]{0,300}?titleKey: 'member\\.titles\\.`));
        }
        for (const file of [
            'src/app/pages/(auth)/(signup)/signup.page.ts', 'src/app/pages/(auth)/(profile)/profile.page.ts',
            'src/app/pages/not-found.page.ts', 'src/app/pages/[...not-found].page.ts', 'src/app/pages/auth-checker.page.ts',
            'src/app/pages/admin/unauthorized.page.ts', 'src/app/pages/(notifications)/notifications.page.ts',
        ]) {
            expect(readFileSync(join(ROOT, file), 'utf8'), file).toMatch(/titleKey: 'member\.titles\.[a-z_]+'/);
        }
    });

    it('registers the strategy for the whole app', () => {
        expect(readFileSync(join(ROOT, 'src/app/app.config.ts'), 'utf8')).toContain('{ provide: TitleStrategy, useExisting: BrandTitleStrategy }');
    });
});
