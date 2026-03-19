import { ChangeDetectorRef, Component, inject, OnInit, ViewEncapsulation } from '@angular/core';
import { CommonModule } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ActivatedRoute, Router } from '@angular/router';
import { DomSanitizer, Meta, SafeHtml, Title } from '@angular/platform-browser';
import { catchError, map, of, switchMap } from 'rxjs';
import { HeaderComponent } from '../page.parts/header.component';
import { FooterComponent } from '../page.parts/footer.component';
import { GaTrackingService } from '../../../shared/services/ga-tracking.service';

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
export class PublicPageRendererComponent implements OnInit {
    private http = inject(HttpClient);
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private sanitizer = inject(DomSanitizer);
    private titleService = inject(Title);
    private metaService = inject(Meta);
    private gaTracking = inject(GaTrackingService);
    private cdr = inject(ChangeDetectorRef);

    sanitizedContent: SafeHtml = '';
    hasHeader = false;
    hasFooter = false;

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

                // In SSR, relative URLs might need a base URL.
                // However, Analog/Angular Universal often handles this if properly configured.
                // Assuming client-side hydration or correct server interceptor for now.
                return this.http.get(`/pages/${cleanFileName}.html`, { responseType: 'text' }).pipe(
                    catchError(err => {
                        console.error('Error loading page:', err);
                        return of(null);
                    })
                );
            })
        ).subscribe(htmlContent => {
            if (htmlContent) {
                this.processHtml(htmlContent);
                this.cdr.detectChanges();
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
