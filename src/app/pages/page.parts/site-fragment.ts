/**
 * Renders a piece of the site's own HTML inside a component: the header and the
 * footer (specs/own-website-spec.md, W-D12).
 *
 * They are plain HTML files (/_site/header.html, /_site/footer.html), the same
 * ones the publish functions put on every static page, so they are not compiled
 * as Angular templates: any text works, `{`, `}` and `@` included. This does in
 * the app what publishing does on a page:
 *
 * - `data-arc-t` text and attributes in the page's language
 *   (applyStringsToElement, the same rules as the publish functions);
 * - the site's own details from Settings, About, such as `data-arc-site="phone"`
 *   (applySiteInfoToElement; specs/site-sections-spec.md, SS3);
 * - links to the site's files with their version (`/site/logo.svg?v=...`), as on
 *   a published page (core/site/site-urls.ts);
 * - links to pages that exist in every language pointed at the page's language
 *   (`/articles` becomes `/hi/articles` on a Hindi page; `/signup` stays);
 * - the Arc CMS elements in the HTML, such as `<arc-search>` and
 *   `<arc-language-switcher>`, become the real components;
 * - its scripts run, as on a published page. An inline script runs again each
 *   time the fragment is drawn again (for the page's language), so it binds to
 *   the elements it finds; a script file is loaded once.
 *
 * It renders again when the page's language or its strings change. A fragment can
 * instead follow a language of its own (`options.language`), such as the sign-in panel
 * in the language a member chose.
 */
import {
    ApplicationRef, ComponentRef, DestroyRef, ElementRef, EnvironmentInjector, Injector, Type,
    createComponent, effect, inject, signal, untracked,
} from '@angular/core';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { applyStringsToElement } from '../../core/i18n/apply-strings-dom';
import { applySiteInfoToElement } from '../../core/site/apply-site-info-dom';
import { SiteIdentityService } from '../../core/services/site-identity.service';
import { SitePagesService } from '../../core/site/site-pages.service';
import { siteInfoOf } from '../../core/site/site-info-source';
import { withLangPrefix } from '../../core/utils/language-links';
import { PublicContentTypesService } from '../../core/site/public-content-types';
import { siteManifest } from '../../core/site/site';
import { versionSiteUrls } from '../../core/site/site-urls';

/** Arc CMS elements a fragment may hold, by tag name, and the component each becomes. */
export type FragmentElements = Record<string, Type<unknown>>;

export interface FragmentOptions {
    /**
     * The language to show the fragment's `data-arc-t` text in, instead of the page's:
     * a code with a site strings file, or '' for the text as written. Its links keep
     * their addresses (no language prefix).
     */
    language?: () => string;
}

/** Call from a component's constructor (injection context): renders `html` into its host element. */
export function renderSiteFragment(html: string, elements: FragmentElements, options: FragmentOptions = {}): void {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const uiStrings = inject(UiStringsService);
    const contentTypes = inject(PublicContentTypesService);
    const siteIdentity = inject(SiteIdentityService);
    const sitePages = inject(SitePagesService);
    const appRef = inject(ApplicationRef);
    const environmentInjector = inject(EnvironmentInjector);
    const elementInjector = inject(Injector);
    let mounted: ComponentRef<unknown>[] = [];
    const loadedScripts = new Set<string>();

    // The fragment's own language, when it has one: its strings, loaded without
    // changing the page's language.
    const ownLanguage = options.language;
    const ownStrings = signal<Record<string, string>>({});
    if (ownLanguage) {
        effect(() => {
            const code = ownLanguage();
            untracked(() => void uiStrings.load(code).then((strings) => {
                if (ownLanguage() === code) ownStrings.set(strings);
            }));
        });
    }
    const pageLang = () => (ownLanguage ? '' : uiStrings.activeLang());
    const pageStrings = () => (ownLanguage ? ownStrings() : uiStrings.strings());

    /** Runs the fragment's scripts, which innerHTML leaves inert. */
    const runScripts = () => {
        host.querySelectorAll('script').forEach((inert) => {
            const src = inert.getAttribute('src');
            if (src && loadedScripts.has(src)) return;
            if (src) loadedScripts.add(src);
            const script = document.createElement('script');
            Array.from(inert.attributes).forEach((attr) => script.setAttribute(attr.name, attr.value));
            script.textContent = inert.textContent;
            inert.replaceWith(script);
        });
    };

    const unmount = () => {
        for (const ref of mounted) {
            appRef.detachView(ref.hostView);
            ref.destroy();
        }
        mounted = [];
    };

    const render = (lang: string, strings: Record<string, string>, types: ReadonlySet<string>) => {
        unmount();
        host.innerHTML = versionSiteUrls(html, siteManifest().files);
        applyStringsToElement(host, strings);
        applySiteInfoToElement(host, siteInfoOf(siteIdentity.identity(), sitePages.pages()));
        const prefix = lang ? `/${lang}` : '';
        if (prefix) {
            host.querySelectorAll('a[href]').forEach((anchor) => {
                anchor.setAttribute('href', withLangPrefix(anchor.getAttribute('href') || '', prefix, types));
            });
        }
        for (const [tag, component] of Object.entries(elements)) {
            host.querySelectorAll(tag).forEach((hostElement) => {
                const ref = createComponent(component, { environmentInjector, elementInjector, hostElement });
                appRef.attachView(ref.hostView);
                mounted.push(ref);
            });
        }
        runScripts();
    };

    // Rendered at once, then again whenever the page's language, its strings,
    // the public content types (which links take the language) or the site's
    // details arrive or change. The details are read only when the fragment
    // asks for them.
    const usesSiteInfo = html.includes('data-arc-site');
    if (usesSiteInfo) {
        void siteIdentity.load();
        void sitePages.load(pageLang());
    }
    let shown = {
        lang: pageLang(), strings: pageStrings(), types: contentTypes.slugs(),
        identity: siteIdentity.identity(), pages: sitePages.pages(),
    };
    render(shown.lang, shown.strings, shown.types);
    if (shown.lang) void contentTypes.load();
    effect(() => {
        const next = {
            lang: pageLang(), strings: pageStrings(), types: contentTypes.slugs(),
            identity: siteIdentity.identity(), pages: sitePages.pages(),
        };
        if (next.lang === shown.lang && next.strings === shown.strings && next.types === shown.types
            && next.identity === shown.identity && next.pages === shown.pages) return;
        // The footer's page titles follow the page's language.
        if (usesSiteInfo && next.lang !== shown.lang) void untracked(() => sitePages.load(next.lang));
        shown = next;
        if (next.lang) void contentTypes.load();
        untracked(() => render(next.lang, next.strings, next.types));
    });

    inject(DestroyRef).onDestroy(unmount);
}
