import { Injector, computed, signal } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { LocalizationService } from '../../../core/services/localization.service';
import { UiStringsService } from '../../../core/services/ui-strings.service';
import { siteManifest, sitePageUrl } from '../../../core/site/site';
import { PageTextService, pageHeldByOther, type PageTextSession, type PublishedPageText } from '../../../core/site/page-text.service';
import { SiteIdentityService } from '../../../core/services/site-identity.service';
import { HoldService } from '../../../core/editing/hold.service';
import { pageTextId } from '../../../core/utils/page-text-model';
import { readPageFile, type PageFile } from '../../../core/utils/page-text-areas';
import { MorePagesService, type CardTypeInfo } from './more-pages.service';
import {
    goneKeys, sectionViews, seoView, type EditorContext, type GoneKey, type SectionView, type SeoView,
} from './page-text-editor.model';

export interface PageLanguage {
    code: string;
    label: string;
}

/**
 * What both editors of a page (specs/visual-editing-spec.md, VE-D50, VE-D49)
 * work from: its languages, each language's file and strings, the content types
 * of its card blocks, and the draft's session; and, for the language chosen, each
 * area as the editor shows it. The classic editor and the Visual Editor are two
 * views of one draft.
 */
export class PageEditorData {
    /** `''` for the home page, else the static page's name. */
    readonly name: string;
    readonly isHome: boolean;
    readonly pageId: string;

    readonly loading = signal(true);
    readonly loadError = signal('');
    readonly languages = signal<PageLanguage[]>([]);
    readonly defaultLang = signal('');
    readonly lang = signal('');
    readonly files = signal<Record<string, PageFile>>({});
    readonly ownFiles = signal<Record<string, boolean>>({});
    private readonly strings = signal<Record<string, Record<string, string>>>({});
    readonly cardTypes = signal<Map<string, CardTypeInfo>>(new Map());

    /** The draft's session, once the files are read: a signal, so what reads the draft follows it. */
    private readonly sessionRef = signal<PageTextSession | null>(null);
    get session(): PageTextSession | null {
        return this.sessionRef();
    }
    readonly draft = computed(() => this.sessionRef()?.draft() ?? null);
    /** What is published, followed; undefined until the first answer. */
    readonly published = signal<PublishedPageText | null | undefined>(undefined);
    private stopPublished: (() => void) | null = null;
    /** Someone else holds the page's words: they are looked at, not changed (VE-D79). */
    readonly heldBy = computed(() => {
        const published = this.published();
        if (published === undefined) return null;
        return pageHeldByOther(this.draft(), published, this.injector.get(HoldService).me()?.uid);
    });

    readonly context = computed<EditorContext | null>(() => {
        const files = this.files();
        const lang = this.lang();
        const defaultLang = this.defaultLang();
        const file = files[lang] ?? files[defaultLang];
        const defaultFile = files[defaultLang];
        if (!file || !defaultFile) return null;
        const ownFile = lang === defaultLang || !!this.ownFiles()[lang];
        return { lang, defaultLang, ownFile, file, defaultFile, strings: ownFile ? {} : this.strings()[lang] ?? {}, draft: this.draft() };
    });
    readonly sections = computed<SectionView[]>(() => {
        const ctx = this.context();
        return ctx ? sectionViews(ctx) : [];
    });
    readonly seo = computed<SeoView | null>(() => {
        const ctx = this.context();
        return ctx ? seoView(ctx) : null;
    });
    readonly gone = computed<GoneKey[]>(() => goneKeys(this.draft(), Object.values(this.files()), this.defaultLang()));
    /** The site's public address with no slash at its end; the admin's own until it is read. */
    private readonly origin = signal(typeof window === 'undefined' ? '' : window.location.origin);
    /** The page's public address in the language chosen (VE-D74). */
    readonly url = computed(() => {
        const prefix = this.lang() && this.lang() !== this.defaultLang() ? `/${this.lang()}` : '';
        return this.isHome ? `${this.origin()}${prefix}/` : `${this.origin()}/p/${this.name}`;
    });
    readonly isDefaultLang = computed(() => this.lang() === this.defaultLang());
    /** The static page's title from its file, else its name; '' for the home page. */
    readonly fileTitle = computed(() => (this.isHome ? '' : this.files()[this.defaultLang()]?.title || this.name));

    constructor(private injector: Injector, name: string) {
        this.name = name;
        this.isHome = !name;
        this.pageId = this.isHome ? pageTextId.home() : pageTextId.staticPage(name);
    }

    /** Reads the languages, files and strings, and opens the draft. */
    async load(): Promise<void> {
        try {
            const settings = await this.injector.get(LocalizationService).load();
            const defaultLang = settings.defaultLanguage || 'en';
            // Static pages exist in the default language only (VE-D43).
            const languages = this.isHome
                ? (settings.enabledLanguages || []).map((l: { code: string; label?: string; nativeLabel?: string }) => ({ code: l.code, label: l.nativeLabel || l.label || l.code }))
                : [];
            const list = languages.length ? languages : [{ code: defaultLang, label: defaultLang }];
            list.sort((a, b) => (a.code === defaultLang ? -1 : b.code === defaultLang ? 1 : 0));
            this.languages.set(list);
            this.defaultLang.set(defaultLang);
            if (!this.lang() || !list.some((l) => l.code === this.lang())) this.lang.set(defaultLang);
            await this.loadFiles(list.map((l) => l.code), defaultLang);
            const session = this.injector.get(PageTextService).session(this.pageId);
            session.published = () => this.published();
            this.stopPublished = this.injector.get(PageTextService).followPublished(this.pageId, (published) => this.published.set(published));
            session.open();
            this.sessionRef.set(session);
            void this.loadOrigin();
            this.cardTypes.set(await this.injector.get(MorePagesService).cardTypes());
        } catch (error: any) {
            console.error('[PageEditor] Could not open the page:', error);
            this.loadError.set(error?.message || String(error));
        } finally {
            this.loading.set(false);
        }
    }

    private async loadFiles(langs: string[], defaultLang: string): Promise<void> {
        const manifest = siteManifest();
        const morePages = this.injector.get(MorePagesService);
        const uiStrings = this.injector.get(UiStringsService);
        const files: Record<string, PageFile> = {};
        const own: Record<string, boolean> = {};
        const strings: Record<string, Record<string, string>> = {};
        await Promise.all(langs.map(async (lang) => {
            const ownFile = this.isHome && lang !== defaultLang && !!manifest.home[lang];
            const path = this.isHome ? (ownFile ? `/_site/home.${lang}.html` : '/_site/home.html') : sitePageUrl(this.name);
            const html = await morePages.file(path);
            if (!html && lang === defaultLang) throw new Error(this.injector.get(TranslocoService).translate('admin.more_pages.editor.no_file'));
            files[lang] = readPageFile(html);
            own[lang] = ownFile;
            if (lang !== defaultLang && !ownFile) strings[lang] = await uiStrings.load(lang).catch(() => ({}));
        }));
        this.files.set(files);
        this.ownFiles.set(own);
        this.strings.set(strings);
    }

    /** The Production URL, so a local admin shows the live address, as an entry's. */
    private async loadOrigin(): Promise<void> {
        const about = await this.injector.get(SiteIdentityService).load().catch(() => null);
        const url = (about?.finalUrl || '').trim().replace(/\/+$/, '');
        if (url) this.origin.set(url);
    }

    close(): void {
        this.stopPublished?.();
        this.stopPublished = null;
        this.session?.close();
    }
}
