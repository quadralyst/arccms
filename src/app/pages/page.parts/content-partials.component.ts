import { CommonModule, isPlatformBrowser } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, computed, effect, inject, Input, input, OnInit, PLATFORM_ID, signal, TransferState, makeStateKey, ViewEncapsulation } from '@angular/core';
import { SafeHtmlPipe } from '../../core/pipes/safe-html.pipe';
import { TemplateHydrationService } from '../../core/services/template-hydration.service';
import { calculateReadingTime } from '../../core/utils/reading-time.util';
import { BaseComponent } from '../../../shared/components/base/base.component';
import { ContentsStore } from '../admin/contents/content-store/published-contents.store';
import { ContentTypesStore } from '../admin/contents/content-types/content-types.store';
import { ContentType, contentTypeDescription, contentTypeName } from '../admin/contents/content-types/content-types.model';
import { UiStringsService } from '../../core/services/ui-strings.service';
import { IContents } from '../admin/contents/content-store/published-contents.model';
import { isTemplateFragment } from '../../../shared/utils/template-fragment';
import { siteTemplateUrl } from '../../core/site/site';

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
    } @else if(templateHtml()) {
        <!-- The type's partials template (its folder's, else the default), hydrated -->
        <div [innerHTML]="templateHtml() | safeHtml"></div>
    }
    }
    `,
    styles: [`
        .content-partials-loading {
            display: flex;
            justify-content: center;
            align-items: center;
            padding: 4rem 0;
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
    private uiStrings = inject(UiStringsService);
    contentsStore = inject(ContentsStore);

    // Inputs - support both property binding and attribute binding
    contentType = input<string>('articles');
    count = input<number>(4);
    /** The heading; empty gives "Latest {type}", as on a published page. */
    sectionTitle = input<string>('');
    templateFolder = input<string>('');

    templateHtml = signal<string>('');
    /** The template as loaded, so it can be hydrated again. */
    private lastTemplate: string | null = null;
    private pendingTemplateUrl: string | null = null;

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

    /**
     * The language of the page embedding this component.
     *
     * Partials appear on the home page, which has no `:lang` route param — it
     * is a whole translated document per language — so the language comes from
     * the strings service the page already activates.
     */
    private pageLang = computed(() => this.uiStrings.activeLang());

    /** '' on the default language, '/{code}' otherwise. */
    private langPrefix = computed(() => (this.pageLang() ? `/${this.pageLang()}` : ''));

    /**
     * These cards render on the home page, which exists per language — so
     * their links have to stay in the language the visitor is reading, or
     * every card is a one-way trip back to English.
     */
    listUrl(): string {
        return `${this.langPrefix()}/${this.contentType()}`;
    }

    itemUrl(urlSlug: string): string {
        return `${this.langPrefix()}/${this.contentType()}/${urlSlug}`;
    }

    displayTitle = computed(() => {
        const customTitle = this.sectionTitle();
        if (customTitle) return customTitle;
        const contentType = this.currentContentType();
        return contentType ? `Latest ${contentTypeName(contentType, this.pageLang())}` : 'Latest Content';
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
            if (contentType && !isLoading && !this.templateHtml()) {
                this.loadCustomTemplate(contentType, contents);
            }
        });

        // New content and the page's strings arrive after the template was
        // first hydrated; hydrate it again with them.
        effect(() => {
            const contentType = this.currentContentType();
            const contents = this.filteredContents();
            this.uiStrings.strings();
            if (this.lastTemplate && contentType) {
                this.hydrateAndSetTemplate(this.lastTemplate, contentType, contents);
            }
        });
    }

    ngOnInit() {
        // Subscribe to stores to load data
        // Every content type, not the store's default first page of ten
        // ordered by createdAt, which silently dropped the oldest types on
        // sites with more than ten. Unlike the list and detail pages this
        // component cannot query its own slug alone: the home page embeds one
        // partial per type against the same root store, and per-slug queries
        // would overwrite each other. limitCount 0 means no limit in DbService.
        this.subscribeToData(this.contentTypesStore, { limitCount: 0 });
        // Load published contents from the per-type collection
        this.contentsStore.getAll(undefined, this.contentType() || undefined);
    }

    /**
     * Loads the partials template: the folder given on the element, else the
     * type's own, else the default (siteTemplateUrl), and hydrates it.
     */
    private loadCustomTemplate(contentType: ContentType, contents: IContents[]): void {
        const url = siteTemplateUrl(this.templateFolder() || contentType.templateFolder, 'partials');
        if (url === this.pendingTemplateUrl) return;
        const stateKey = makeStateKey<string>(`tpl-partials-${url}`);

        // Check TransferState first (cached from SSR)
        if (isPlatformBrowser(this.platformId) && this.transferState.hasKey(stateKey)) {
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
                // A missing file answers with the app shell; that is not a template.
                if (!isTemplateFragment(templateHtml)) {
                    console.warn(`[ContentPartialsComponent] ${url} is not a template fragment.`);
                    return;
                }
                // Cache in TransferState for client hydration
                if (!isPlatformBrowser(this.platformId)) {
                    this.transferState.set(stateKey, templateHtml);
                }
                this.hydrateAndSetTemplate(templateHtml, contentType, contents);
            },
            error: () => {
                this.pendingTemplateUrl = null;
            }
        });
    }

    /**
     * Hydrate template HTML with content data and set it for rendering
     */
    private hydrateAndSetTemplate(templateHtml: string, contentType: ContentType, contents: IContents[]): void {
        this.lastTemplate = templateHtml;
        // Prepare data for template hydration
        const lang = this.pageLang();
        const templateData = {
            contentType: contentTypeName(contentType, lang),
            contentTypeSlug: contentType.slug,
            contentTypeDescription: contentTypeDescription(contentType, lang),
            sectionTitle: this.displayTitle(),
            listUrl: this.listUrl(),
            hasItems: contents.length > 0,
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
                // In the page's language, like the list link.
                url: this.itemUrl(content.urlSlug),
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

        // Chrome in the page's language first, then loops, then page-level data:
        // the same order as the list and detail pages.
        const localizedTemplate = TemplateHydrationService.applyStrings(templateHtml, this.uiStrings.strings());
        let hydratedHtml = TemplateHydrationService.processLoops(localizedTemplate, { items: listData });
        hydratedHtml = TemplateHydrationService.hydrateTemplate(hydratedHtml, templateData);

        this.templateHtml.set(hydratedHtml);
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
