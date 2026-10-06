import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { SitePagesService } from '../../core/site/site-pages.service';
import { siteInfoOf } from '../../core/site/site-info-source';
import { attachLiveParts } from '../../core/site/live-parts';
import { QueryParams } from '../../../shared/models/queries.model';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Injector, OnDestroy, OnInit, PLATFORM_ID, signal, untracked, ViewEncapsulation, effect, TransferState, makeStateKey } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { Meta, Title } from '@angular/platform-browser';
import { SafeHtmlPipe } from '../../core/pipes/safe-html.pipe';
import { TemplateHydrationService } from '../../core/services/template-hydration.service';
import { isTemplateFragment } from '../../../shared/utils/template-fragment';
import { DEFAULT_TEMPLATE_FOLDER, siteLayoutUrl, siteTemplateUrl, templateFolderFor } from '../../core/site/site';
import { calculateReadingTime } from '../../core/utils/reading-time.util';
import { BaseComponent } from '../../../shared/components/base/base.component';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { ContentType, contentTypeName } from '../admin/contents/content-types/content-types.model';
import { IContents } from '../admin/contents/content-store/published-contents.model';
import { DraftContentsStore } from '../admin/contents/draft-content-store/draft-contents.store';
import { Auth, authState } from '@angular/fire/auth';
import { IDraftContents } from '../admin/contents/draft-content-store/draft-contents.model';
import { toSignal } from '@angular/core/rxjs-interop';
import { FooterComponent } from './footer.component';
import { HeaderComponent } from './header.component';
import { PageSpinnerComponent } from './page-spinner.component';
import { GaTrackingService } from '../../../shared/services/ga-tracking.service';
import { LocalizationService } from '../../core/services/localization.service';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { interpolate } from '../../core/i18n/interpolate';
import { notFoundText, NotFoundStringKey } from './not-found-strings';
import { MediaSettingsService } from '../../core/services/media-settings.service';
import { ContentsService } from '../admin/contents/content-store/published-contents.service';
import { DraftContentsService } from '../admin/contents/draft-content-store/draft-contents.service';
import { SiteIdentityService } from '../../core/services/site-identity.service';
import { AuthorProfileService } from '../../core/services/author-profile.service';
import { IAuthor } from '../../../shared/models/author.model';
import { abstractFromTakeaways, blockJsonLd, extractBlocks } from '../../../shared/utils/content-blocks';
import { cleanReferences } from '../../../shared/models/references.model';
import { buildMappedNode } from '../../../shared/utils/schema-mapping';
import { SearchService } from '../../core/services/search.service';
import { isOn } from '../../core/features/features';
import { RELATED_LIMIT, RelatedItem, pickRelated, relatedQuery } from '../../../shared/utils/related-content';
import {
    buildBreadcrumbList,
    buildOrganization,
    buildWebSite,
    countWords,
    organizationId,
    resolveContentDates,
    setJsonLd,
    buildFaqPage,
    faqItems,
} from '../../../shared/utils/structured-data';
import {
    IContentTranslation,
    localizedPageTitle,
    mergeTranslation,
} from '../admin/contents/draft-content-store/content-translation.model';

/**
 * Dynamic Content Detail Component
 * Shows individual content item for a given content type and URL slug
 */
/** Upper bound on block-derived JSON-LD scripts a page keeps (FAQ + how-tos + definitions). */
const MAX_BLOCK_NODES = 12;

@Component({
    selector: 'arc-content-detail',
    standalone: true,
    imports: [CommonModule, HeaderComponent, FooterComponent, PageSpinnerComponent, SafeHtmlPipe],
    template: `
    <arc-header></arc-header>
    
    @if(awaitingFirstData()) {
        <arc-page-spinner />
    }
    @if(hydrated()) {
    @if(contentTypesStore.isLoading() || contentsStore.isLoading() || isCheckingDraft() || !contentsStore.isSuccess()) {
        <div class="loading-container">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>
    } @else if(templateHtml()) {
        <!-- The type's detail template (its folder's, else the default), hydrated -->
        <div [innerHTML]="templateHtml() | safeHtml"></div>
    } @else if(!currentContent() && showNotFound()) {
        <!-- Content not found — shown after 3-second delay to prevent flash -->
        <div class="not-found-container">
            <div class="container text-center py-5">
                <i class="fas fa-file-alt fa-4x text-muted mb-4"></i>
                <h2>{{ notFound('content_not_found_title') }}</h2>
                <p class="text-muted">{{ notFound('content_not_found_body') }}</p>
                <a href="/" class="btn btn-primary mt-3">{{ notFound('go_home') }}</a>
            </div>
        </div>
    } @else if(!currentContent() && !showNotFound()) {
        <!-- Loading placeholder while waiting to confirm content is not found -->
        <div class="loading-container">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>
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
export class ContentDetailComponent extends BaseComponent implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private http = inject(HttpClient);
    private titleService = inject(Title);
    private metaService = inject(Meta);
    private siteIdentity = inject(SiteIdentityService);
    private sitePages = inject(SitePagesService);
    private authorProfiles = inject(AuthorProfileService);

    /** The credited author, once loaded (D2). Null when the item has none. */
    author = signal<IAuthor | null>(null);

    /** Cited sources (D-D11), cleaned. */
    references = computed(() => cleanReferences(this.currentContent()?.references));

    /** Related items from the search index (D-D15); the static page has them baked in. */
    related = signal<RelatedItem[]>([]);
    private searchService = inject(SearchService);
    private relatedKey = '';
    private document = inject(DOCUMENT);
    private platformId = inject(PLATFORM_ID);
    private transferState = inject(TransferState);

    contentTypesStore = inject(ContentTypesStore);
    contentsStore = inject(ContentsStore);
    draftContentsStore = inject(DraftContentsStore);
    // Resolved lazily: these reach Firestore through DbService, and only the
    // /{lang}/ routes ever need them. Injecting eagerly would make every page
    // that renders content — and its spec — depend on Firestore.
    private injector = inject(Injector);
    private localization = inject(LocalizationService);
    private uiStrings = inject(UiStringsService);
    private mediaSettings = inject(MediaSettingsService);
    private auth = inject(Auth);
    private gaTracking = inject(GaTrackingService);

    /** The not-found text in the page's language (the site's strings). */
    notFound(key: NotFoundStringKey): string {
        return notFoundText(this.uiStrings.strings(), key);
    }

    private trackedContent = false;

    contentTypeSlug = signal<string>('');
    urlSlug = signal<string>('');
    templateHtml = signal<string>('');
    isPreview = signal<boolean>(false);
    draftContent = signal<IDraftContents | null>(null);
    user = toSignal(authState(this.auth));

    /**
     * Hydration guard: stays false until client-side data has loaded.
     * While false, the component renders nothing — letting SSR DOM survive.
     * On the server, always true so SSR renders the loading state.
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

    currentContentType = computed(() => {
        const slug = this.contentTypeSlug();
        const types = this.contentTypesStore.items();
        return types.find((ct: ContentType) => ct.slug === slug) || null;
    });

    /** Keeps the back-links inside the language currently being viewed. */
    listUrl(): string {
        const prefix = this.pageLang() ? `/${this.pageLang()}` : '';
        return `${prefix}/${this.contentTypeSlug()}`;
    }

    /** The content type's name in the page's language (M-D19). */
    typeName = computed(() => {
        const type = this.currentContentType();
        return type ? contentTypeName(type, this.pageLang()) : '';
    });

    /** Language prefix of the current URL — '' on the default-language routes. */
    pageLang = signal<string>('');
    /** Translation for `pageLang`, once loaded. */
    private translation = signal<IContentTranslation | null>(null);

    currentContent = computed(() => {
        // If we have a draft content loaded and we are in preview mode, use it
        if (this.isPreview() && this.draftContent()) {
          const draft = this.draftContent();
          return this.localize({
            ...draft,
            // Map draft properties to IContents interface if needed
            // Ensure compatibility between IDraftContents and IContents
            publishedStatus: false, // It's a draft
            publishedOn: draft?.publishedOn || draft?.createdAt,
          } as any);
        }

        const contentType = this.currentContentType();
        const slug = this.urlSlug();
        if (!contentType || !slug) return null;

        const content = this.contentsStore.items().find((content: IContents) =>
            content.urlSlug === slug &&
            content.type === contentType.slug &&
            content.publishedStatus
        ) || null;

        return content ? this.localize(content) : null;
    });

    /**
     * Overlays the loaded translation. Untranslated fields keep their
     * default-language values, matching what the publish pipeline deploys —
     * both sides call the same merge.
     */
    private localize<T extends Record<string, any>>(content: T): T {
        if (!this.pageLang()) return content;
        return mergeTranslation(content, this.translation());
    }

    /** Guards against re-reading the translation on every store emission. */
    private translationRequested = false;

    /** Tells the switcher which languages this item actually exists in. */
    private async announceVariants(typeSlug: string, docId: string): Promise<void> {
        const defaultLang = this.localization.defaultLanguage();
        try {
            const translated = await this.injector
                .get(ContentsService)
                .getTranslatedLanguages(typeSlug, docId);
            this.localization.languageVariants.set([defaultLang, ...translated]);
        } catch {
            this.localization.languageVariants.set([defaultLang]);
        }
    }

    /**
     * Reads the language variant for this page. Published content first; a
     * preview falls back to the draft variant, so an unpublished translation
     * can still be previewed.
     *
     * Driven by an effect rather than ngOnInit because the document id is only
     * known once the content store has loaded.
     */
    private async loadTranslation(lang: string, typeSlug: string, docId: string): Promise<void> {
        try {
            const translation = this.isPreview()
                ? await this.injector.get(DraftContentsService).getTranslation(typeSlug, docId, lang)
                : await this.injector.get(ContentsService).getTranslation(typeSlug, docId, lang);
            this.translation.set(translation);
        } catch (error) {
            // Rendering in the default language is the correct degradation.
            console.error('Error loading translation:', error);
        }
    }

    // Flag to track if we are currently checking for a draft
    isCheckingDraft = signal<boolean>(false);

    // Delayed "not found" flag — prevents immediate 404 flash
    showNotFound = signal<boolean>(false);
    private notFoundTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        super();
        // Image size bindings fit the configured maximum, as when published.
        void this.mediaSettings.load();
        // The site's own details for data-arc-site (SS3) and its standard pages (SS6);
        // the template redraws when they arrive.
        void this.siteIdentity.load();
        void this.sitePages.load(this.uiStrings.activeLang());

        // On the server, mark as hydrated immediately so SSR renders content
        if (!isPlatformBrowser(this.platformId)) {
            this.hydrated.set(true);
        }

        // Watch for content loading to trigger template loading and SEO updates
        // Load this page's translation once the content store has filled — the
        // document id is not known before then. Reads only the store and the
        // language, so writing `translation` below cannot re-trigger it.
        effect(() => {
            const items = this.contentsStore.items();
            if (this.translationRequested) return;

            const match = items.find((content: IContents) =>
                content.urlSlug === this.urlSlug() && content.type === this.contentTypeSlug());
            if (!match?.id) return;

            this.translationRequested = true;
            const lang = this.pageLang();
            untracked(() => {
                if (lang) this.loadTranslation(lang, this.contentTypeSlug(), match.id);
                // The switcher may now offer exactly the languages this item
                // has, rather than everything enabled site-wide.
                this.announceVariants(this.contentTypeSlug(), match.id);
            });
        });

        // Related items: one lookup per item and language, never blocking render.
        effect(() => {
            const content = this.currentContent();
            const typeSlug = this.contentTypeSlug();
            const lang = this.pageLang() || this.localization.defaultLanguage();
            untracked(() => {
                // Related items come from search; without it there are none.
                if (!content?.urlSlug || !isPlatformBrowser(this.platformId) || !isOn('search')) return;
                const key = `${typeSlug}/${content.urlSlug}/${lang}`;
                if (key === this.relatedKey) return;
                this.relatedKey = key;
                this.related.set([]);
                const q = relatedQuery(content.title || '', content.tags || []);
                if (!q) return;
                this.searchService
                    .lookup({ q, lang, scope: 'public', sources: ['content'], limit: RELATED_LIMIT + 1 })
                    .then(res => { if (this.relatedKey === key) this.related.set(pickRelated(res.results, { contentType: typeSlug, urlSlug: content.urlSlug })); })
                    .catch(() => undefined);
            });
        });

        // The author document is separate from the content; fetch it once
        // per authorId and let the page (byline box, JSON-LD) react.
        effect(() => {
            const authorId = this.currentContent()?.authorId || '';
            untracked(() => {
                if (!authorId || !isPlatformBrowser(this.platformId)) {
                    this.author.set(null);
                    return;
                }
                this.authorProfiles.load(authorId).then(author => this.author.set(author));
            });
        });

        // The author, the related items and the page's strings arrive after the
        // template was first hydrated; hydrate it again with them, without
        // re-running its scripts.
        effect(() => {
            this.author();
            this.related();
            this.uiStrings.strings();
            this.mediaSettings.maxSize();
            this.siteIdentity.identity();
            this.sitePages.pages();
            untracked(() => {
                if (!this.lastTemplate) return;
                const { html, contentType, content } = this.lastTemplate;
                this.hydrateAndSetTemplate(html, contentType, content, false);
            });
        });

        effect(() => {
            const contentType = this.currentContentType();
            const content = this.currentContent();
            const isLoading = this.contentTypesStore.isLoading() || this.contentsStore.isLoading();
            const isCheckingDraft = this.isCheckingDraft();
            // Read so the structured data is rewritten once the author lands.
            this.author();

            // Update SEO meta tags when content is available
            if (content && !isLoading && !isCheckingDraft) {
                this.updateSeoMeta(content);
                // Mark as hydrated — client data is now available
                if (!this.hydrated()) {
                    this.hydrated.set(true);
                }
                // Track content detail view (once per load)
                if (!this.trackedContent && contentType) {
                    this.trackedContent = true;
                    this.gaTracking.trackContentDetailView(contentType.slug, content.urlSlug, content.title);
                }
            } else if (!isLoading && !isCheckingDraft && !content) {
                 // Content not found — show loader first, then 404 after 3 seconds
                 if (!this.hydrated()) {
                    this.hydrated.set(true);
                 }
                 if (!this.showNotFound() && this.notFoundTimer === null) {
                    this.notFoundTimer = setTimeout(() => this.showNotFound.set(true), 3000);
                 }
            } else if (content) {
                 // Content found — cancel any pending not-found timer
                 if (this.notFoundTimer !== null) {
                    clearTimeout(this.notFoundTimer);
                    this.notFoundTimer = null;
                 }
            }

            // Load the template once there is content, and again when the item
            // needs another one: a preview's draft can arrive after the published
            // copy with a different layout (SS8).
            if (contentType && content && !isLoading
                && (!this.templateHtml() || this.templateUrlFor(contentType, content) !== this.loadedTemplateUrl)) {
                this.loadCustomTemplate(contentType, content);
            }
        });

        // Effect to load draft content if in preview mode and logged in
        effect(() => {
          const isPreview = this.isPreview();
          const user = this.user();
          const slug = this.urlSlug();

          if (isPreview && user && slug) {
            // Start checking
            this.isCheckingDraft.set(true);
            
            this.draftContentsStore.getBySlug(slug, this.contentTypeSlug()).then(content => {
              if (content) {
                this.draftContent.set(content);
              }
              // Done checking
              this.isCheckingDraft.set(false);
            }).catch(err => {
                console.error("Error fetching draft for preview:", err);
                this.isCheckingDraft.set(false);
            });
          }
        });
    }

    ngOnInit() {
        const typeSlug = this.route.snapshot.paramMap.get('contentTypeSlug') || '';
        const contentSlug = this.route.snapshot.paramMap.get('urlSlug') || '';
        const isPreview = this.route.snapshot.queryParamMap.get('preview') === 'true';
        // Present only on the /{lang}/... routes; absent means default language.
        const lang = this.route.snapshot.paramMap.get('lang') || '';

        this.contentTypeSlug.set(typeSlug);
        this.urlSlug.set(contentSlug);
        this.isPreview.set(isPreview);
        this.pageLang.set(lang);
        // Filled in once the published translations are known; until then the
        // default language alone, so no dead link is ever offered.
        this.localization.languageVariants.set(
            [this.localization.defaultLanguage()],
        );
        // Chrome for this page's language; '' restores the authored English.
        this.uiStrings.use(lang);

        // Eagerly set isCheckingDraft to prevent 404 flash before the effect fires
        if (isPreview) {
            this.isCheckingDraft.set(true);
        }

        if (!typeSlug || !contentSlug) {
            return;
        }

        // Subscribe to stores to load data
        // Only the type this page is for. One equality query on `slug`
        // (ordered by the same field, so no composite index is needed) instead
        // of the store's default first page of ten ordered by createdAt, which
        // silently dropped the oldest types on sites with more than ten.
        this.subscribeToData(this.contentTypesStore, {
            whereConditions: [{ field: 'slug', operator: '==', value: typeSlug }],
            orderByField: { field: 'slug', direction: 'asc' },
            limitCount: 1,
        });
        // This page's item only, by its URL slug. The store's default is a first
        // page of ten in no useful order, so an item outside those ten read as
        // "not found" on a site with more.
        this.contentsStore.getAll(
            { whereConditions: [{ field: 'urlSlug', operator: '==', value: contentSlug }], limitCount: 1 } as QueryParams,
            typeSlug || undefined,
        );
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

    ngOnDestroy(): void {
        this.liveScript?.remove();
        // The next page may have no variants at all.
        this.localization.languageVariants.set(null);
        // Nor the same structured data: the home page writes its own site nodes.
        for (const id of ['arc-ld-organization', 'arc-ld-website', 'arc-ld-breadcrumbs', 'arc-ld-article', 'arc-ld-faq']) {
            setJsonLd(this.document, id, null);
        }
        for (let i = 0; i < MAX_BLOCK_NODES; i++) setJsonLd(this.document, `arc-ld-block-${i}`, null);
        if (this.notFoundTimer !== null) {
            clearTimeout(this.notFoundTimer);
            this.notFoundTimer = null;
        }
    }

    /**
     * "Updated {date}" text, or '' unless `updatedOn` is later than the publish
     * date. Same rule as the static renderer (specs/discoverability-spec.md, D-D3).
     */
    updatedOnDisplay = computed(() => {
        const content = this.currentContent();
        if (!content) return '';
        const dates = resolveContentDates(content);
        return dates.isUpdated ? this.formatContentDate(content.updatedOn) : '';
    });

    /** `author.*` bindings and `authorName` for custom templates; empty without an author. */
    private authorTemplateData(): { author: Record<string, string>; authorName: string } {
        const author = this.author();
        // Without a profile (a deleted author) the stored name stays as plain
        // text: the byline keeps it, the author box stays empty. The same rule
        // as publishing (functions/src/shared/authors.ts authorTemplateData).
        if (!author?.name) return { author: {}, authorName: this.currentContent()?.authorName || '' };
        return {
            author: {
                name: author.name,
                bio: author.bio || '',
                photoUrl: author.photoUrl || '',
                jobTitle: author.jobTitle || '',
                url: author.url || '',
            },
            authorName: author.name,
        };
    }

    /** "January 5, 2026" in the page's language, as on a published page. */
    formatContentDate(date: any): string {
        if (!date) return '';
        const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
        const options: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' };
        try {
            return dateObj.toLocaleDateString(this.pageLang() || 'en-US', options);
        } catch {
            return dateObj.toLocaleDateString('en-US', options);
        }
    }

    getReadTime(): number {
        const content = this.currentContent();
        if (!content) return 0;
        return content.readTime || calculateReadingTime(content.content);
    }

    /**
     * Update page SEO meta tags from content data
     */
    private updateSeoMeta(content: IContents): void {
        // Set page title - prefer seoTitle, fallback to title, but never let an
        // untranslated seoTitle outrank a translated title (localizedPageTitle).
        const pageTitle = localizedPageTitle(content, this.translation());
        if (pageTitle) {
            this.titleService.setTitle(pageTitle);
        }

        // Set meta description
        if (content.metaDescription) {
            this.metaService.updateTag({ name: 'description', content: content.metaDescription });
        }

        // Build the best available canonical/og:url for this content.
        // Use the stored canonicalUrl if present; otherwise construct from contentTypeSlug + urlSlug.
        // This ensures og:url and canonical are always set even when canonicalUrl is missing or
        // was saved without the content-type prefix.
        const pageUrl = content.canonicalUrl ||
            (isPlatformBrowser(this.platformId)
                ? window.location.href
                : `/${this.contentTypeSlug()}/${content.urlSlug}`);
        this.metaService.updateTag({ property: 'og:url', content: pageUrl });
        this.updateCanonicalUrl(pageUrl);

        // Set Open Graph tags for social sharing
        this.metaService.updateTag({ property: 'og:title', content: pageTitle || '' });
        if (content.metaDescription) {
            this.metaService.updateTag({ property: 'og:description', content: content.metaDescription });
        }
        if (content.coverImage) {
            this.metaService.updateTag({ property: 'og:image', content: content.coverImage });
        }
        this.metaService.updateTag({ property: 'og:type', content: 'article' });
        this.metaService.updateTag({ property: 'og:site_name', content: 'Arc CMS' });
        // Reflects the language prefix in the URL; the default language
        // keeps en_US, matching what the publish pipeline emits.
        this.metaService.updateTag({ property: 'og:locale', content: this.ogLocale() });

        // Robots — allow indexing of all published content pages
        this.metaService.updateTag({ name: 'robots', content: 'index, follow' });

        // Set Twitter Card tags
        this.metaService.updateTag({ name: 'twitter:card', content: 'summary_large_image' });
        this.metaService.updateTag({ name: 'twitter:title', content: pageTitle || '' });
        if (content.metaDescription) {
            this.metaService.updateTag({ name: 'twitter:description', content: content.metaDescription });
        }
        if (content.coverImage) {
            this.metaService.updateTag({ name: 'twitter:image', content: content.coverImage });
        }

        this.updateStructuredData(content, pageTitle || '', pageUrl);
    }

    /**
     * The same JSON-LD the static page carries (specs/discoverability-spec.md,
     * D1), mirrored from functions/src/pages/deployContentPage.ts. The SPA
     * fallback only serves pages that have no static file yet, so this exists
     * for parity, not as the primary path. Identity arrives asynchronously;
     * the nodes are written once without it and rewritten when it lands.
     */
    private updateStructuredData(content: IContents, pageTitle: string, pageUrl: string): void {
        const write = () => {
            const identity = this.siteIdentity.identity();
            const author = this.author();
            const origin = this.pageOrigin();
            const baseUrl = (identity.finalUrl || origin).replace(/\/+$/, '');
            const lang = this.pageLang() || this.localization.defaultLanguage();
            const prefix = this.pageLang() ? `/${this.pageLang()}` : '';
            const siteName = identity.name || this.document.title || '';
            const typeName = this.typeName();

            const organization = buildOrganization({
                name: identity.name || siteName,
                url: baseUrl,
                logoUrl: identity.logoUrl,
                description: identity.description,
                sameAs: identity.sameAs,
                contactEmail: identity.contactEmail,
                phone: identity.phone,
                address: identity.address,
                organizationType: identity.organizationType,
            });
            const publisherId = organization ? organizationId(baseUrl) : undefined;
            const webSite = buildWebSite(
                {
                    name: siteName,
                    url: baseUrl,
                    description: identity.description,
                    inLanguage: lang,
                    searchUrlTemplate: `${baseUrl}${prefix}/search?q={search_term_string}`,
                },
                publisherId,
            );
            const breadcrumbs = buildBreadcrumbList([
                { name: siteName || baseUrl, url: `${baseUrl}${prefix}/` },
                { name: typeName, url: `${baseUrl}${prefix}/${this.contentTypeSlug()}` },
                { name: content.title || pageTitle, url: pageUrl },
            ]);
            const dates = resolveContentDates(content);
            const blocks = extractBlocks(content.content || '');
            const references = cleanReferences(content.references);
            // The page's main node: the content type's mapped schema.org type,
            // or Article (D-D12). Mirrors deployContentPage.ts.
            const contentType = this.currentContentType();
            const article = buildMappedNode({
                schema: contentType?.schema,
                customFields: ((content as any).customFields as Record<string, unknown>) || {},
                ownerName: identity.name || siteName,
                publisherId,
                howTo: blocks.howTos[0] ?? null,
                article: {
                url: pageUrl,
                headline: content.title || pageTitle,
                description: content.metaDescription || content.summary || '',
                imageUrl: content.coverImage || '',
                datePublished: dates.published,
                dateModified: dates.modified,
                inLanguage: lang,
                keywords: content.tags || [],
                articleSection: (content.categoryNameArr || [])[0] || typeName,
                wordCount: countWords(content.content || ''),
                abstract: abstractFromTakeaways(blocks.takeaways),
                citations: references,
                author: author
                    ? {
                        name: author.name,
                        url: author.url || undefined,
                        imageUrl: author.photoUrl || undefined,
                        description: author.bio || undefined,
                        jobTitle: author.jobTitle || undefined,
                        sameAs: author.sameAs,
                    }
                    : content.authorName
                        ? { name: content.authorName }
                        : undefined,
                publisherId,
                },
            });

            setJsonLd(this.document, 'arc-ld-organization', organization);
            setJsonLd(this.document, 'arc-ld-website', webSite);
            setJsonLd(this.document, 'arc-ld-breadcrumbs', breadcrumbs);
            setJsonLd(this.document, 'arc-ld-article', article);
            // The page's questions and answers from its FAQ field (SS4). Mirrors deployContentPage.ts.
            setJsonLd(this.document, 'arc-ld-faq', buildFaqPage(
                faqItems(contentType?.fields, (content as any).customFields as Record<string, unknown>), pageUrl));
            // Block-derived nodes (D-D10): one script per node, cleared first
            // so a page with fewer blocks than the last one leaves none behind.
            const blockNodes = blockJsonLd(blocks, pageUrl).filter(
                node => !(article?.['@type'] === 'HowTo' && node['@type'] === 'HowTo'),
            );
            for (let i = 0; i < MAX_BLOCK_NODES; i++) {
                setJsonLd(this.document, `arc-ld-block-${i}`, blockNodes[i] ?? null);
            }
        };

        write();
        // Firestore is not reachable during prerendering; only rewrite in the browser.
        if (isPlatformBrowser(this.platformId)) {
            this.siteIdentity.load().then(write).catch(() => undefined);
        }
    }

    private pageOrigin(): string {
        return isPlatformBrowser(this.platformId) ? window.location.origin : '';
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

    /**
     * Loads the item's detail template, its layout's (SS8), its folder's or the
     * default (siteLayoutUrl), and hydrates it. A layout file that turns out not
     * to be a template falls back to the folder's detail.html once, and a folder
     * file to the default's.
     */
    private loadCustomTemplate(contentType: ContentType, content: IContents): void {
        const folder = templateFolderFor(contentType.templateFolder);
        const folderUrl = siteTemplateUrl(folder, 'detail');
        const layoutUrl = siteLayoutUrl(folder, content.layout);
        const url = this.templateUrlFor(contentType, content);

        // One request per template at a time; the effect can re-run several
        // times before the first response lands.
        if (url === this.pendingTemplateUrl) return;

        // Not while prerendering: a request from the server goes back to the app
        // itself, not to the static file. The page fills in once in the browser.
        if (!isPlatformBrowser(this.platformId)) return;

        const stateKey = makeStateKey<string>(`tpl-detail-${url}`);
        if (this.transferState.hasKey(stateKey)) {
            const cachedHtml = this.transferState.get(stateKey, '');
            this.transferState.remove(stateKey);
            if (isTemplateFragment(cachedHtml)) {
                this.loadedTemplateUrl = url;
                this.hydrateAndSetTemplate(cachedHtml, contentType, content);
                return;
            }
        }

        this.pendingTemplateUrl = url;
        this.http.get(url, { responseType: 'text' }).subscribe({
            next: (templateHtml) => {
                // A newer request (another layout) has replaced this one.
                if (this.pendingTemplateUrl !== url) return;
                this.pendingTemplateUrl = null;
                // A missing file answers with the app shell (HTTP 200, the 404
                // page); that is not a template.
                if (!isTemplateFragment(templateHtml)) {
                    console.warn(`[ContentDetailComponent] ${url} is not a template fragment.`);
                    if (url !== folderUrl && url === layoutUrl) {
                        this.rejectedLayoutUrl = url;
                        this.loadCustomTemplate(contentType, content);
                        return;
                    }
                    if (folder !== DEFAULT_TEMPLATE_FOLDER && this.rejectedTemplateFolder !== folder) {
                        this.rejectedTemplateFolder = folder;
                        this.loadCustomTemplate(contentType, content);
                    }
                    return;
                }
                this.loadedTemplateUrl = url;
                this.hydrateAndSetTemplate(templateHtml, contentType, content);
            },
            error: (error) => {
                if (this.pendingTemplateUrl === url) this.pendingTemplateUrl = null;
                console.warn(`[ContentDetailComponent] Failed to load ${url}:`, error.message);
            }
        });
    }

    /**
     * Hydrate template HTML with content data and set it for rendering
     */
    /** A template folder whose file turned out not to be a template; the default is used instead. */
    private rejectedTemplateFolder: string | null = null;
    /** A layout file that turned out not to be a template; the folder's detail.html is used instead. */
    private rejectedLayoutUrl: string | null = null;
    /** The template whose request is in flight. */
    private pendingTemplateUrl: string | null = null;
    /** The template on screen, to tell when the item needs another. */
    private loadedTemplateUrl: string | null = null;

    /**
     * The template this item renders with: its layout's, else its folder's
     * detail.html, else the default's, skipping a file that was not a template.
     */
    private templateUrlFor(contentType: ContentType, content: IContents): string {
        const folder = templateFolderFor(contentType.templateFolder);
        if (this.rejectedTemplateFolder === folder) return siteTemplateUrl(DEFAULT_TEMPLATE_FOLDER, 'detail');
        const layoutUrl = siteLayoutUrl(folder, content.layout);
        return this.rejectedLayoutUrl === layoutUrl ? siteTemplateUrl(folder, 'detail') : layoutUrl;
    }

    /** The last custom template as loaded, so it can be re-hydrated when the author arrives. */
    private lastTemplate: { html: string; contentType: ContentType; content: IContents } | null = null;

    private hydrateAndSetTemplate(templateHtml: string, contentType: ContentType, content: IContents, runScripts = true): void {
        this.lastTemplate = { html: templateHtml, contentType, content };
        // Prepare next/previous content objects
        const nextContent = content.nextContent ? {
            ...content.nextContent,
            url: `/${contentType.slug}/${content.nextContent.slug}`
        } : null;

        const previousContent = content.previousContent ? {
            ...content.previousContent,
            url: `/${contentType.slug}/${content.previousContent.slug}`
        } : null;

        // Prepare share URLs (SSR-safe).
        // Prefer canonicalUrl when set — consistent with what og:url uses.
        // Prefer seoTitle for share text — consistent with what og:title uses,
        // but never across languages (see localizedPageTitle).
        const shareUrl = content.canonicalUrl ||
            (isPlatformBrowser(this.platformId) ? window.location.href : '');
        const shareTitle = localizedPageTitle(content, this.translation());
        const shareSummary = content.summary || content.metaDescription || '';

        const share = {
            facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`,
            twitter: `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`,
            linkedin: `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareTitle)}&summary=${encodeURIComponent(shareSummary)}`,
            whatsapp: `https://wa.me/?text=${encodeURIComponent(shareTitle + ' ' + shareUrl)}`,
            email: `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareUrl)}`
        };

        // Prepare data for template hydration.
        // Field aliases ensure custom templates using different naming conventions
        // (e.g. {{ date }} instead of {{ publishedOn }}) populate correctly.
        const typeName = contentTypeName(contentType, this.pageLang());
        const templateData: any = {
            contentType: typeName,             // in the page's language, as when published
            cat: typeName,                     // alias: {{ cat }} → content type name
            contentTypeSlug: contentType.slug,
            ...content, // Spread content fields (title, content, tags, etc.)
            publishedOn: this.formatContentDate(content.publishedOn),
            date: this.formatContentDate(content.publishedOn),    // alias: {{ date }}
            // Mirrors deployContentPage.ts: shown only for a real revision (D-D3).
            updatedOn: this.updatedOnDisplay(),
            updatedOnDisplay: this.updatedOnDisplay(),
            // The page's language and URL prefix, as when published.
            lang: this.pageLang() || this.localization.defaultLanguage(),
            langPrefix: this.pageLang() ? `/${this.pageLang()}` : '',
            readTime: this.getReadTime(),
            // "5 min read" in the page's language, from its min_read string, as when published.
            readingTime: this.uiStrings.strings()['min_read']
                ? interpolate(this.uiStrings.strings()['min_read'], { readTime: this.getReadTime() })
                : `${this.getReadTime()} min read`,
            ...((content as any).customFields || {}),
            // After custom fields, mirroring deployContentPage.ts (D2, D-D11).
            ...this.authorTemplateData(),
            references: this.references(),
            hasReferences: this.references().length > 0,
            related: this.related(),
            hasRelated: this.related().length > 0,
        };

        // Add share object (nested for hydration)
        templateData['share'] = share;

        // Add nested next/prev content objects (better for hydration traverse)
        if (nextContent) {
            templateData['nextContent'] = nextContent;
        }

        if (previousContent) {
            templateData['previousContent'] = previousContent;
        }

        // Hydrate the template
        // Process loops (tags) — always called to ensure cleanup of empty containers
        let hydratedHtml = templateHtml;
        const tagsData = (content as any).tagsWithColors ||
            (content.tags || []).map((t: string) => ({ name: t, color: '#6b7280' }));
        
        // Static chrome first — before loops and bindings, so a translated
        // value may carry its own {{ }} and a repeated item template is
        // translated once. Mirrors the publish pipeline's order.
        hydratedHtml = TemplateHydrationService.applyStrings(hydratedHtml, this.uiStrings.strings());
        // Then the site's own details (SS3), before a social row's {{ url }} can be hydrated.
        hydratedHtml = TemplateHydrationService.applySiteInfo(hydratedHtml, siteInfoOf(this.siteIdentity.identity(), this.sitePages.pages()));

        // Always processing loops to ensure cleanup of placeholders if empty
        hydratedHtml = TemplateHydrationService.processLoops(hydratedHtml, {
            // Mirrors the publish pipeline: repeating custom fields become
            // named loops so a preview shows the same cards the live page will.
            ...TemplateHydrationService.arrayLoopData(
                (content as any).customFields,
                ['tags', 'items'],
                this.contentTypeSlug(),
            ),
            references: this.references(),
            related: this.related(),
            tags: tagsData
        });


        hydratedHtml = TemplateHydrationService.hydrateTemplate(hydratedHtml, templateData);

        this.templateHtml.set(hydratedHtml);
        
        // Execute scripts after view update (browser only). Skipped on a
        // re-hydration: the scripts already ran against this page.
        if (runScripts && isPlatformBrowser(this.platformId)) {
            setTimeout(() => this.runTemplateScripts(), 0);
        }
        // Forms on the page work as when published (SS5), after every draw.
        if (isPlatformBrowser(this.platformId)) setTimeout(() => this.refreshLiveParts(), 0);
    }

    /** The live parts' script for this draw's forms; removed and added again on each draw. */
    private liveScript: HTMLScriptElement | null = null;

    private refreshLiveParts(): void {
        this.liveScript?.remove();
        const host = this.document.querySelector('arc-content-detail');
        this.liveScript = host ? attachLiveParts(host, this.document, this.sitePages.pages()) : null;
    }

    /**
     * Manually execute script tags found in the template
     * Angular's [innerHTML] prevents script execution for security
     */
    private runTemplateScripts(): void {
        const scripts = this.document.querySelectorAll('arc-content-detail script');

        scripts.forEach(oldScript => {
            const newScript = this.document.createElement('script');
            Array.from(oldScript.attributes).forEach(attr => newScript.setAttribute(attr.name, attr.value));
            newScript.appendChild(this.document.createTextNode(oldScript.innerHTML));
            oldScript.parentNode?.replaceChild(newScript, oldScript);
        });
    }
}
