import { ChangeDetectorRef, Component, inject, OnDestroy, OnInit, PLATFORM_ID, ViewEncapsulation } from '@angular/core';
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
    private cdr = inject(ChangeDetectorRef);
    private document = inject(DOCUMENT);
    private platformId = inject(PLATFORM_ID);
    /** The live parts' script for the page's forms (SS5). */
    private liveScript: HTMLScriptElement | null = null;

    sanitizedContent: SafeHtml = '';
    hasHeader = false;
    hasFooter = false;

    ngOnDestroy(): void {
        this.liveScript?.remove();
    }

    ngOnInit() {
        this.route.params.pipe(
            map(params => params['fileName']),
            switchMap(fileName => {
                if (!fileName || fileName.toLowerCase() === 'index') {
                    return of(null);
                }

                // Handle optional .html extension
                const cleanFileName = fileName.endsWith('.html') ? fileName.substring(0, fileName.length - 5) : fileName;

                // Track public page view
                this.gaTracking.trackPublicPageView(cleanFileName);

                // A page the site does not have would answer with the app shell
                // (HTTP 200), so only pages in the site's manifest are fetched.
                if (!siteManifest().pages[cleanFileName]) {
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
            if (htmlContent) {
                // The site's own details for data-arc-site (SS3), read only when the page asks.
                const about = htmlContent.includes('data-arc-site') ? await this.siteIdentity.load() : null;
                this.processHtml(applySiteInfoToHtml(htmlContent, about));
                this.cdr.detectChanges();
                // Signup and contact forms on the page work as when published (SS5).
                if (isPlatformBrowser(this.platformId)) {
                    this.liveScript?.remove();
                    const content = this.document.querySelector('.public-page-content');
                    this.liveScript = content ? attachLiveParts(content, this.document) : null;
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

        // 3. Content Extraction (Body)
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
}
