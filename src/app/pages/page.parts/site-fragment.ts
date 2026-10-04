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
 * - root-relative links pointed at the page's language (`/articles` becomes
 *   `/hi/articles` on a Hindi page);
 * - the Arc CMS elements in the HTML, such as `<arc-search>` and
 *   `<arc-language-switcher>`, become the real components.
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

/** Arc CMS elements a fragment may hold, by tag name, and the component each becomes. */
export type FragmentElements = Record<string, Type<unknown>>;

/** Call from a component's constructor (injection context): renders `html` into its host element. */
export function renderSiteFragment(html: string, elements: FragmentElements): void {
    const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    const uiStrings = inject(UiStringsService);
    const appRef = inject(ApplicationRef);
    const environmentInjector = inject(EnvironmentInjector);
    const elementInjector = inject(Injector);
    let mounted: ComponentRef<unknown>[] = [];

    const unmount = () => {
        for (const ref of mounted) {
            appRef.detachView(ref.hostView);
            ref.destroy();
        }
        mounted = [];
    };

    const render = (lang: string, strings: Record<string, string>) => {
        unmount();
        host.innerHTML = html;
        applyStringsToElement(host, strings);
        const prefix = lang ? `/${lang}` : '';
        if (prefix) {
            host.querySelectorAll('a[href]').forEach((anchor) => {
                anchor.setAttribute('href', withLangPrefix(anchor.getAttribute('href') || '', prefix));
            });
        }
        for (const [tag, component] of Object.entries(elements)) {
            host.querySelectorAll(tag).forEach((hostElement) => {
                const ref = createComponent(component, { environmentInjector, elementInjector, hostElement });
                appRef.attachView(ref.hostView);
                mounted.push(ref);
            });
        }
    };

    // Rendered at once so it is in a prerendered page, then again whenever the
    // page's language or its strings arrive or change.
    let shown = { lang: uiStrings.activeLang(), strings: uiStrings.strings() };
    render(shown.lang, shown.strings);
    effect(() => {
        const next = { lang: uiStrings.activeLang(), strings: uiStrings.strings() };
        if (next.lang === shown.lang && next.strings === shown.strings) return;
        shown = next;
        untracked(() => render(next.lang, next.strings));
    });

    inject(DestroyRef).onDestroy(unmount);
}
