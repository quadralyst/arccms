/**
 * The home page preview (index.page.ts, specs/own-website-spec.md W4): the site's
 * home.html shown in the app, the way publishing builds it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { ActivatedRoute, provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Title } from '@angular/platform-browser';
import { of } from 'rxjs';
import HomeComponent from './index.page';
import { ContentsStore } from './admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from './admin/contents/content-types/content-types.store';
import { ContentPartialsComponent } from './page.parts/content-partials.component';
import { OnboardingSetupService } from './(onboarding)/onboarding-setup.service';
import { LocalizationService } from '../core/services/localization.service';
import { UiStringsService } from '../core/services/ui-strings.service';
import { setSiteManifestForTesting, siteManifest } from '../core/site/site';
import { PublicContentTypesService } from '../core/site/public-content-types';

const HOME = `<!doctype html><html lang="en"><head>
    <title data-arc-t="home_title">My Site</title>
    <meta name="description" content="What we do.">
    <link rel="stylesheet" href="/site/home.css">
    <style>.hero { color: red; }</style>
</head><body>
    <arc-header></arc-header>
    <section class="hero"><h1 data-arc-t="home_heading">Hello</h1><a class="more" href="/articles">Read</a><a class="terms" href="/p/terms">Terms</a><a class="learn" href="/learn">Learn</a></section>
    <arc-content-partials content-type="articles" count="3" section-title="From the blog"></arc-content-partials>
    <form data-waitlist-form data-waitlist-id="waitlist-form"><input name="email"><button>Join</button></form>
    <arc-footer></arc-footer>
    <script>window.__homeScriptRan = (window.__homeScriptRan || 0) + 1;</script>
</body></html>`;

describe('HomeComponent (home page preview)', () => {
    let fixture: ComponentFixture<HomeComponent>;
    let http: { get: ReturnType<typeof vi.fn> };
    let onboarding: { shouldShowOnboarding: ReturnType<typeof vi.fn> };
    let strings: Record<string, string>;
    const localization = () => ({
        load: vi.fn().mockResolvedValue({ defaultLanguage: 'en', enabledLanguages: [{ code: 'en' }, { code: 'hi' }] }),
        languageVariants: signal<string[] | null>(null),
        enabledLanguages: signal([]),
        defaultLanguage: signal('en'),
    });

    async function open(lang = ''): Promise<HTMLElement> {
        await TestBed.configureTestingModule({
            imports: [HomeComponent],
            providers: [
                provideRouter([]),
                { provide: ActivatedRoute, useValue: { snapshot: { paramMap: { get: (k: string) => (k === 'lang' ? lang || null : null) } }, paramMap: of({ keys: [], get: () => null }), queryParams: of({}) } },
                { provide: HttpClient, useValue: http },
                { provide: OnboardingSetupService, useValue: onboarding },
                { provide: LocalizationService, useValue: localization() },
                {
                    provide: UiStringsService,
                    useValue: {
                        activeLang: signal(lang),
                        strings: signal({}),
                        use: vi.fn().mockResolvedValue(strings),
                        translate: (_k: string, fallback: string) => fallback,
                    },
                },
                { provide: PublicContentTypesService, useValue: { slugs: signal(new Set(['articles'])), load: vi.fn().mockResolvedValue(new Set(['articles'])) } },
                { provide: ContentTypesStore, useValue: { items: signal([]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() } },
            ],
        })
            .overrideComponent(ContentPartialsComponent, {
                set: { providers: [{ provide: ContentsStore, useValue: { items: signal([]), isLoading: signal(false), getAll: vi.fn(), unsubscribeStore: vi.fn() } }] },
            })
            .compileComponents();
        fixture = TestBed.createComponent(HomeComponent);
        fixture.detectChanges();
        await new Promise((r) => setTimeout(r, 0));
        await new Promise((r) => setTimeout(r, 0));
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    beforeEach(() => {
        (window as unknown as { __homeScriptRan?: number }).__homeScriptRan = 0;
        http = { get: vi.fn().mockReturnValue(of(HOME)) };
        onboarding = { shouldShowOnboarding: vi.fn().mockReturnValue(of(false)) };
        strings = {};
    });

    afterEach(() => setSiteManifestForTesting());

    it('shows the site\'s home page, with its title, styles and scripts', async () => {
        const el = await open();
        expect(http.get).toHaveBeenCalledWith('/_site/home.html', { responseType: 'text' });
        expect(el.querySelector('.hero h1')!.textContent).toBe('Hello');
        expect(TestBed.inject(Title).getTitle()).toBe('My Site');
        expect(document.head.querySelector('link[data-arc-home][href="/site/home.css"]')).toBeTruthy();
        expect(document.head.querySelector('style[data-arc-home]')!.textContent).toContain('.hero');
        expect(document.body.querySelector('script[data-arc-home]')!.textContent).toContain('__homeScriptRan');
    });

    it('turns the Arc CMS elements into components, cards with the page\'s settings', async () => {
        const el = await open();
        // The header's own HTML is in place, and its search box is the header's.
        expect(el.querySelector('arc-header nav, arc-header *')).toBeTruthy();
        const partials = el.querySelector('arc-content-partials') as HTMLElement & { __ngContext__?: unknown };
        expect(partials).toBeTruthy();
        // The terms notice above the button, and the live parts by the published page's own script.
        expect(el.querySelector('form [data-legal-notice] + button')).toBeTruthy();
        const arcSite = document.body.querySelector('script[data-arc-home][src^="/assets/js/arc-site.js"]')!;
        expect(arcSite.getAttribute('data-group')).toBe('arccms');
        expect(arcSite.getAttribute('data-functions')).toMatch(/^https:\/\/[a-z0-9-]+-.+\.cloudfunctions\.net$/);
        expect(arcSite.getAttribute('data-database')).toBeTruthy();
    });

    it('cleans up what it added when it goes', async () => {
        await open();
        fixture.destroy();
        expect(document.querySelector('[data-arc-home]')).toBeNull();
    });

    it('shows home.html in another language with its strings, and its links in that language', async () => {
        strings = { home_heading: 'नमस्ते', home_title: 'मेरी साइट' };
        const el = await open('hi');
        expect(http.get).toHaveBeenCalledWith('/_site/home.html', { responseType: 'text' });
        expect(el.querySelector('.hero h1')!.textContent).toBe('नमस्ते');
        expect(TestBed.inject(Title).getTitle()).toBe('मेरी साइट');
        expect(el.querySelector('a.more')!.getAttribute('href')).toBe('/hi/articles');
        expect(el.querySelector('a.terms')!.getAttribute('href')).toBe('/p/terms');
        // An app's own page exists once: no language prefix.
        expect(el.querySelector('a.learn')!.getAttribute('href')).toBe('/learn');
        expect(document.documentElement.lang).toBe('hi');
        fixture.destroy();
        expect(document.documentElement.lang).not.toBe('hi');
    });

    it('shows the language\'s own file when the site has one', async () => {
        const built = siteManifest();
        setSiteManifestForTesting({ ...built, home: { default: 'app', hi: 'app' } });
        await open('hi');
        expect(http.get).toHaveBeenCalledWith('/_site/home.hi.html', { responseType: 'text' });
    });

    it('asks whether the site still needs its setup wizard', async () => {
        await open();
        expect(onboarding.shouldShowOnboarding).toHaveBeenCalled();
    });
});
