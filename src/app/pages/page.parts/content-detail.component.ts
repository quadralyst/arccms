import { CommonModule, DOCUMENT, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, inject, Injector, OnDestroy, OnInit, PLATFORM_ID, signal, untracked, ViewEncapsulation, effect, TransferState, makeStateKey } from '@angular/core';
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
import { DraftContentsStore } from '../admin/contents/draft-content-store/draft-contents.store';
import { Auth, authState } from '@angular/fire/auth';
import { IDraftContents } from '../admin/contents/draft-content-store/draft-contents.model';
import { toSignal } from '@angular/core/rxjs-interop';
import { FooterComponent } from './footer.component';
import { HeaderComponent } from './header.component';
import { GaTrackingService } from '../../../shared/services/ga-tracking.service';
import { LocalizationService } from '../../core/services/localization.service';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { ArcTranslateDirective } from '../../core/directives/arc-translate.directive';
import { ContentsService } from '../admin/contents/content-store/published-contents.service';
import { DraftContentsService } from '../admin/contents/draft-content-store/draft-contents.service';
import {
    IContentTranslation,
    localizedPageTitle,
    mergeTranslation,
} from '../admin/contents/draft-content-store/content-translation.model';

/**
 * Dynamic Content Detail Component
 * Shows individual content item for a given content type and URL slug
 */
@Component({
    selector: 'arc-content-detail',
    standalone: true,
    imports: [CommonModule, HeaderComponent, FooterComponent, SafeHtmlPipe, ArcTranslateDirective],
    template: `
    <arc-header></arc-header>
    
    @if(hydrated()) {
    @if(contentTypesStore.isLoading() || contentsStore.isLoading() || isCheckingDraft() || !contentsStore.isSuccess()) {
        <div class="loading-container">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>
    } @else if(useCustomTemplate() && templateHtml()) {
        <!-- Render custom template -->
        <div [innerHTML]="templateHtml() | safeHtml"></div>
    } @else if(!currentContent() && showNotFound()) {
        <!-- Content not found — shown after 3-second delay to prevent flash -->
        <div class="not-found-container">
            <div class="container text-center py-5">
                <i class="fas fa-file-alt fa-4x text-muted mb-4"></i>
                <h2>Content Not Found</h2>
                <p class="text-muted">The content you're looking for doesn't exist or has been removed.</p>
                <a href="/" class="btn btn-primary mt-3">Go Home</a>
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
        <!-- Content Detail - Apple/Medium-inspired design -->
        <article class="article-detail">
            <!-- Article Header -->
            <header class="article-header">
                <div class="container">
                    <a class="article-back-link" [href]="listUrl()">
                        <i class="fas fa-arrow-left"></i> <span data-arc-t="back_to" [data-arc-t-params]="{ contentType: typeName() }">Back to {{ typeName() }}</span>
                    </a>
                    <h1 class="article-title">{{ currentContent()?.title }}</h1>
                    <div class="article-meta">
                        <span class="article-date">
                            <i class="far fa-calendar"></i> {{ formatContentDate(currentContent()?.publishedOn) }}
                        </span>
                        <span class="meta-divider">•</span>
                        <span class="article-read-time">
                            <i class="far fa-clock"></i> <span data-arc-t="min_read" [data-arc-t-params]="{ readTime: getReadTime() }">{{ getReadTime() }} min read</span>
                        </span>
                    </div>
                </div>
            </header>

            <!-- Cover Image -->
            @if(currentContent()?.coverImage) {
                <div class="article-cover">
                    <img [src]="currentContent()?.coverImage" [attr.alt]="currentContent()?.title || ''" class="article-cover-image">
                </div>
            }

            <!-- Article Content -->
            <div class="article-body">
                <div class="container">
                    <div class="article-content" [innerHTML]="(currentContent()?.content || '') | safeHtml"></div>

                    <!-- Tags -->
                    @if(currentContent()?.tags && currentContent()!.tags.length > 0) {
                        <div class="article-tags">
                            @for(tag of currentContent()!.tags; track tag) {
                                <span class="article-tag">{{ tag }}</span>
                            }
                        </div>
                    }

                    <!-- Share Buttons -->
                    <div class="article-share">
                        <span class="share-label" data-arc-t="share_this_article">Share this article</span>
                        <div class="share-buttons">
                            <a class="share-btn share-twitter" [href]="getShareUrl('twitter')" target="_blank" rel="noopener">
                                <i class="fab fa-twitter"></i>
                            </a>
                            <a class="share-btn share-facebook" [href]="getShareUrl('facebook')" target="_blank" rel="noopener">
                                <i class="fab fa-facebook-f"></i>
                            </a>
                            <a class="share-btn share-linkedin" [href]="getShareUrl('linkedin')" target="_blank" rel="noopener">
                                <i class="fab fa-linkedin-in"></i>
                            </a>
                            <a class="share-btn share-email" [href]="getShareUrl('email')">
                                <i class="fas fa-envelope"></i>
                            </a>
                        </div>
                    </div>

                    <!-- Navigation -->
                    <nav class="article-navigation">
                        <a [href]="listUrl()" class="nav-back">
                            <i class="fas fa-th-large"></i>
                            <span data-arc-t="all_of_type" [data-arc-t-params]="{ contentType: typeName() }">All {{ typeName() }}</span>
                        </a>
                    </nav>
                </div>
            </div>
        </article>
    }
    }
    
    <arc-footer></arc-footer>
    `,
    styles: [`
        /* Apple/Medium-inspired Article Detail Styles */
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

        .article-detail {
            min-height: 60vh;
            background: #ffffff;
        }

        /* Article Header */
        .article-header {
            padding: 3rem 0 2rem;
            text-align: center;
            background: linear-gradient(180deg, #f5f5f7 0%, #ffffff 100%);
        }

        .article-back-link {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.9rem;
            color: #0066cc;
            text-decoration: none;
            margin-bottom: 1.5rem;
            transition: color 0.2s;
        }

        .article-back-link:hover {
            color: #004499;
        }

        .article-title {
            font-size: 2.5rem;
            font-weight: 700;
            color: #1d1d1f;
            line-height: 1.2;
            margin-bottom: 1.5rem;
            max-width: 800px;
            margin-left: auto;
            margin-right: auto;
            letter-spacing: -0.02em;
        }

        .article-meta {
            display: flex;
            justify-content: center;
            align-items: center;
            gap: 0.75rem;
            font-size: 0.95rem;
            color: #6e6e73;
        }

        .article-meta i {
            margin-right: 0.35rem;
        }

        .meta-divider {
            color: #d2d2d7;
        }

        /* Cover Image */
        .article-cover {
            max-width: 1000px;
            margin: 0 auto 2rem;
            padding: 0 1rem;
        }

        .article-cover-image {
            width: 100%;
            height: auto;
            border-radius: 16px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.1);
        }

        /* Article Body */
        .article-body {
            padding: 2rem 0 4rem;
        }

        .article-content {
            max-width: 720px;
            margin: 0 auto;
            font-size: 1.125rem;
            line-height: 1.8;
            color: #1d1d1f;
        }

        .article-content h2 {
            font-size: 1.75rem;
            font-weight: 700;
            margin-top: 3rem;
            margin-bottom: 1rem;
            color: #1d1d1f;
            letter-spacing: -0.01em;
        }

        .article-content h3 {
            font-size: 1.375rem;
            font-weight: 600;
            margin-top: 2.5rem;
            margin-bottom: 0.75rem;
            color: #1d1d1f;
        }

        .article-content p {
            margin-bottom: 1.5rem;
        }

        .article-content img {
            max-width: 100%;
            height: auto;
            border-radius: 12px;
            margin: 2rem 0;
        }

        .article-content blockquote {
            border-left: 3px solid #0066cc;
            padding-left: 1.5rem;
            margin: 2rem 0;
            font-style: italic;
            color: #6e6e73;
            font-size: 1.1rem;
        }

        .article-content code {
            background: #f5f5f7;
            padding: 0.2rem 0.5rem;
            border-radius: 4px;
            font-size: 0.9em;
            font-family: 'SF Mono', Menlo, monospace;
        }

        .article-content pre {
            background: #1d1d1f;
            color: #f5f5f7;
            padding: 1.5rem;
            border-radius: 12px;
            overflow-x: auto;
            margin: 2rem 0;
            font-size: 0.9rem;
        }

        .article-content pre code {
            background: none;
            padding: 0;
            color: inherit;
        }

        .article-content ul,
        .article-content ol {
            margin-bottom: 1.5rem;
            padding-left: 1.5rem;
        }

        .article-content li {
            margin-bottom: 0.5rem;
        }

        /* Tags */
        .article-tags {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid #e8e8ed;
            max-width: 720px;
            margin-left: auto;
            margin-right: auto;
        }

        .article-tag {
            background: #f5f5f7;
            color: #1d1d1f;
            padding: 0.5rem 1rem;
            border-radius: 100px;
            font-size: 0.875rem;
            font-weight: 500;
            transition: background 0.2s;
        }

        .article-tag:hover {
            background: #e8e8ed;
        }

        /* Share Buttons */
        .article-share {
            display: flex;
            align-items: center;
            gap: 1rem;
            margin-top: 2rem;
            padding-top: 2rem;
            border-top: 1px solid #e8e8ed;
            max-width: 720px;
            margin-left: auto;
            margin-right: auto;
        }

        .share-label {
            font-size: 0.9rem;
            color: #6e6e73;
            font-weight: 500;
        }

        .share-buttons {
            display: flex;
            gap: 0.75rem;
        }

        .share-btn {
            display: flex;
            align-items: center;
            justify-content: center;
            width: 40px;
            height: 40px;
            border-radius: 50%;
            color: #ffffff;
            text-decoration: none;
            transition: transform 0.2s, opacity 0.2s;
        }

        .share-btn:hover {
            transform: scale(1.1);
            opacity: 0.9;
        }

        .share-twitter { background: #1DA1F2; }
        .share-facebook { background: #4267B2; }
        .share-linkedin { background: #0A66C2; }
        .share-email { background: #6e6e73; }

        /* Navigation */
        .article-navigation {
            display: flex;
            justify-content: center;
            margin-top: 3rem;
            padding-top: 2rem;
            border-top: 1px solid #e8e8ed;
            max-width: 720px;
            margin-left: auto;
            margin-right: auto;
        }

        .nav-back {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            padding: 0.75rem 1.5rem;
            background: #f5f5f7;
            color: #1d1d1f;
            border-radius: 100px;
            text-decoration: none;
            font-weight: 500;
            transition: background 0.2s;
        }

        .nav-back:hover {
            background: #e8e8ed;
        }

        /* Responsive */
        @media (max-width: 768px) {
            .article-header {
                padding: 2rem 0 1.5rem;
            }

            .article-title {
                font-size: 1.75rem;
            }

            .article-meta {
                flex-direction: column;
                gap: 0.5rem;
            }

            .meta-divider {
                display: none;
            }

            .article-content {
                font-size: 1rem;
            }

            .article-share {
                flex-direction: column;
                align-items: flex-start;
            }
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
    private auth = inject(Auth);
    private gaTracking = inject(GaTrackingService);
    private trackedContent = false;

    contentTypeSlug = signal<string>('');
    urlSlug = signal<string>('');
    templateHtml = signal<string>('');
    useCustomTemplate = signal<boolean>(false);
    isPreview = signal<boolean>(false);
    draftContent = signal<IDraftContents | null>(null);
    user = toSignal(authState(this.auth));

    /**
     * Hydration guard: stays false until client-side data has loaded.
     * While false, the component renders nothing — letting SSR DOM survive.
     * On the server, always true so SSR renders the loading state.
     */
    hydrated = signal<boolean>(false);

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

        effect(() => {
            const contentType = this.currentContentType();
            const content = this.currentContent();
            const isLoading = this.contentTypesStore.isLoading() || this.contentsStore.isLoading();
            const isCheckingDraft = this.isCheckingDraft();

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

            // Only load template when we have content type, content, not loading, and haven't loaded yet
            if (contentType && content && !isLoading && !this.useCustomTemplate()) {
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
        this.subscribeToData(this.contentTypesStore);
        // Load published contents from the per-type collection
        this.contentsStore.getAll(undefined, typeSlug || undefined);
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
        // The next page may have no variants at all.
        this.localization.languageVariants.set(null);
        if (this.notFoundTimer !== null) {
            clearTimeout(this.notFoundTimer);
            this.notFoundTimer = null;
        }
    }

    formatContentDate(date: any): string {
        if (!date) return '';
        const dateObj = date.seconds ? new Date(date.seconds * 1000) : new Date(date);
        return dateObj.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
        });
    }

    getReadTime(): number {
        const content = this.currentContent();
        if (!content) return 0;
        return content.readTime || calculateReadingTime(content.content);
    }

    getShareUrl(platform: string): string {
        const content = this.currentContent();
        if (!content) return '';

        // Track share click
        this.gaTracking.trackShareClick(platform, content.urlSlug);

        // Prefer canonicalUrl when available; fall back to current URL.
        // This ensures share links point to the correct canonical address.
        const shareUrl = content.canonicalUrl ||
            (typeof window !== 'undefined' ? window.location.href : '');
        // Prefer seoTitle for share text — consistent with what OG tags use,
        // but never across languages: an untranslated seoTitle must not put the
        // base language back on a translated page.
        const shareTitle = localizedPageTitle(content, this.translation());
        const shareSummary = content.metaDescription || '';

        switch (platform) {
            case 'twitter':
                return `https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(shareTitle)}`;
            case 'facebook':
                return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}`;
            case 'linkedin':
                return `https://www.linkedin.com/shareArticle?mini=true&url=${encodeURIComponent(shareUrl)}&title=${encodeURIComponent(shareTitle)}&summary=${encodeURIComponent(shareSummary)}`;
            case 'email':
                return `mailto:?subject=${encodeURIComponent(shareTitle)}&body=${encodeURIComponent(shareUrl)}`;
            default:
                return '';
        }
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
     * Load and hydrate custom template
     */
    private loadCustomTemplate(contentType: ContentType, content: IContents): void {
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
        const templateUrl = `/templates/${templateFolder}/detail.html`;
        const stateKey = makeStateKey<string>(`tpl-detail-${templateFolder}`);

        // Check TransferState first (cached from SSR)
        if (this.transferState.hasKey(stateKey)) {
            const cachedHtml = this.transferState.get(stateKey, '');
            this.transferState.remove(stateKey);
            this.hydrateAndSetTemplate(cachedHtml, contentType, content);
            return;
        }

        this.http.get(templateUrl, { responseType: 'text' }).subscribe({
            next: (templateHtml) => {
                this.hydrateAndSetTemplate(templateHtml, contentType, content);
            },
            error: (error) => {
                console.warn('[ContentDetailComponent] Failed to load custom template:', error.message);
                this.useCustomTemplate.set(false);
            }
        });
    }

    /**
     * Hydrate template HTML with content data and set it for rendering
     */
    private hydrateAndSetTemplate(templateHtml: string, contentType: ContentType, content: IContents): void {
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
        const templateData: any = {
            contentType: contentType.name,
            cat: contentType.name,             // alias: {{ cat }} → content type name
            contentTypeSlug: contentType.slug,
            ...content, // Spread content fields (title, content, tags, etc.)
            publishedOn: this.formatContentDate(content.publishedOn),
            date: this.formatContentDate(content.publishedOn),    // alias: {{ date }}
            readTime: this.getReadTime(),
            readingTime: `${this.getReadTime()} min read`,        // alias: {{ readingTime }}
            ...((content as any).customFields || {}),
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

        // Always processing loops to ensure cleanup of placeholders if empty
        hydratedHtml = TemplateHydrationService.processLoops(hydratedHtml, {
            tags: tagsData
        });


        hydratedHtml = TemplateHydrationService.hydrateTemplate(hydratedHtml, templateData);

        this.templateHtml.set(hydratedHtml);
        this.useCustomTemplate.set(true);
        
        // Execute scripts after view update (browser only)
        if (isPlatformBrowser(this.platformId)) {
            setTimeout(() => this.runTemplateScripts(), 0);
        }
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
