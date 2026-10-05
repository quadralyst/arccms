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
 * It renders again when the page's language or its strings change.
 */
import {
    ApplicationRef, ComponentRef, DestroyRef, ElementRef, EnvironmentInjector, Injector, Type,
    createComponent, effect, inject, untracked,
} from '@angular/core';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { applyStringsToElement } from '../../core/i18n/apply-strings-dom';
import { withLangPrefix } from '../../core/utils/language-links';
import { PublicContentTypesService } from '../../core/site/public-content-types';
import { siteManifest } from '../../core/site/site';
import { versionSiteUrls } from '../../core/site/site-urls';

/** Arc CMS elements a fragment may hold, by tag name, and the component each becomes. */
export type FragmentElements = Record<string, Type<unknown>>;

/** Call from a component's constructor (injection context): renders `html` into its host element. */
export function renderSiteFragment(html: string, elements: FragmentElements): void {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const uiStrings = inject(UiStringsService);
    const contentTypes = inject(PublicContentTypesService);
    const appRef = inject(ApplicationRef);
    const environmentInjector = inject(EnvironmentInjector);
    const elementInjector = inject(Injector);
    let mounted: ComponentRef<unknown>[] = [];
    const loadedScripts = new Set<string>();

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

    // Rendered at once, then again whenever the page's language, its strings or
    // the public content types (which links take the language) arrive or change.
    let shown = { lang: uiStrings.activeLang(), strings: uiStrings.strings(), types: contentTypes.slugs() };
    render(shown.lang, shown.strings, shown.types);
    if (shown.lang) void contentTypes.load();
    effect(() => {
        const next = { lang: uiStrings.activeLang(), strings: uiStrings.strings(), types: contentTypes.slugs() };
        if (next.lang === shown.lang && next.strings === shown.strings && next.types === shown.types) return;
        shown = next;
        if (next.lang) void contentTypes.load();
        untracked(() => render(next.lang, next.strings, next.types));
    });

    inject(DestroyRef).onDestroy(unmount);
}
