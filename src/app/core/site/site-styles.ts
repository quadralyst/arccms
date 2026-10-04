/**
 * The public website's stylesheets, on only while a page of the website is on
 * screen (specs/own-website-spec.md).
 *
 * `main.css` (Arc CMS's site styles) and `site.css` (the app's,
 * src/custom/site/site.css) style the header, footer, templates and sign-in page.
 * Loaded for good, they would also style the admin area and the member area,
 * which share class names such as `.navbar` and `.nav-link`. So each is one
 * `<link>` that the website's components switch on while they are shown and that
 * is switched off (`disabled`, no reload) when the last of them goes. Each link
 * carries the file's hash (`?v=`), so a changed file reaches browsers that keep
 * CSS for a year.
 */
import { DOCUMENT } from '@angular/common';
import { DestroyRef, Injectable, inject } from '@angular/core';
import { siteManifest } from './site';

export type SiteSheet = 'main' | 'site';

const FILES: Record<SiteSheet, string> = {
    main: 'assets/css/main.css',
    site: 'assets/css/site.css',
};

@Injectable({ providedIn: 'root' })
export class SiteStylesService {
    private document = inject(DOCUMENT);
    private users = new Map<SiteSheet, number>();

    /** Switches the sheets on; the returned function switches them off again. */
    use(sheets: SiteSheet[]): () => void {
        for (const sheet of sheets) {
            this.users.set(sheet, (this.users.get(sheet) ?? 0) + 1);
            this.link(sheet).disabled = false;
        }
        let released = false;
        return () => {
            if (released) return;
            released = true;
            for (const sheet of sheets) {
                const left = Math.max(0, (this.users.get(sheet) ?? 1) - 1);
                this.users.set(sheet, left);
                if (left === 0) this.link(sheet).disabled = true;
            }
        };
    }

    /** The sheet's link, added to the page the first time (or found in a prerendered page). */
    private link(sheet: SiteSheet): HTMLLinkElement {
        const id = `arc-site-css-${sheet}`;
        let link = this.document.getElementById(id) as HTMLLinkElement | null;
        if (!link) {
            link = this.document.createElement('link');
            link.id = id;
            link.rel = 'stylesheet';
            const version = siteManifest().files[FILES[sheet]];
            link.href = `/${FILES[sheet]}${version ? `?v=${version}` : ''}`;
            this.document.head.appendChild(link);
        }
        return link;
    }
}

/** Call from a component's constructor: the sheets are on for as long as it is shown. */
export function useSiteStyles(sheets: SiteSheet[]): void {
    inject(DestroyRef).onDestroy(inject(SiteStylesService).use(sheets));
}
