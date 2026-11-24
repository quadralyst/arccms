/**
 * The public website's stylesheets, on only while a page of the website is on
 * screen (specs/own-website-spec.md).
 *
 * `main.css` (Arc CMS's site styles) and `site.css` (the app's,
 * src/custom/site/site.css) style the header, footer, templates and sign-in page.
 * An app whose site.css is a whole theme can give the sign-in page a stylesheet of
 * its own, src/custom/site/sign-in.css (`sign-in`), loaded there in place of site.css.
 * Loaded for good, they would also style the admin area and the member area,
 * which share class names such as `.navbar` and `.nav-link`. So each is one
 * `<link>` that the website's components switch on while they are shown and that
 * is switched off (`disabled`, no reload) when the last of them goes. Each link
 * carries the file's hash (`?v=`), so a changed file reaches browsers that keep
 * CSS for a year.
 *
 * A page is not shown without them (F51): while a sheet a page uses is on its way,
 * `<html>` carries SITE_STYLES_WAIT_CLASS and src/styles.css hides the routed page, so
 * nobody sees Arc CMS's look before the app's. The wait ends when the sheet loads or
 * fails, or after SITE_STYLES_WAIT_MS, and there is none for a sheet already loaded or
 * an empty one (an app with no site.css gets Arc CMS's empty one).
 */
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { DestroyRef, Injectable, PLATFORM_ID, inject } from '@angular/core';
import { siteManifest } from './site';

export type SiteSheet = 'main' | 'site' | 'sign-in';

const FILES: Record<SiteSheet, string> = {
    main: 'assets/css/main.css',
    site: 'assets/css/site.css',
    'sign-in': 'assets/css/sign-in.css',
};

/** The sign-in page's sheet: the app's sign-in.css when it has one, else its site.css. */
export function signInSheet(files: Record<string, string> = siteManifest().files): SiteSheet {
    return files[FILES['sign-in']] ? 'sign-in' : 'site';
}

/** On `<html>` while the page waits for a stylesheet it uses (src/styles.css hides the page). */
export const SITE_STYLES_WAIT_CLASS = 'arc-site-styles-wait';

/** The longest a page waits for its stylesheets: a slow file must never keep anyone from signing in. */
export const SITE_STYLES_WAIT_MS = 2_000;

/** How often a waiting page looks whether the sheet is in, beside the browser's own word. */
const LOOK_EVERY_MS = 100;

/** An empty file's hash in the manifest (scripts/arc-site.mjs): a sheet with nothing to wait for. */
export const EMPTY_SHEET = 'e3b0c44298fc1c14';

/** Whether the site's sheet has nothing in it. */
const isEmpty = (sheet: SiteSheet) => siteManifest().files[FILES[sheet]] === EMPTY_SHEET;

/**
 * Whether a link's styles apply: its file is in, with what it imports. Until an `@import`
 * such as a web font is in, a browser has the sheet but draws none of it.
 */
function isIn(link: HTMLLinkElement): boolean {
    if (!link.sheet) return false;
    try {
        // Imports come first, so the first other style rule ends the look.
        for (const rule of Array.from(link.sheet.cssRules ?? [])) {
            if (rule.type === CSSRule.IMPORT_RULE) {
                if (!(rule as CSSImportRule).styleSheet) return false;
            } else if (rule.type === CSSRule.STYLE_RULE) break;
        }
    } catch {
        // A sheet that may not be read is one the browser has.
    }
    return true;
}

@Injectable({ providedIn: 'root' })
export class SiteStylesService {
    private document = inject(DOCUMENT);
    private browser = isPlatformBrowser(inject(PLATFORM_ID));
    private users = new Map<SiteSheet, number>();
    /** The sheets the page waits for, each with what ends its wait. */
    private waits = new Map<SiteSheet, () => void>();
    /** Links whose file did not arrive: made again, and asked for again, the next time. */
    private failed = new WeakSet<HTMLLinkElement>();
    /** Links the page stopped waiting for: the next page does not wait for them again. */
    private late = new WeakSet<HTMLLinkElement>();

    /** Switches the sheets on; the returned function switches them off again. */
    use(sheets: SiteSheet[]): () => void {
        for (const sheet of sheets) {
            const users = this.users.get(sheet) ?? 0;
            this.users.set(sheet, users + 1);
            const link = this.link(sheet, users === 0);
            // Warmed (warmSignIn): loaded for no screen so far.
            if (link.media === 'not all') link.media = '';
            link.disabled = false;
            if (users === 0) this.wait(sheet, link);
        }
        let released = false;
        return () => {
            if (released) return;
            released = true;
            for (const sheet of sheets) {
                const left = Math.max(0, (this.users.get(sheet) ?? 1) - 1);
                this.users.set(sheet, left);
                if (left > 0) continue;
                const link = this.link(sheet);
                // Only something it imports failed: the sheet itself is in.
                if (link.sheet) this.failed.delete(link);
                link.disabled = true;
                this.waits.get(sheet)?.();
            }
        };
    }

    /**
     * Loads the sign-in page's stylesheet ahead, so the page opens with no wait. For a
     * page whose likely next step is signing in (docs/app/sign-in.html#warm-look): the
     * file loads in the background and styles nothing until the sign-in page is shown.
     * Returns at once, and does nothing when the sheet is already there or is empty.
     */
    warmSignIn(): void {
        const sheet = signInSheet();
        if (!this.browser || isEmpty(sheet)) return;
        const link = this.document.getElementById(`arc-site-css-${sheet}`) as HTMLLinkElement | null;
        if (link && !this.didFail(link)) return;
        link?.remove();
        this.add(sheet, 'not all');
    }

    /** Hides the page until the sheet is in, has failed, or has taken too long. */
    private wait(sheet: SiteSheet, link: HTMLLinkElement): void {
        if (!this.browser || isIn(link) || this.late.has(link) || isEmpty(sheet)) return;
        const timer = setTimeout(() => {
            this.late.add(link);
            end();
        }, SITE_STYLES_WAIT_MS);
        // A browser that puts a sheet back without saying it loaded.
        const look = setInterval(() => isIn(link) && end(), LOOK_EVERY_MS);
        const end = () => {
            clearTimeout(timer);
            clearInterval(look);
            link.removeEventListener('load', end);
            link.removeEventListener('error', end);
            this.waits.delete(sheet);
            this.showWait();
        };
        link.addEventListener('load', end);
        link.addEventListener('error', end);
        this.waits.set(sheet, end);
        this.showWait();
    }

    private showWait(): void {
        const page = this.document.documentElement;
        // The new look is worked out while transitions are off (src/styles.css), so a
        // button has its colour at once instead of fading to it as the page appears.
        if (this.waits.size === 0) void page.offsetHeight;
        page.classList.toggle(SITE_STYLES_WAIT_CLASS, this.waits.size > 0);
    }

    /**
     * The sheet's link, added to the page the first time (or found in a prerendered
     * page). `retry`: one whose file did not arrive is made again.
     */
    private link(sheet: SiteSheet, retry = false): HTMLLinkElement {
        const link = this.document.getElementById(`arc-site-css-${sheet}`) as HTMLLinkElement | null;
        if (link && !(retry && this.didFail(link))) return link;
        link?.remove();
        return this.add(sheet);
    }

    /** Its file did not arrive. Not an `@import` of it, such as a web font: then the sheet itself is in. */
    private didFail(link: HTMLLinkElement): boolean {
        return this.failed.has(link) && !link.sheet;
    }

    private add(sheet: SiteSheet, media = ''): HTMLLinkElement {
        const link = this.document.createElement('link');
        link.id = `arc-site-css-${sheet}`;
        link.rel = 'stylesheet';
        if (media) link.media = media;
        const version = siteManifest().files[FILES[sheet]];
        link.href = `/${FILES[sheet]}${version ? `?v=${version}` : ''}`;
        link.addEventListener('error', () => this.failed.add(link));
        this.document.head.appendChild(link);
        return link;
    }
}

/** Call from a component's constructor: the sheets are on for as long as it is shown. */
export function useSiteStyles(sheets: SiteSheet[]): void {
    inject(DestroyRef).onDestroy(inject(SiteStylesService).use(sheets));
}
