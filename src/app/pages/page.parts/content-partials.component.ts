import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, Input, input, OnInit, PLATFORM_ID, signal, TransferState, makeStateKey, ViewEncapsulation } from '@angular/core';
import { SafeHtmlPipe } from '../../core/pipes/safe-html.pipe';
import { TemplateHydrationService } from '../../core/services/template-hydration.service';
import { calculateReadingTime } from '../../core/utils/reading-time.util';
import { BaseComponent } from '../../../shared/components/base/base.component';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { ContentType } from '../admin/contents/content-types/content-types.model';
import { IContents } from '../admin/contents/content-store/published-contents.model';

/**
 * Content Partials Component
 * Embeddable component that displays content cards from any content type.
 * Can be used to show "Recent Articles", "Featured Posts", etc. in any page.
 * 
 * @example
 * <arc-content-partials contentType="articles" [count]="4"></arc-content-partials>
 * <arc-content-partials content-type="articles" count="6" section-title="Latest Posts"></arc-content-partials>
 */
@Component({
    selector: 'arc-content-partials',
    standalone: true,
    imports: [CommonModule, SafeHtmlPipe],
    providers: [ContentsStore],
    template: `
    @if(hydrated()) {
    @if(contentTypesStore.isLoading() || contentsStore.isLoading()) {
        <div class="content-partials-loading">
            <div class="spinner-border text-primary" role="status">
                <span class="visually-hidden">Loading...</span>
            </div>
        </div>
    } @else if(useCustomTemplate() && templateHtml()) {
        <!-- Render custom template -->
        <div [innerHTML]="templateHtml() | safeHtml"></div>
    } @else if(filteredContents().length > 0) {
        <!-- Default template - Apple-inspired design -->
        <section class="content-partials-section">
            <div class="container">
                <div class="content-partials-header">
                    <h2 class="content-partials-title">{{ displayTitle() }}</h2>
                    @if(currentContentType()) {
                        <a [href]="'/' + contentType()" class="content-partials-view-all">
                            View All <i class="fas fa-arrow-right"></i>
                        </a>
                    }
                </div>
                <div class="content-partials-grid">
                    @for(content of filteredContents(); track content.id) {
                        <a [href]="'/' + contentType() + '/' + content.urlSlug" class="content-partial-card">
                            <div class="content-partial-image" 
                                 [style.background-image]="content.coverImage ? 'url(' + content.coverImage + ')' : ''">
                                @if(!content.coverImage) {
                                    <div class="content-partial-placeholder"></div>
                                }
                            </div>
                            <div class="content-partial-body">
                                <div class="content-partial-meta">
                                    <time>{{ formatContentDate(content.publishedOn) }}</time>
                                    <span class="meta-separator">•</span>
                                    <span>{{ getReadTime(content) }} min read</span>
                                </div>
                                <h3 class="content-partial-title">{{ content.title }}</h3>
                                <p class="content-partial-excerpt">{{ getExcerpt(content) }}</p>
                                <span class="content-partial-read-more">Read Article <i class="fas fa-arrow-right"></i></span>
                            </div>
                        </a>
                    }
                </div>
            </div>
        </section>
    }
    }
    `,
    styles: [`
        /* Apple-inspired Content Partials Styles */
        .content-partials-loading {
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 4rem 0;
        }

        .content-partials-section {
            padding: 4rem 0;
            background: #f5f5f7;
        }

        .content-partials-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 2rem;
        }

        .content-partials-title {
            font-size: 2rem;
            font-weight: 700;
            color: #1d1d1f;
            margin: 0;
            letter-spacing: -0.02em;
        }

        .content-partials-view-all {
            font-size: 0.95rem;
            font-weight: 500;
            color: #0066cc;
            text-decoration: none;
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            transition: color 0.2s;
        }

        .content-partials-view-all:hover {
            color: #004499;
        }

        .content-partials-view-all i {
            font-size: 0.8rem;
            transition: transform 0.2s;
        }

        .content-partials-view-all:hover i {
            transform: translateX(4px);
        }

        .content-partials-grid {
            display: grid;
            grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
            gap: 1.5rem;
        }

        .content-partial-card {
            display: flex;
            flex-direction: column;
            background: #ffffff;
            border-radius: 20px;
            overflow: hidden;
            box-shadow: 0 2px 20px rgba(0, 0, 0, 0.06);
            transition: transform 0.3s ease, box-shadow 0.3s ease;
            text-decoration: none;
            color: inherit;
            height: 100%;
        }

        .content-partial-card:hover {
            transform: translateY(-8px);
            box-shadow: 0 12px 40px rgba(0, 0, 0, 0.12);
        }

        .content-partial-card:hover .content-partial-read-more {
            color: #0066cc;
        }

        .content-partial-card:hover .content-partial-read-more i {
            transform: translateX(4px);
        }

        .content-partial-image {
            position: relative;
            width: 100%;
            height: 160px;
            overflow: hidden;
            background-color: #f5f5f7;
            background-size: cover;
            background-position: center;
        }

        .content-partial-placeholder {
            width: 100%;
            height: 100%;
            background: linear-gradient(135deg, #e8e8ed 0%, #d2d2d7 100%);
        }

        .content-partial-body {
            padding: 1.25rem;
            flex: 1;
            display: flex;
            flex-direction: column;
        }

        .content-partial-meta {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.8rem;
            color: #6e6e73;
            margin-bottom: 0.5rem;
        }

        .content-partial-meta .meta-separator {
            color: #d2d2d7;
        }

        .content-partial-title {
            font-size: 1.1rem;
            font-weight: 600;
            color: #1d1d1f;
            margin: 0 0 0.5rem 0;
            line-height: 1.3;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
        }

        .content-partial-excerpt {
            font-size: 0.9rem;
            color: #6e6e73;
            line-height: 1.5;
            margin: 0 0 1rem 0;
            display: -webkit-box;
            -webkit-line-clamp: 2;
            -webkit-box-orient: vertical;
            overflow: hidden;
            flex: 1;
        }

        .content-partial-read-more {
            display: inline-flex;
            align-items: center;
            gap: 0.5rem;
            font-size: 0.85rem;
            font-weight: 500;
            color: #1d1d1f;
            transition: color 0.2s ease;
            margin-top: auto;
        }

        .content-partial-read-more i {
            font-size: 0.7rem;
            transition: transform 0.2s ease;
        }

        @media (max-width: 768px) {
            .content-partials-section {
                padding: 3rem 0;
            }

            .content-partials-header {
                flex-direction: column;
                align-items: flex-start;
                gap: 1rem;
            }

            .content-partials-title {
                font-size: 1.5rem;
            }

            .content-partials-grid {
                grid-template-columns: 1fr;
            }
        }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
})
export class ContentPartialsComponent extends BaseComponent implements OnInit {
    private http = inject(HttpClient);
    private platformId = inject(PLATFORM_ID);
    private transferState = inject(TransferState);

    contentTypesStore = inject(ContentTypesStore);
    contentsStore = inject(ContentsStore);

    // Inputs - support both property binding and attribute binding
    contentType = input<string>('articles');
    count = input<number>(4);
    sectionTitle = input<string>('Latest Updates');
    templateFolder = input<string>('');

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
        const slug = this.contentType();
        if (!slug) return null;
        const types = this.contentTypesStore.items();
        return types.find((ct: ContentType) => ct.slug === slug) || null;
    });

    displayTitle = computed(() => {
        const customTitle = this.sectionTitle();
        if (customTitle) return customTitle;
        const contentType = this.currentContentType();
        return contentType ? `Latest ${contentType.name}` : 'Latest Content';
    });

    filteredContents = computed(() => {
        const contentTypeSlug = this.contentType();
        if (!contentTypeSlug) return [];

        const items = this.contentsStore.items().filter((content: IContents) =>
            content.type === contentTypeSlug && content.publishedStatus
        );

        // Sort by publishedOn descending (newest first) and limit.
        // Handles Firestore Timestamps ({seconds, nanoseconds}), Date objects, and ISO strings.
        const sorted = items.sort((a, b) => {
            const dateA = this.toTimestamp(a.publishedOn);
            const dateB = this.toTimestamp(b.publishedOn);
            return dateB - dateA;
        });

        return sorted.slice(0, this.count());
    });

    constructor() {
        super();

        // On the server, mark as hydrated immediately so SSR renders content
        if (!isPlatformBrowser(this.platformId)) {
            this.hydrated.set(true);
        }

        // Watch for content type and contents to load, then trigger template loading
        effect(() => {
            const contentType = this.currentContentType();
            const contents = this.filteredContents();
            const isLoading = this.contentTypesStore.isLoading() || this.contentsStore.isLoading();

            // Mark as hydrated once data is loaded
            if (contentType && !isLoading && !this.hydrated()) {
                this.hydrated.set(true);
            }

            // Only load template when we have content type, not loading, and haven't loaded yet
            if (contentType && !isLoading && !this.useCustomTemplate()) {
                this.loadCustomTemplate(contentType, contents);
            }
        });
    }

    ngOnInit() {
        // Subscribe to stores to load data
        this.subscribeToData(this.contentTypesStore);
        // Load published contents from the per-type collection
        this.contentsStore.getAll(undefined, this.contentType() || undefined);
    }

    /**
     * Load and hydrate custom template when content type and content are ready
     */
    private loadCustomTemplate(contentType: ContentType, contents: IContents[]): void {
        // Use provided templateFolder or fall back to content type's templateFolder
        const folder = this.templateFolder() || contentType.templateFolder;

        // Skip if using default template or no folder specified
        if (!folder || folder === 'default') {
            this.useCustomTemplate.set(false);
            return;
        }

        // Build template URL - using generic filename
        const templateUrl = `/templates/${folder}/partials.html`;
        const stateKey = makeStateKey<string>(`tpl-partials-${folder}`);

        // Check TransferState first (cached from SSR)
        if (isPlatformBrowser(this.platformId) && this.transferState.hasKey(stateKey)) {
            const cachedHtml = this.transferState.get(stateKey, '');
            this.transferState.remove(stateKey);
            this.hydrateAndSetTemplate(cachedHtml, contentType, contents);
            return;
        }

        this.http.get(templateUrl, { responseType: 'text' }).subscribe({
            next: (templateHtml) => {
                // Cache in TransferState for client hydration
                if (!isPlatformBrowser(this.platformId)) {
                    this.transferState.set(stateKey, templateHtml);
                }

                this.hydrateAndSetTemplate(templateHtml, contentType, contents);
            },
            error: (error) => {
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
            sectionTitle: this.displayTitle(),
        };

        // Prepare list data for loops - transform content items
        const listData = contents.map(content => {
            const tagsData = (content as any).tagsWithColors ||
                (content.tags || []).map((t: string) => ({ name: t, color: '#6b7280' }));

            // Pre-render tags HTML for colored pills
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
                tags: tagsData,
                tagsHtml: tagsHtml,
                ...((content as any).customFields || {}),
            };
        });

        // First process loops with list data
        let hydratedHtml = TemplateHydrationService.processLoops(templateHtml, { items: listData });

        // Then hydrate with page-level data
        hydratedHtml = TemplateHydrationService.hydrateTemplate(hydratedHtml, templateData);

        this.templateHtml.set(hydratedHtml);
        this.useCustomTemplate.set(true);
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
        const words = cleanText.split(' ').slice(0, 20);
        return words.length >= 20 ? words.join(' ') + '...' : cleanText;
    }
}
