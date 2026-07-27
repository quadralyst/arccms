import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, Injector, OnDestroy, OnInit, PLATFORM_ID, signal, untracked, TransferState, makeStateKey, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { SafeHtmlPipe } from '../../core/pipes/safe-html.pipe';
import { TemplateHydrationService } from '../../core/services/template-hydration.service';
import { calculateReadingTime } from '../../core/utils/reading-time.util';
import { BaseComponent } from '../../../shared/components/base/base.component';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { ContentType, contentTypeName } from '../admin/contents/content-types/content-types.model';
import { IContents } from '../admin/contents/content-store/published-contents.model';
import { TagsStore } from '../admin/contents/content-types/tags/tags.store';
import { FooterComponent } from './footer.component';
import { HeaderComponent } from './header.component';
import { GaTrackingService } from '../../../shared/services/ga-tracking.service';
import { LocalizationService } from '../../core/services/localization.service';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { ArcTranslateDirective } from '../../core/directives/arc-translate.directive';
import { ContentsService } from '../admin/contents/content-store/published-contents.service';
import {
    IContentTranslation,
    mergeTranslation,
} from '../admin/contents/draft-content-store/content-translation.model';

/**
 * Dynamic Content List Component
 * Shows content list for a given content type, with optional template support
 */
@Component({
    selector: 'arc-content-list',
    standalone: true,
    imports: [CommonModule, HeaderComponent, FooterComponent, SafeHtmlPipe, ArcTranslateDirective],
    template: `
    <arc-header></arc-header>
    
    @if(hydrated()) {
    @if(contentTypesStore.isLoading() || contentsStore.isLoading() || !contentTypesStore.isSuccess()) {
        <div class="loading-container">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>
    } @else if(!currentContentType()) {
        <!-- Content type not found - show warning -->
        <div class="not-found-container">
            <div class="container text-center py-5">
                <i class="fas fa-folder-open fa-4x text-muted mb-4"></i>
                <h2>Content Type Not Found</h2>
                <p class="text-muted">The content type "{{ contentTypeSlug() }}" does not exist.</p>
                <a href="/" class="btn btn-primary mt-3">Go Home</a>
            </div>
        </div>
    } @else if(useCustomTemplate() && templateHtml()) {
        <!-- Render custom template -->
        <div [innerHTML]="templateHtml() | safeHtml"></div>
    } @else {
        <!-- Default template - Apple-inspired design -->
        <div class="content-list-page">
            <!-- Hero Section - Compact -->
            <section class="content-hero">
                <div class="container">
                    <h1 class="content-hero-title">{{ typeName() }}</h1>
                    <p class="content-hero-subtitle">{{ currentContentType()?.description || 'Discover insights, tutorials, and updates.' }}</p>
                </div>
            </section>

            <!-- Content Grid -->
            <section class="content-grid-section">
                <div class="container">
                    @if(filteredContents().length === 0) {
                        <div class="empty-state">
                            <i class="fas fa-newspaper"></i>
                            <h3 data-arc-t="empty_title">No Content Yet</h3>
                            <p data-arc-t="empty_body">Check back soon for new content.</p>
                        </div>
                    } @else {
                        <div class="content-grid">
                            @for(content of filteredContents(); track content.id) {
                                <a [href]="itemUrl(content.urlSlug)" class="content-card">
                                    <div class="content-card-image" [style.background-image]="content.coverImage ? 'url(' + content.coverImage + ')' : ''">
                                        @if(!content.coverImage) {
                                            <div class="content-card-placeholder"></div>
                                        }
                                    </div>
                                    <div class="content-card-body">
                                        <div class="content-card-meta">
                                            <time>{{ formatContentDate(content.publishedOn) }}</time>
                                            <span class="meta-separator">•</span>
                                            <span data-arc-t="min_read" [data-arc-t-params]="{ readTime: getReadTime(content) }">{{ getReadTime(content) }} min read</span>
                                        </div>
                                        <h2 class="content-card-title">{{ content.title }}</h2>
                                        <p class="content-card-excerpt">{{ getExcerpt(content) }}</p>
                                        <span class="content-card-read-more"><span data-arc-t="read_more">Read Article</span> <i class="fas fa-arrow-right"></i></span>
                                    </div>
                                </a>
                            }
                        </div>
                    }
                </div>
            </section>
        </div>
    }
    }
    
    <arc-footer></arc-footer>
    `,
    styles: [`
        /* Apple-inspired Content List Styles */
        .loading-container {
            min-height: 60vh;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        
        .not-found-container {
            min-height: 60vh;
            display: flex;
            align-items: center;
            justify-content: center;
            background: linear-gradient(180deg, #f5f5f7 0%, #ffffff 100%);
        }

        .content-list-page {
            min-height: 60vh;
        }

        /* Hero Section - Compact */
        .content-hero {
            padding: 3rem 0 2rem;
            text-align: center;
            background: linear-gradient(180deg, #f5f5f7 0%, #ffffff 100%);
        }

        .content-hero-title {
            font-size: 2.5rem;
            font-weight: 700;
            color: #1d1d1f;
            margin-bottom: 0.5rem;
            letter-spacing: -0.02em;
        }

        .content-hero-subtitle {
            font-size: 1rem;
            color: #6e6e73;
            max-width: 600px;
            margin: 0 auto;
            line-height: 1.4;
        }

        /* Content Grid Section */
        .content-grid-section {
            padding: 2rem 0 4rem;
            background: #ffffff;
        }

        .content-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(340px, 1fr));
            gap: 2rem;
        }

        /* Content Card */
        .content-card {
            display: flex;
            flex-direction: column;
            background: #ffffff;
            border-radius: 20px;
            overflow: hidden;
            text-decoration: none;
            color: inherit;
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            box-shadow: 0 2px 20px rgba(0, 0, 0, 0.06);
            height: 100%;
        }

        .content-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
        }

        .content-card:hover .content-card-read-more {
            color: #0066cc;
        }

        .content-card:hover .content-card-read-more i {
            transform: translateX(4px);
        }

        .content-card-image {
            position: relative;
            width: 100%;
            height: 200px;
            overflow: hidden;
            background-color: #f5f5f7;
            background-size: cover;
            background-position: center;
        }

        .content-card-placeholder {
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #e8e8ed 0%, #d2d2d7 100%);
        }

        .content-card-body {
            padding: 1.5rem;
            display: flex;
            flex-direction: column;
            flex: 1;
        }

        .content-card-meta {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
            color: #6e6e73;
            margin-bottom: 0.75rem;
        }

        .meta-separator {
            color: #d2d2d7;
        }

        .content-card-title {
            font-size: 1.25rem;
            font-weight: 600;
            color: #1d1d1f;
            line-height: 1.3;
            margin-bottom: 0.75rem;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .content-card-excerpt {
            font-size: 0.95rem;
            color: #6e6e73;
            line-height: 1.6;
            margin-bottom: 1.25rem;
            display: -webkit-box;
            -webkit-line-clamp: 3;
            -webkit-box-orient: vertical;
            overflow: hidden;
            flex: 1;
        }

        .content-card-read-more {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.9rem;
            font-weight: 500;
            color: #1d1d1f;
            transition: color 0.2s ease;
            margin-top: auto;
        }

        .content-card-read-more i {
            font-size: 0.75rem;
            transition: transform 0.2s ease;
        }

        /* Empty State */
        .empty-state {
            display: block;
            text-align: center;
            padding: 6rem 2rem;
        }

        .empty-state i {
            font-size: 4rem;
            color: #d2d2d7;
            margin-bottom: 1.5rem;
        }

        .empty-state h3 {
            font-size: 1.5rem;
            color: #1d1d1f;
            margin-bottom: 0.5rem;
        }

        .empty-state p {
            color: #6e6e73;
            font-size: 1rem;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .content-hero {
                padding: 4rem 0 3rem;
            }

            .content-hero-title {
                font-size: 2rem;
            }

            .content-grid {
                grid-template-columns: 1fr;
                gap: 1.5rem;
            }
        }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
})
export class ContentListComponent extends BaseComponent implements OnInit, OnDestroy {
    private document = inject(DOCUMENT);
    // Router and ActivatedRoute are already injected in BaseComponent as 'router' and 'activatedRoute'
    private http = inject(HttpClient);
    private titleService = inject(Title);
    private metaService = inject(Meta);
    private platformId = inject(PLATFORM_ID);
    private transferState = inject(TransferState);

    contentTypesStore = inject(ContentTypesStore);
    contentsStore = inject(ContentsStore);
    // Resolved lazily — only the /{lang}/ route needs it. See
    // ContentDetailComponent for why this is not injected eagerly.
    private injector = inject(Injector);
    private localization = inject(LocalizationService);
    private uiStrings = inject(UiStringsService);
    tagsStore = inject(TagsStore);
    private gaTracking = inject(GaTrackingService);
    private trackedContentTypes = new Set<string>();

    contentTypeSlug = signal<string>('');
    templateHtml = signal<string>('');
    useCustomTemplate = signal<boolean>(false);

    /**
     * Hydration guard: stays false until client-side data has loaded.
     * While false, the component renders nothing — letting SSR DOM survive.
     */
    hydrated = signal<boolean>(false);

    // Gradient colors for cards without images
    private gradients = [
        'linear-gradient(135deg, #3c76f5 0%, #1d47a3 100%)',
        'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        'linear-gradient(135deg, #43e97b 0%, #38f9d7 100%)',
        'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        'linear-gradient(135deg, #a8edea 0%, #fed6e3 100%)',
    ];

    currentContentType = computed(() => {
        const slug = this.contentTypeSlug();
        const types = this.contentTypesStore.items();
        return types.find((ct: ContentType) => ct.slug === slug) || null;
    });

    /** The content type's name in the page's language (M-D19). */
    typeName = computed(() => {
        const type = this.currentContentType();
        return type ? contentTypeName(type, this.pageLang()) : '';
    });

    /** Language prefix of the current URL — '' on the default-language route. */
    pageLang = signal<string>('');
    /** Translations for the listed items, keyed by document id. */
    private translations = signal<Record<string, IContentTranslation>>({});

    filteredContents = computed(() => {
        const contentType = this.currentContentType();
        if (!contentType) return [];
        const translations = this.translations();
        const lang = this.pageLang();
        const items = this.contentsStore.items()
            .filter((content: IContents) =>
                content.type === contentType.slug && content.publishedStatus
            )
            // Untranslated items keep their default-language card rather than
            // dropping out — a half-empty list reads as a broken site, and
            // partial translation is the normal state. Matches the deploy.
            .map((content: IContents): IContents =>
                lang ? mergeTranslation(content, translations[content.id] ?? null) : content
            );

        // Sort by publishedOn descending (newest first).
        // Handles Firestore Timestamps ({seconds, nanoseconds}), Date objects, and ISO strings.
        return items.sort((a, b) => {
            const dateA = this.toTimestamp(a.publishedOn);
            const dateB = this.toTimestamp(b.publishedOn);
            return dateB - dateA;
        });
    });

    constructor() {
        super();

        // On the server, mark as hydrated immediately so SSR renders content
        if (!isPlatformBrowser(this.platformId)) {
            this.hydrated.set(true);
        }

        // Load the listed items' translations once the store has filled — ids
        // are not known before then. Reads only the store and the language, so
        // writing `translations` below cannot re-trigger it.
        effect(() => {
            const lang = this.pageLang();
            const items = this.contentsStore.items();
            if (!lang || this.translationsRequested) return;

            const forType = items.filter((content: IContents) => content.type === this.contentTypeSlug());
            if (forType.length === 0) return;

            this.translationsRequested = true;
            untracked(() => this.loadTranslations(lang, this.contentTypeSlug(), forType));
        });

        // Watch for content type and contents to load, then trigger template loading and SEO updates
        effect(() => {
            const contentType = this.currentContentType();
            const contents = this.filteredContents();
            const isLoading = this.contentTypesStore.isLoading() || this.contentsStore.isLoading();

            // Update SEO meta tags when content type is available
            if (contentType && !isLoading) {
                this.updateSeoMeta(contentType);
                // Mark as hydrated — client data is now available
                if (!this.hydrated()) {
                    this.hydrated.set(true);
                }
                // Track content list view (once per content type)
                if (!this.trackedContentTypes.has(contentType.slug)) {
                    this.trackedContentTypes.add(contentType.slug);
                    this.gaTracking.trackContentListView(contentType.slug, contents.length);
                }
            }

            // Only load template when we have content type, not loading, and haven't loaded yet
            if (contentType && !isLoading && !this.useCustomTemplate()) {
                this.loadCustomTemplate(contentType, contents);
            }
        });
    }

    ngOnInit() {
        const slug = this.activatedRoute.snapshot.paramMap.get('contentTypeSlug') || '';
        // Present only on the /{lang}/... route; absent means default language.
        const lang = this.activatedRoute.snapshot.paramMap.get('lang') || '';
        this.contentTypeSlug.set(slug);
        this.pageLang.set(lang);
        // Content pages are published per language, so the switcher applies here.
        this.localization.hasLanguageVariants.set(true);
        // Chrome for this page's language; '' restores the authored English.
        this.uiStrings.use(lang);

        if (!slug) {
            return;
        }


        // Subscribe to stores to load data
        this.subscribeToData(this.contentTypesStore);
        // Load published contents from the per-type collection
        this.contentsStore.getAll(undefined, slug || undefined);
    }

    /**
     * Open Graph locale for the current page. Open Graph wants
     * `language_TERRITORY`; a bare language subtag is emitted when the
     * configured code carries no region. Mirrors toOgLocale() in
     * functions/src/shared/html-document.ts.
     */
    ogLocale(): string {
        const lang = this.pageLang();
        if (!lang) return 'en_US';
        const [language, region] = lang.toLowerCase().split('-');
        return region ? `${language}_${region.toUpperCase()}` : language;
    }

    /** Keeps card links inside the language currently being viewed. */
    itemUrl(urlSlug: string): string {
        const prefix = this.pageLang() ? `/${this.pageLang()}` : '';
        return `${prefix}/${this.contentTypeSlug()}/${urlSlug}`;
    }

    ngOnDestroy(): void {
        // The next page may not have language variants.
        this.localization.hasLanguageVariants.set(false);
    }

    /**
     * Reads the language variant of every listed item.
     *
     * Waits for the store to fill, since the ids are only known then. One read
     * per item is acceptable here: the SPA path is a fallback for previews and
     * pages that are not yet deployed, not the production render.
     */
    private translationsRequested = false;

    private async loadTranslations(lang: string, typeSlug: string, items: IContents[]): Promise<void> {
        try {

            const service = this.injector.get(ContentsService);
            const loaded: Record<string, IContentTranslation> = {};
            await Promise.all(items.map(async (content: IContents) => {
                const translation = await service.getTranslation(typeSlug, content.id, lang);
                if (translation) loaded[content.id] = translation;
            }));
            this.translations.set(loaded);
        } catch (error) {
            // Rendering the list in the default language is correct degradation.
            console.error('Error loading list translations:', error);
        }
    }

    /**
     * Load and hydrate custom template when content type and content are ready
     */
    private loadCustomTemplate(contentType: ContentType, contents: IContents[]): void {
        const templateFolder = contentType.templateFolder;

        // Skip if using default template
        if (!templateFolder || templateFolder === 'default') {
            this.useCustomTemplate.set(false);
            return;
        }

        // During SSR, skip custom template loading and use the default template.
        // The SSR Cloud Function can't serve static assets via HttpClient (the request
        // goes back to the SSR handler, which returns the Angular 404 page instead of
        // the template file). The default template provides good SSR output for SEO.
        // After client hydration, the custom template loads normally from static assets.
        if (!isPlatformBrowser(this.platformId)) {
            this.useCustomTemplate.set(false);
            return;
        }

        // Build template URL - using generic filename
        const templateUrl = `/templates/${templateFolder}/list.html`;
        const stateKey = makeStateKey<string>(`tpl-list-${templateFolder}`);

        // Check TransferState first (cached from SSR)
        if (this.transferState.hasKey(stateKey)) {
            const cachedHtml = this.transferState.get(stateKey, '');
            this.transferState.remove(stateKey);
            this.hydrateAndSetTemplate(cachedHtml, contentType, contents);
            return;
        }

        this.http.get(templateUrl, { responseType: 'text' }).subscribe({
            next: (templateHtml) => {
                this.hydrateAndSetTemplate(templateHtml, contentType, contents);
            },
            error: (error) => {
                console.warn('[ContentListComponent] Failed to load custom template:', error.message);
                this.useCustomTemplate.set(false);
            }
        });
    }

    /**
     * Hydrate template HTML with content data and set it for rendering
     */
    private hydrateAndSetTemplate(templateHtml: string, contentType: ContentType, contents: IContents[]): void {
        // Prepare data for template hydration
        const templateData = {
            contentType: contentType.name,
            contentTypeSlug: contentType.slug,
            contentTypeDescription: contentType.description || '',
            description: contentType.description || '', // Keep for backward compatibility
        };

        // Prepare list data for loops - transform content items
        const listData = contents.map(content => {
            const tagsData = (content as any).tagsWithColors ||
                (content.tags || []).map((t: string) => ({ name: t, color: '#6b7280' }));

            // Pre-render tags HTML for colored pills (since nested loops aren't supported)
            const tagsHtml = tagsData.slice(0, 3).map((tag: { name: string; color: string }) =>
                `<span class="tag-pill arc-skeleton" style="background-color: ${tag.color}; color: #333;">${tag.name}</span>`
            ).join('');


            return {
                id: content.id,
                title: content.title,
                urlSlug: content.urlSlug,
                url: `/${contentType.slug}/${content.urlSlug}`,
                coverImage: content.coverImage || '',
                excerpt: this.getExcerpt(content),
                content: content.content || '',
                publishedOn: this.formatContentDate(content.publishedOn),
                readTime: this.getReadTime(content),
                author: (content as any).author || '',
                tags: tagsData,
                tagsHtml: tagsHtml, // Pre-rendered HTML for colored pills
                tagsDisplay: (content.tags || []).slice(0, 3).join(', '), // Fallback text
                contentType: contentType.name, // Add content type name for cards
                cat: contentType.name, // Backward compatibility alias
                ...((content as any).customFields || {}), // Include any custom fields
            };
        });

        // First process loops with list data
        // See ContentDetailComponent — chrome before loops and bindings.
        const localizedTemplate = TemplateHydrationService.applyStrings(templateHtml, this.uiStrings.strings());
        let hydratedHtml = TemplateHydrationService.processLoops(localizedTemplate, { items: listData });

        // Then hydrate with page-level data
        hydratedHtml = TemplateHydrationService.hydrateTemplate(hydratedHtml, templateData);

        this.templateHtml.set(hydratedHtml);
        this.useCustomTemplate.set(true);

        // Execute scripts after template is rendered (browser only)
        if (isPlatformBrowser(this.platformId)) {
            setTimeout(() => this.runTemplateScripts(), 100);
        }
    }

    /**
     * Manually execute script tags found in the template
     * Angular's [innerHTML] prevents script execution for security
     */
    private runTemplateScripts(): void {
        const scripts = this.document.querySelectorAll('arc-content-list script');

        scripts.forEach(oldScript => {
            const newScript = this.document.createElement('script');
            Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
            newScript.appendChild(this.document.createTextNode(oldScript.innerHTML));
            oldScript.parentNode?.replaceChild(newScript, oldScript);
        });
    }

    /**
     * Update page SEO meta tags from content type data
     */
    private updateSeoMeta(contentType: ContentType): void {
        // Set page title from content type name
        const pageTitle = contentType.name;
        if (pageTitle) {
            this.titleService.setTitle(pageTitle);
        }

        // Set meta description from content type description or generate one
        const description = contentType.description || `Browse all ${contentType.name?.toLowerCase() || 'content'}`;
        this.metaService.updateTag({ name: 'description', content: description });

        // Build canonical/og:url for the list page
        const listUrl = isPlatformBrowser(this.platformId)
            ? window.location.href
            : `/${contentType.slug}`;
        this.metaService.updateTag({ property: 'og:url', content: listUrl });
        this.updateCanonicalUrl(listUrl);

        // Set Open Graph tags for social sharing
        this.metaService.updateTag({ property: 'og:title', content: pageTitle || '' });
        this.metaService.updateTag({ property: 'og:description', content: description });
        this.metaService.updateTag({ property: 'og:type', content: 'website' });
        this.metaService.updateTag({ property: 'og:site_name', content: 'Arc CMS' });
        // Reflects the language prefix in the URL; the default language
        // keeps en_US, matching what the publish pipeline emits.
        this.metaService.updateTag({ property: 'og:locale', content: this.ogLocale() });

        // Robots — allow indexing of all published content list pages
        this.metaService.updateTag({ name: 'robots', content: 'index, follow' });

        // Set Twitter Card tags
        this.metaService.updateTag({ name: 'twitter:card', content: 'summary' });
        this.metaService.updateTag({ name: 'twitter:title', content: pageTitle || '' });
        this.metaService.updateTag({ name: 'twitter:description', content: description });
    }

    /**
     * Update or create canonical URL link element
     */
    private updateCanonicalUrl(url: string): void {
        let link: HTMLLinkElement | null = this.document.querySelector('link[rel="canonical"]');
        if (!link) {
            link = this.document.createElement('link');
            link.setAttribute('rel', 'canonical');
            this.document.head.appendChild(link);
        }
        link.setAttribute('href', url);
    }

    /** Convert Firestore Timestamp, Date, or ISO string to epoch ms for sorting */
    private toTimestamp(date: any): number {
        if (!date) return 0;
        if (date.seconds) return date.seconds * 1000;
        const d = new Date(date);
        return isNaN(d.getTime()) ? 0 : d.getTime();
    }

    getGradient(contentId: string): string {
        const index = contentId.charCodeAt(0) % this.gradients.length;
        return this.gradients[index];
    }

    formatContentDate(date: any): string {
        if (!date) return '';
        const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
        return dateObj.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
    }

    getReadTime(content: IContents): number {
        return content.readTime || calculateReadingTime(content.content);
    }

    getExcerpt(content: IContents): string {
        const text = content.metaDescription || content.content || '';
        const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
        const words = cleanText.split(' ').slice(0, 25);
        return words.length >= 25 ? words.join(' ') + '...' : cleanText;
    }
}
