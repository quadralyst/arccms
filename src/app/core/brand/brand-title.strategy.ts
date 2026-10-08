/**
 * Every page's browser tab: the page's name, then the site's (specs/admin-brand-spec.md
 * AB-D15 to AB-D18, docs/app/admin-look.html).
 *
 * The page's name is the app's own title for that path (CUSTOM_BRAND.titles), else the
 * route's `titleKey` in the reader's language (the pages members see), else the route's
 * English `title`. The site's name (core/brand/site-brand.ts) follows once Settings, About
 * is in; until then the page's name stands alone, so Arc CMS's never shows. A route with
 * no title shows the site's name alone. A page that sets its own title afterwards (a
 * content page, say) keeps it: the tab is only rewritten while it still says what this
 * strategy last wrote.
 */
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { Injectable, PLATFORM_ID, effect, inject, signal } from '@angular/core';
import { ActivatedRouteSnapshot, RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { TranslocoService } from '@jsverse/transloco';
import { CUSTOM_BRAND } from '../../../custom/brand';
import { SiteBrandService } from './site-brand';

/** What the deepest route with a title asks for. */
export interface PageTitle {
    title?: string;
    titleKey?: string;
}

/** The deepest route's title and title key, walking the primary routes from the root. */
export function pageTitleOf(root: ActivatedRouteSnapshot): PageTitle {
    let found: PageTitle = {};
    for (let route: ActivatedRouteSnapshot | null = root; route; route = route.firstChild) {
        const config = route.routeConfig;
        const title = typeof config?.title === 'string' ? config.title : undefined;
        const titleKey = typeof config?.data?.['titleKey'] === 'string' ? (config.data['titleKey'] as string) : undefined;
        if (title || titleKey) found = { title, titleKey };
    }
    return found;
}

/** The tab's text: the page's name and the site's, either alone when the other is missing. */
export function tabTitle(page: string, site: string): string {
    if (page && site && page !== site) return `${page} | ${site}`;
    return page || site;
}

/** The URL's path, without the query or fragment, and without a trailing slash. */
export function pathOf(url: string): string {
    const path = url.split(/[?#]/)[0].replace(/\/+$/, '');
    return path || '/';
}

@Injectable({ providedIn: 'root' })
export class BrandTitleStrategy extends TitleStrategy {
    private document = inject(DOCUMENT);
    private brand = inject(SiteBrandService);
    private transloco = inject(TranslocoService);

    private readonly page = signal<{ path: string; title: PageTitle } | null>(null);
    /** Bumped when the language changes or a translation file arrives. */
    private readonly strings = signal(0);
    /** What this strategy last wrote, so a page's own title is never overwritten. */
    private written: string | null = null;

    constructor() {
        super();
        this.transloco.langChanges$.subscribe(() => this.strings.update((n) => n + 1));
        this.transloco.events$.subscribe((e) => {
            if (e.type === 'translationLoadSuccess') this.strings.update((n) => n + 1);
        });
        effect(() => {
            const page = this.page();
            const site = this.brand.name();
            this.strings();
            if (!page) return;
            if (this.written !== null && this.document.title !== this.written) return;
            this.write(tabTitle(this.pageName(page.path, page.title), site));
        });
        // In the browser only: a server render may read another database than the browser's.
        if (isPlatformBrowser(inject(PLATFORM_ID))) void this.brand.load();
    }

    override updateTitle(snapshot: RouterStateSnapshot): void {
        const page = { path: pathOf(snapshot.url), title: pageTitleOf(snapshot.root) };
        // A new page: write at once, whatever the tab said.
        this.write(tabTitle(this.pageName(page.path, page.title), this.brand.name()));
        this.page.set(page);
    }

    private pageName(path: string, title: PageTitle): string {
        const own = CUSTOM_BRAND.titles?.[path];
        if (own) return own;
        if (title.titleKey) {
            const translated = this.transloco.translate(title.titleKey);
            if (translated && translated !== title.titleKey) return translated;
        }
        return title.title ?? '';
    }

    private write(title: string): void {
        if (!title) return;
        this.written = title;
        this.document.title = title;
    }
}
