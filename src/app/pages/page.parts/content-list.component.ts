import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, Injector, OnDestroy, OnInit, PLATFORM_ID, signal, untracked, TransferState, makeStateKey, ViewEncapsulation } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { SafeHtmlPipe } from '../../core/pipes/safe-html.pipe';
import { TemplateHydrationService } from '../../core/services/template-hydration.service';
import { isTemplateFragment } from '../../../shared/utils/template-fragment';
import { DEFAULT_TEMPLATE_FOLDER, siteTemplateUrl, templateFolderFor } from '../../core/site/site';
import { calculateReadingTime } from '../../core/utils/reading-time.util';
import { BaseComponent } from '../../../shared/components/base/base.component';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { ContentType, contentTypeDescription, contentTypeName } from '../admin/contents/content-types/content-types.model';
import { IContents } from '../admin/contents/content-store/published-contents.model';
import { TagsStore } from '../admin/contents/content-types/tags/tags.store';
import { FooterComponent } from './footer.component';
import { HeaderComponent } from './header.component';
import { PageSpinnerComponent } from './page-spinner.component';
import { GaTrackingService } from '../../../shared/services/ga-tracking.service';
import { LocalizationService } from '../../core/services/localization.service';
import { UiStringsService } from '../../core/services/ui-strings.service';
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
    imports: [CommonModule, HeaderComponent, FooterComponent, PageSpinnerComponent, SafeHtmlPipe],
    template: `
    <arc-header></arc-header>
    
    @if(awaitingFirstData()) {
        <arc-page-spinner />
    }
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
    } @else if(templateHtml()) {
        <!-- The type's list template (its folder's, else the default), hydrated -->
        <div [innerHTML]="templateHtml() | safeHtml"></div>
    } @else {
        <!-- The template is on its way -->
        <div class="loading-container">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>
    }
    }
    
    <arc-footer></arc-footer>
    `,
    styles: [`
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

    /**
     * Hydration guard: stays false until client-side data has loaded.
     * While false, the component renders nothing — letting SSR DOM survive.
     */
    hydrated = signal<boolean>(false);

    /**
     * Show a spinner in the body until the first client-side data lands.
     *
     * Only when the page arrived without server-rendered markup: production
     * serves an empty SPA shell for content routes, so without this the body
     * is blank and the site footer sits under the header until the data
     * arrives, then jumps. A server-rendered page keeps its own markup
     * (the dehydrated DOM survives until the app is stable), so a second
     * spinner would just stack on top of it.
     */
    awaitingFirstData = computed<boolean>(() => !this.hydrated() && !this.serverRendered);
    private readonly serverRendered = !isPlatformBrowser(this.platformId)
        || !!this.document.getElementById('ng-state');

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

    /**
     * The type's description in the page's language — the subtitle under the
     * heading, and the most visible English left if it goes untranslated.
     */
    typeDescription = computed(() => contentTypeDescription(this.currentContentType(), this.pageLang()));

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
            if (contentType && !isLoading && !this.templateHtml()) {
                this.loadCustomTemplate(contentType, contents);
            }
        });

        // Translations and the page's strings arrive after the template was
        // first hydrated; hydrate it again with them, without re-running its scripts.
        effect(() => {
            const contents = this.filteredContents();
            this.uiStrings.strings();
            untracked(() => {
                if (!this.lastTemplate) return;
                this.hydrateAndSetTemplate(this.lastTemplate.html, this.lastTemplate.contentType, contents, false);
            });
        });
    }

    ngOnInit() {
        const slug = this.activatedRoute.snapshot.paramMap.get('contentTypeSlug') || '';
        // Present only on the /{lang}/... route; absent means default language.
        const lang = this.activatedRoute.snapshot.paramMap.get('lang') || '';
        this.contentTypeSlug.set(slug);
        this.pageLang.set(lang);
        // List pages are deployed for every enabled language, so all of them
        // are genuinely reachable here.
        this.localization.languageVariants.set(
            this.localization.enabledLanguages().map(language => language.code),
        );
        // Chrome for this page's language; '' restores the authored English.
        this.uiStrings.use(lang);

        if (!slug) {
            return;
        }


        // Subscribe to stores to load data
        // Only the type this page is for. One equality query on `slug`
        // (ordered by the same field, so no composite index is needed) instead
        // of the store's default first page of ten ordered by createdAt, which
        // silently dropped the oldest types on sites with more than ten.
        this.subscribeToData(this.contentTypesStore, {
            whereConditions: [{ field: 'slug', operator: '==', value: slug }],
            orderByField: { field: 'slug', direction: 'asc' },
            limitCount: 1,
        });
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
        // The next page may have no variants at all.
        this.localization.languageVariants.set(null);
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

    /** A template folder whose file turned out not to be a template; the default is used instead. */
    private rejectedTemplateFolder: string | null = null;
    /** The template whose request is in flight. */
    private pendingTemplateUrl: string | null = null;
    /** The template as loaded, so it can be hydrated again. */
    private lastTemplate: { html: string; contentType: ContentType } | null = null;

    /**
     * Loads the type's list template, its folder's or the default
     * (siteTemplateUrl), and hydrates it. A folder file that turns out not to be
     * a template falls back to the default's once.
     */
    private loadCustomTemplate(contentType: ContentType, contents: IContents[]): void {
        const folder = templateFolderFor(contentType.templateFolder);
        const url = this.rejectedTemplateFolder === folder
            ? siteTemplateUrl(DEFAULT_TEMPLATE_FOLDER, 'list')
            : siteTemplateUrl(folder, 'list');

        if (url === this.pendingTemplateUrl) return;

        // Not while prerendering: a request from the server goes back to the app
        // itself, not to the static file. The page fills in once in the browser.
        if (!isPlatformBrowser(this.platformId)) return;

        const stateKey = makeStateKey<string>(`tpl-list-${url}`);
        if (this.transferState.hasKey(stateKey)) {
            const cachedHtml = this.transferState.get(stateKey, '');
            this.transferState.remove(stateKey);
            if (isTemplateFragment(cachedHtml)) {
                this.hydrateAndSetTemplate(cachedHtml, contentType, contents);
                return;
            }
        }

        this.pendingTemplateUrl = url;
        this.http.get(url, { responseType: 'text' }).subscribe({
            next: (templateHtml) => {
                this.pendingTemplateUrl = null;
                // A missing file answers with the app shell (HTTP 200, the 404
                // page); that is not a template.
                if (!isTemplateFragment(templateHtml)) {
                    console.warn(`[ContentListComponent] ${url} is not a template fragment.`);
                    if (folder !== DEFAULT_TEMPLATE_FOLDER && this.rejectedTemplateFolder !== folder) {
                        this.rejectedTemplateFolder = folder;
                        this.loadCustomTemplate(contentType, contents);
                    }
                    return;
                }
                this.hydrateAndSetTemplate(templateHtml, contentType, contents);
            },
            error: (error) => {
                this.pendingTemplateUrl = null;
                console.warn(`[ContentListComponent] Failed to load ${url}:`, error.message);
            }
        });
    }

    /**
     * Hydrate template HTML with content data and set it for rendering
     */
    private hydrateAndSetTemplate(templateHtml: string, contentType: ContentType, contents: IContents[], runScripts = true): void {
        this.lastTemplate = { html: templateHtml, contentType };
        // Prepare data for template hydration
        const lang = this.pageLang();
        const typeDescription = contentTypeDescription(contentType, lang);
        const templateData = {
            contentType: contentTypeName(contentType, lang),
            contentTypeSlug: contentType.slug,
            contentTypeDescription: typeDescription,
            description: typeDescription, // Keep for backward compatibility
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

        // Execute scripts after template is rendered (browser only)
        if (runScripts && isPlatformBrowser(this.platformId)) {
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
        // Title and description follow the page's language, like the heading
        // and subtitle they describe.
        const lang = this.pageLang();
        const typeName = contentTypeName(contentType, lang);
        const pageTitle = typeName;
        if (pageTitle) {
            this.titleService.setTitle(pageTitle);
        }

        // Set meta description from content type description or generate one
        const description = contentTypeDescription(contentType, lang)
            || `Browse all ${typeName?.toLowerCase() || 'content'}`;
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
