import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit, PLATFORM_ID, ViewEncapsulation } from '@angular/core';
import { SitePagesService } from '../../core/site/site-pages.service';
import { siteInfoOf } from '../../core/site/site-info-source';
import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, Meta, SafeHtml, Title } from '@angular/platform-browser';
import { catchError, map, of, switchMap } from 'rxjs';
import { HeaderComponent } from '../page.parts/header.component';
import { FooterComponent } from '../page.parts/footer.component';
import { siteManifest, sitePageUrl } from '../../core/site/site';
import { GaTrackingService } from '../../../shared/services/ga-tracking.service';
import { SiteIdentityService } from '../../core/services/site-identity.service';
import { applySiteInfoToHtml } from '../../core/site/apply-site-info-dom';
import { attachLiveParts } from '../../core/site/live-parts';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { TemplateHydrationService } from '../../core/services/template-hydration.service';

@Component({
    selector: 'app-public-page-renderer',
    standalone: true,
    imports: [CommonModule, HeaderComponent, FooterComponent],
    template: `
    <div class="public-page-wrapper">
      @if (hasHeader) {
        <arc-header></arc-header>
      }
      
      <div [innerHTML]="sanitizedContent" class="public-page-content"></div>

      @if (hasFooter) {
        <arc-footer></arc-footer>
      }
    </div>
  `,
    styles: [`
    .public-page-wrapper {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    .public-page-content {
      flex: 1;
    }
  `],
    encapsulation: ViewEncapsulation.None
})
export class PublicPageRendererComponent implements OnInit, OnDestroy {
    private http = inject(HttpClient);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private sanitizer = inject(DomSanitizer);
    private titleService = inject(Title);
    private metaService = inject(Meta);
    private gaTracking = inject(GaTrackingService);
    private siteIdentity = inject(SiteIdentityService);
    private sitePages = inject(SitePagesService);
    private uiStrings = inject(UiStringsService);
    private cdr = inject(ChangeDetectorRef);
    private document = inject(DOCUMENT);
    private platformId = inject(PLATFORM_ID);
    /** The live parts' script for the page's forms (SS5). */
    private liveScript: HTMLScriptElement | null = null;
    /** The inside of the page's own <head>, for its stylesheets and scripts. */
    private pageHead = '';
    /** What this component put in document.head for the page drawn, removed when it is left. */
    private headAdded: Element[] = [];
    /** Counts the pages drawn, so the scripts of a page left stop loading. */
    private drawn = 0;
    /**
     * Counts the pages asked for (and the component's end), so a page still
     * waiting for its strings or site details when it is left, for another /p/
     * page or another route, is never drawn: its styles and scripts would stay.
     */
    private asked = 0;

    sanitizedContent: SafeHtml = '';
    hasHeader = false;
    hasFooter = false;

    ngOnDestroy(): void {
        this.asked++;
        this.liveScript?.remove();
        this.clearPageHead();
    }

    ngOnInit() {
        this.route.params.pipe(
            map(params => params['fileName']),
            switchMap(fileName => {
                this.asked++;
                if (!fileName || fileName.toLowerCase() === 'index') {
                    return of(null);
                }

                // Handle optional .html extension
                const cleanFileName = fileName.endsWith('.html') ? fileName.substring(0, fileName.length - 5) : fileName;

                // Track public page view
                this.gaTracking.trackPublicPageView(cleanFileName);

                // A page the site does not have would answer with the app shell
                // (HTTP 200), so only pages in the site's manifest are fetched.
                // Its own entries only: not `constructor` or `__proto__`.
                if (!Object.hasOwn(siteManifest().pages, cleanFileName)) {
                    return of(null);
                }
                return this.http.get(sitePageUrl(cleanFileName), { responseType: 'text' }).pipe(
                    catchError(err => {
                        console.error('Error loading page:', err);
                        return of(null);
                    })
                );
            })
        ).subscribe(async htmlContent => {
            const asked = this.asked;
            /** Whether the page was left while its data was read. */
            const left = () => asked !== this.asked;
            if (htmlContent) {
                // The site's own details for data-arc-site (SS3), read only when the page asks.
                // Read only for a page that asks: the site's details (SS3), and the
                // standard pages (SS6) for its forms' notice links and site loops.
                const usesSiteInfo = htmlContent.includes('data-arc-site');
                const hasForms = htmlContent.includes('data-arc-contact-form') || htmlContent.includes('data-waitlist-form');
                const pages = usesSiteInfo || hasForms ? await this.sitePages.load() : [];
                if (left()) return;
                const about = usesSiteInfo ? await this.siteIdentity.load() : null;
                if (left()) return;
                // Static pages are in the default language: its strings file, when the
                // site has one, words them and their forms' panels, as when published.
                // Waited for only by a page that uses them; the header and footer follow it either way.
                const usesStrings = htmlContent.includes('data-arc-t') || hasForms;
                const loading = this.uiStrings.use('');
                const strings = usesStrings ? await loading : {};
                if (left()) return;
                this.processHtml(applySiteInfoToHtml(TemplateHydrationService.applyStrings(htmlContent, strings), siteInfoOf(about, pages)));
                this.cdr.detectChanges();
                if (isPlatformBrowser(this.platformId)) {
                    const content = this.document.querySelector('.public-page-content');
                    // The page's own styles and scripts, as when published.
                    this.drawPageHead(content);
                    // Signup and contact forms on the page work as when published (SS5).
                    this.liveScript?.remove();
                    this.liveScript = content ? attachLiveParts(content, this.document, pages, strings) : null;
                }
            } else {
                this.router.navigate(['/404']);
            }
        });
    }

    private processHtml(html: string) {
        let processedHtml = html;

        // 1. Component Handling (<arc-header> / <arc-footer>)
        // Regex for <arc-header> (opening/closing or self-closing)
        const headerRegex = /<arc-header\b[^>]*>(.*?)<\/arc-header>|<arc-header\b[^>]*\/>/is;
        if (headerRegex.test(processedHtml)) {
            this.hasHeader = true;
            processedHtml = processedHtml.replace(headerRegex, '');
        } else {
            this.hasHeader = false;
        }

        // Regex for <arc-footer>
        const footerRegex = /<arc-footer\b[^>]*>(.*?)<\/arc-footer>|<arc-footer\b[^>]*\/>/is;
        if (footerRegex.test(processedHtml)) {
            this.hasFooter = true;
            processedHtml = processedHtml.replace(footerRegex, '');
        } else {
            this.hasFooter = false;
        }

        // 2. Metadata Handling
        // Title
        const titleRegex = /<title[^>]*>(.*?)<\/title>/is;
        const titleMatch = processedHtml.match(titleRegex);
        if (titleMatch && titleMatch[1]) {
            this.titleService.setTitle(titleMatch[1]);
            // Optional: remove title tag from content if we only want it in head
            // processedHtml = processedHtml.replace(titleRegex, ''); 
        }

        // Meta Tags
        const metaRegex = /<meta\b[^>]*>/gi;
        let metaMatch;
        while ((metaMatch = metaRegex.exec(processedHtml)) !== null) {
            const metaTag = metaMatch[0];
            const nameMatch = metaTag.match(/name=["']([^"']*)["']/i);
            const propertyMatch = metaTag.match(/property=["']([^"']*)["']/i);
            const contentMatch = metaTag.match(/content=["']([^"']*)["']/i);

            const content = contentMatch ? contentMatch[1] : null;
            if (content) {
                if (nameMatch && nameMatch[1]) {
                    this.metaService.updateTag({ name: nameMatch[1], content });
                } else if (propertyMatch && propertyMatch[1]) {
                    this.metaService.updateTag({ property: propertyMatch[1], content });
                }
            }
        }

        // 3. The page's own <head>, for its stylesheets and scripts (drawPageHead).
        this.pageHead = processedHtml.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? '';

        // 4. Content Extraction (Body)
        const bodyRegex = /<body[^>]*>([\s\S]*?)<\/body>/is;
        const bodyMatch = processedHtml.match(bodyRegex);

        if (bodyMatch && bodyMatch[1]) {
            // use content found inside <body>
            this.sanitizedContent = this.sanitizer.bypassSecurityTrustHtml(bodyMatch[1]);
        } else {
            // Fallback: use the whole processed HTML (stripped of header/footer)
            // You might want to strip <head> as well if it exists
            const headRegex = /<head[^>]*>([\s\S]*?)<\/head>/is;
            processedHtml = processedHtml.replace(headRegex, '');
            this.sanitizedContent = this.sanitizer.bypassSecurityTrustHtml(processedHtml);
        }
    }

    /**
     * Draws what the page's own <head> brings, as publishing keeps it: its
     * stylesheets, <style> blocks and font links go at the end of document.head,
     * after the app's site styles, so the page's rules win as on the published
     * page. Then its scripts run once, the head's first, in document order, each
     * src script loaded before the next runs. Browser only.
     *
     * Trust: these pages are the app's own files from its site folder
     * (src/custom/site/pages/ over public/_site/pages/, listed in the site's
     * manifest), written by the app's developers, so their styles and scripts run
     * as they do when published. Never give this content from the database or
     * from visitors.
     */
    private drawPageHead(content: Element | null): void {
        this.clearPageHead();
        const drawn = ++this.drawn;
        const view = this.document.defaultView;
        const head = this.pageHead && view?.DOMParser
            ? new view.DOMParser().parseFromString(`<!DOCTYPE html><html><head>${this.pageHead}</head><body></body></html>`, 'text/html').head
            : null;
        const headScripts: HTMLScriptElement[] = [];
        for (const el of Array.from(head?.children ?? [])) {
            if (el.tagName === 'SCRIPT') headScripts.push(el as HTMLScriptElement);
            else if (el.tagName === 'STYLE' || (el.tagName === 'LINK' && isStyleLink(el))) {
                const copy = this.document.importNode(el, true);
                copy.setAttribute('data-arc-page-head', '');
                this.document.head.appendChild(copy);
                this.headAdded.push(copy);
            }
        }
        const bodyScripts = Array.from(content?.querySelectorAll('script') ?? []);
        void this.runPageScripts([...headScripts, ...bodyScripts], content, drawn);
    }

    /**
     * Runs the scripts in order. A script set through innerHTML (or parsed apart)
     * never runs, so each is made anew: a body script in its place, a head script
     * at the end of document.head.
     */
    private async runPageScripts(scripts: HTMLScriptElement[], content: Element | null, drawn: number): Promise<void> {
        for (const old of scripts) {
            if (drawn !== this.drawn) return;
            if (!isRunnableScript(old)) continue;
            const script = this.document.createElement('script');
            for (const attr of Array.from(old.attributes)) script.setAttribute(attr.name, attr.value);
            script.textContent = old.textContent;
            const loaded = script.hasAttribute('src')
                ? new Promise<void>((resolve) => { script.onload = script.onerror = () => resolve(); })
                : null;
            if (content?.contains(old)) {
                old.replaceWith(script);
            } else {
                script.setAttribute('data-arc-page-head', '');
                this.document.head.appendChild(script);
                this.headAdded.push(script);
            }
            if (loaded) await loaded;
        }
    }

    /** Takes the page's styles out of document.head, so they do not reach other routes. */
    private clearPageHead(): void {
        this.drawn++;
        for (const el of this.headAdded) el.remove();
        this.headAdded = [];
    }
}

/** A <link> that styles the page: a stylesheet, or a font or style it preloads or a host it connects to early. */
function isStyleLink(link: Element): boolean {
    const rel = (link.getAttribute('rel') || '').toLowerCase().split(/\s+/);
    if (rel.includes('stylesheet') || rel.includes('preconnect') || rel.includes('dns-prefetch')) return true;
    const as = (link.getAttribute('as') || '').toLowerCase();
    return rel.includes('preload') && (as === 'style' || as === 'font');
}

/**
 * A script the browser would run: classic JavaScript or a module, not data such
 * as JSON-LD, and not a `nomodule` fallback, which a browser with modules skips
 * (with a src it would never fire load or error, and hold up every script after it).
 */
function isRunnableScript(script: HTMLScriptElement): boolean {
    if (script.hasAttribute('nomodule')) return false;
    const type = (script.getAttribute('type') || '').trim().toLowerCase();
    return !type || type === 'module' || /^(text|application)\/(x-)?(java|ecma)script$/.test(type);
}
