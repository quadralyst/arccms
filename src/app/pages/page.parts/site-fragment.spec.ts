/**
 * renderSiteFragment: the header and footer are the site's plain HTML, rendered
 * the way publishing renders them (specs/own-website-spec.md, W-D12).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { renderSiteFragment } from './site-fragment';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { PublicContentTypesService } from '../../core/site/public-content-types';
import { SiteIdentityService } from '../../core/services/site-identity.service';
import { DEFAULT_ABOUT_SETTINGS, IAboutSettings } from '../admin/(settings)/about/about-settings.model';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Arc CMS's own header and footer, not the app's (src/custom/site/ may replace them).
const coreSiteFile = (name: string) => readFileSync(join(__dirname, '../../../../public/_site', name), 'utf8');
const header = coreSiteFile('header.html');
const footer = coreSiteFile('footer.html');

@Component({ selector: 'arc-stub-search', standalone: true, template: '<input class="stub-search">' })
class StubSearchComponent {}

const HTML = `
    <nav>
        <a href="/articles" data-arc-t="nav_articles">Articles</a>
        <a href="https://example.com/x">Out</a>
        <a href="/signup">Sign in</a>
        <span class="braces">{ not a binding } and @home</span>
        <arc-search></arc-search>
    </nav>`;

@Component({ selector: 'arc-test-scripted', standalone: true, template: '' })
class ScriptedHostComponent {
    constructor() {
        renderSiteFragment('<button id="menu">Menu</button><script>window.arcTestRuns = (window.arcTestRuns || 0) + 1;'
            + 'document.getElementById("menu").dataset.bound = "yes";</script>', {});
    }
}

@Component({ selector: 'arc-test-site-info', standalone: true, template: '' })
class SiteInfoHostComponent {
    constructor() {
        renderSiteFragment('<footer><a class="tel" data-arc-site="phone">phone</a>'
            + '<ul data-arc-site-loop="social"><li><a href="{{ url }}">{{ label }}</a></li></ul></footer>', {});
    }
}

@Component({ selector: 'arc-test-fragment', standalone: true, template: '' })
class FragmentHostComponent {
    constructor() {
        renderSiteFragment(HTML, { 'arc-search': StubSearchComponent });
    }
}

describe('renderSiteFragment', () => {
    let identity: ReturnType<typeof signal<IAboutSettings>>;
    const loadIdentity = vi.fn();
    let activeLang: ReturnType<typeof signal<string>>;
    let strings: ReturnType<typeof signal<Record<string, string>>>;
    let types: ReturnType<typeof signal<ReadonlySet<string>>>;

    beforeEach(() => {
        activeLang = signal('');
        strings = signal<Record<string, string>>({});
        types = signal<ReadonlySet<string>>(new Set());
        identity = signal<IAboutSettings>(DEFAULT_ABOUT_SETTINGS);
        loadIdentity.mockReset();
        TestBed.configureTestingModule({
            providers: [
                { provide: SiteIdentityService, useValue: { identity, load: loadIdentity } },
                { provide: UiStringsService, useValue: { activeLang, strings } },
                {
                    provide: PublicContentTypesService,
                    // Like the service: the list arrives once, whatever the number of calls.
                    useValue: { slugs: types, load: () => { if (!types().size) types.set(new Set(['articles'])); return Promise.resolve(types()); } },
                },
            ],
        });
    });

    function render(): HTMLElement {
        const fixture = TestBed.createComponent(FragmentHostComponent);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    it('renders the HTML as written, braces and @ included', () => {
        const el = render();
        expect(el.querySelector('.braces')!.textContent).toBe('{ not a binding } and @home');
        expect(el.querySelector('a')!.textContent).toBe('Articles');
    });

    it('turns Arc CMS elements into their components', () => {
        expect(render().querySelector('arc-search .stub-search')).toBeTruthy();
    });

    it('translates and points links at the page\'s language, and follows a change of language', () => {
        const fixture = TestBed.createComponent(FragmentHostComponent);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(el.querySelector('a')!.getAttribute('href')).toBe('/articles');

        activeLang.set('hi');
        strings.set({ nav_articles: 'लेख' });
        fixture.detectChanges();

        fixture.detectChanges(); // the public content types arrived
        const [inner, outer, signIn] = Array.from(el.querySelectorAll('a'));
        expect(inner.textContent).toBe('लेख');
        expect(inner.getAttribute('href')).toBe('/hi/articles');
        expect(outer.getAttribute('href')).toBe('https://example.com/x');
        // Sign-in exists once, so it keeps its address on a Hindi page.
        expect(signIn.getAttribute('href')).toBe('/signup');
        expect(el.querySelector('arc-search .stub-search')).toBeTruthy();
    });

    // SS3: the site's own details from Settings, About, once they arrive.
    it('fills the site\'s details when they arrive, and reads them only for a fragment that asks', () => {
        const fixture = TestBed.createComponent(SiteInfoHostComponent);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect(loadIdentity).toHaveBeenCalledTimes(1);
        expect(el.querySelector('a.tel')).toBeNull(); // no phone yet

        identity.set({ ...DEFAULT_ABOUT_SETTINGS, phone: '+91 98765 43210', sameAs: ['https://github.com/kumar'] });
        fixture.detectChanges();
        expect(el.querySelector('a.tel')!.getAttribute('href')).toBe('tel:+919876543210');
        expect(el.querySelector('ul li a')!.textContent).toBe('GitHub');

        render(); // a fragment without data-arc-site
        expect(loadIdentity).toHaveBeenCalledTimes(1);
    });

    // B4: a header or footer script runs in the app, as on a published page.
    it('runs its scripts, again on each redraw, against the elements drawn', () => {
        (window as any).arcTestRuns = 0;
        const fixture = TestBed.createComponent(ScriptedHostComponent);
        fixture.detectChanges();
        const el = fixture.nativeElement as HTMLElement;
        expect((window as any).arcTestRuns).toBe(1);
        expect((el.querySelector('#menu') as HTMLElement).dataset['bound']).toBe('yes');

        strings.set({ x: 'y' });
        fixture.detectChanges();
        expect((window as any).arcTestRuns).toBe(2);
        expect((el.querySelector('#menu') as HTMLElement).dataset['bound']).toBe('yes');
    });
});

describe('Arc CMS\'s header and footer files', () => {
    it('are plain HTML, with no Angular syntax left to compile', () => {
        for (const html of [header, footer]) {
            expect(html.trim()).not.toBe('');
            expect(html).not.toMatch(/\[[a-zA-Z.]+\]=|\([a-z]+\)=|\*ng|@if|@for/);
        }
        expect(header).toContain('<arc-search>');
        expect(header).toContain('<arc-language-switcher>');
    });
});
