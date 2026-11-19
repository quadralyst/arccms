import {
    ChangeDetectionStrategy, Component, ElementRef, OnDestroy, OnInit, computed, effect, inject, signal, viewChildren,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import { ArcTimePipe } from '../../../core/time/arc-time.pipe';
import { firstValueFrom } from 'rxjs';
import { LocalizationService } from '../../../core/services/localization.service';
import { UiStringsService } from '../../../core/services/ui-strings.service';
import { siteManifest, sitePageUrl } from '../../../core/site/site';
import {
    PageTextService, type PageTextSession, type PageTextVersion, type PublishedPageText,
} from '../../../core/site/page-text.service';
import { pageTextId, safePageTextUrl, sanitizeRichText } from '../../../core/utils/page-text-model';
import { readPageFile, type PageFile } from '../../../core/utils/page-text-areas';
import { injectT } from '../../../core/i18n/inject-t';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { escapeHtml } from '../../../../shared/utils/escape-html';
import MediaManagerComponent from '../(media)/media.page';
import { mediaPickerDialogConfig } from '../(media)/media-picker-dialog';
import { MorePagesService, morePageStatus, type CardTypeInfo } from './more-pages.service';
import {
    goneKeys, sectionViews, seoView, type AreaView, type EditorContext, type GoneKey, type SectionView, type SeoView,
} from './page-text-editor.model';

interface Language {
    code: string;
    label: string;
}

/** How long after the last key a field saves (VE-D52: each field saves on its own). */
const SAVE_DELAY_MS = 700;

/** How often, and how many times, the page asks whether a publish is out. */
const PUBLISH_POLL_MS = 3000;
const PUBLISH_POLLS = 40;

/**
 * The classic editor of the home page or a static page
 * (specs/visual-editing-spec.md, VE-D50 to VE-D52): one field per marked area,
 * grouped by section, the page's card blocks as short boxes, the keys the file no
 * longer has, and a panel with Basic, SEO and History. Every field saves on its
 * own, so two editors on different fields never overwrite each other.
 */
@Component({
    selector: 'arc-page-text-editor',
    standalone: true,
    imports: [ArcTimePipe, RouterLink, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './page-text-editor.page.html',
    styleUrls: ['./page-text-editor.page.scss'],
})
export default class PageTextEditorPage implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private pageText = inject(PageTextService);
    private morePages = inject(MorePagesService);
    private localization = inject(LocalizationService);
    private uiStrings = inject(UiStringsService);
    private dialog = inject(MatDialog);
    private confirm = inject(ConfirmService);
    private t = injectT();

    /** `home`, or the static page's name. */
    readonly name = signal('');
    readonly isHome = computed(() => this.name() === '');
    readonly pageId = computed(() => (this.isHome() ? pageTextId.home() : pageTextId.staticPage(this.name())));

    readonly loading = signal(true);
    readonly loadError = signal('');

    readonly languages = signal<Language[]>([]);
    readonly defaultLang = signal('');
    readonly lang = signal('');
    /** Each language's file (the home page's own file when it has one), and its strings. */
    private readonly files = signal<Record<string, PageFile>>({});
    private readonly ownFiles = signal<Record<string, boolean>>({});
    private readonly strings = signal<Record<string, Record<string, string>>>({});
    readonly cardTypes = signal<Map<string, CardTypeInfo>>(new Map());

    /** The draft's session, once the page's files are read: a signal, so what reads the draft follows it. */
    private readonly sessionRef = signal<PageTextSession | null>(null);
    get session(): PageTextSession | null {
        return this.sessionRef();
    }
    readonly draft = computed(() => this.sessionRef()?.draft() ?? null);
    readonly published = signal<PublishedPageText | null>(null);
    readonly status = computed(() => morePageStatus(this.draft(), this.published()));
    readonly lastPublished = computed(() => this.published()?.publishedAt?.toMillis?.() ?? null);

    readonly panel = signal<'basic' | 'seo' | 'history'>('basic');
    readonly history = signal<PageTextVersion[] | null>(null);
    readonly historyError = signal(false);

    /** Saves under way, and the last save that failed. */
    readonly saving = signal(0);
    readonly saveError = signal('');
    readonly publishing = signal(false);
    readonly publishError = signal('');

    /** What is being typed in a field, by field id, while it is: shown instead of the saved value. */
    readonly typing = signal<Record<string, string>>({});
    /** An address typed that cannot be used, by field id. */
    readonly badUrl = signal<Record<string, boolean>>({});
    private timers = new Map<string, { timer: ReturnType<typeof setTimeout>; save: () => Promise<void> }>();
    private pollTimer: ReturnType<typeof setTimeout> | null = null;

    readonly richEditors = viewChildren<ElementRef<HTMLElement>>('rich');
    /** The rich text field whose link box is open, and the selection it applies to. */
    readonly linkFor = signal('');
    linkUrl = '';
    private linkRange: Range | null = null;

    private context = computed<EditorContext | null>(() => {
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
    readonly isDefaultLang = computed(() => this.lang() === this.defaultLang());
    readonly pageTitle = computed(() => (this.isHome() ? this.t('admin.more_pages.home_page') : this.files()[this.defaultLang()]?.title || this.name()));

    constructor() {
        // A rich text field shows others' saves, but never under the cursor of the person typing in it.
        effect(() => {
            const sections = this.sections();
            for (const ref of this.richEditors()) {
                const el = ref.nativeElement;
                const key = el.dataset['key'] || '';
                const view = sections.flatMap((s) => s.areas).find((a) => a.area.key === key);
                if (!view || el === document.activeElement) continue;
                const html = view.words || '';
                if (el.innerHTML !== html) el.innerHTML = html;
            }
        });
    }

    async ngOnInit(): Promise<void> {
        this.name.set(this.route.snapshot.paramMap.get('name') || '');
        try {
            const settings = await this.localization.load();
            const defaultLang = settings.defaultLanguage || 'en';
            // Static pages exist in the default language only (VE-D43).
            const languages = this.isHome()
                ? (settings.enabledLanguages || []).map((l: { code: string; label?: string; nativeLabel?: string }) => ({ code: l.code, label: l.nativeLabel || l.label || l.code }))
                : [];
            const list = languages.length ? languages : [{ code: defaultLang, label: defaultLang }];
            list.sort((a, b) => (a.code === defaultLang ? -1 : b.code === defaultLang ? 1 : 0));
            this.languages.set(list);
            this.defaultLang.set(defaultLang);
            this.lang.set(defaultLang);
            await this.loadFiles(list.map((l) => l.code), defaultLang);
            const session = this.pageText.session(this.pageId());
            session.open();
            this.sessionRef.set(session);
            const [published, cardTypes] = await Promise.all([this.pageText.published(this.pageId()), this.morePages.cardTypes()]);
            this.published.set(published);
            this.cardTypes.set(cardTypes);
        } catch (error: any) {
            console.error('[PageTextEditor] Could not open the page:', error);
            this.loadError.set(error?.message || String(error));
        } finally {
            this.loading.set(false);
        }
    }

    private async loadFiles(langs: string[], defaultLang: string): Promise<void> {
        const manifest = siteManifest();
        const files: Record<string, PageFile> = {};
        const own: Record<string, boolean> = {};
        const strings: Record<string, Record<string, string>> = {};
        await Promise.all(langs.map(async (lang) => {
            const ownFile = this.isHome() && lang !== defaultLang && !!manifest.home[lang];
            const path = this.isHome() ? (ownFile ? `/_site/home.${lang}.html` : '/_site/home.html') : sitePageUrl(this.name());
            const html = await this.morePages.file(path);
            if (!html && lang === defaultLang) throw new Error(this.t('admin.more_pages.editor.no_file'));
            files[lang] = readPageFile(html);
            own[lang] = ownFile;
            if (lang !== defaultLang && !ownFile) strings[lang] = await this.uiStrings.load(lang).catch(() => ({}));
        }));
        this.files.set(files);
        this.ownFiles.set(own);
        this.strings.set(strings);
    }

    ngOnDestroy(): void {
        for (const pending of this.timers.values()) {
            clearTimeout(pending.timer);
            void pending.save();
        }
        this.timers.clear();
        if (this.pollTimer) clearTimeout(this.pollTimer);
        this.session?.close();
    }

    // ── Saving a field (VE-D52) ─────────────────────────────────────────────

    /** A field's id: what it edits, in which language. */
    fieldId(kind: 'w' | 'u', key: string): string {
        return kind === 'w' ? `w:${this.lang()}:${key}` : `u:${key}`;
    }

    /** The value a field shows: what is being typed in it, else what is saved. */
    shown(id: string, saved: string): string {
        const typed = this.typing()[id];
        return typed !== undefined ? typed : saved;
    }

    private async run(save: () => Promise<void>): Promise<void> {
        this.saving.update((n) => n + 1);
        try {
            await save();
            this.saveError.set('');
        } catch (error: any) {
            console.error('[PageTextEditor] Could not save:', error);
            this.saveError.set(error?.message || String(error));
        } finally {
            this.saving.update((n) => n - 1);
        }
    }

    /** Saves a field once typing stops, or at once (`now`, when the field is left). */
    private schedule(id: string, save: () => Promise<void>, now = false): void {
        const pending = this.timers.get(id);
        if (pending) clearTimeout(pending.timer);
        const go = async () => {
            this.timers.delete(id);
            await this.run(save);
        };
        if (now) {
            void go().then(() => this.stopTyping(id));
            return;
        }
        this.timers.set(id, { timer: setTimeout(go, SAVE_DELAY_MS), save: go });
    }

    private stopTyping(id: string): void {
        if (this.timers.has(id)) return;
        this.typing.update(({ [id]: _, ...rest }) => rest);
    }

    /** The words of an area in this language: saved, or removed when emptied (the file's then show). */
    private saveWords(view: AreaView, value: string, lang = this.lang()): Promise<void> {
        const session = this.session!;
        if (!value.trim()) return view.words ? session.useFileText(lang, view.area.key) : Promise.resolve();
        return session.saveText(lang, view.area.key, value, {
            fileText: view.fileWords,
            ...(lang !== this.defaultLang() ? { sourceText: view.defaultWords } : {}),
        });
    }

    wordsInput(view: AreaView, value: string): void {
        const id = this.fieldId('w', view.area.key);
        // The language typed in, kept: a switch before the save must not move the words to another.
        const lang = this.lang();
        this.typing.update((t) => ({ ...t, [id]: value }));
        this.schedule(id, () => this.saveWords(view, value, lang));
    }

    wordsLeft(view: AreaView): void {
        const id = this.fieldId('w', view.area.key);
        const pending = this.timers.get(id);
        if (pending) {
            clearTimeout(pending.timer);
            this.timers.delete(id);
            void this.run(pending.save).then(() => this.stopTyping(id));
        } else {
            this.stopTyping(id);
        }
    }

    /** Enter in rich text is a line break, which the page keeps (a new block would not be). */
    lineBreak(event: Event): void {
        event.preventDefault();
        document.execCommand('insertLineBreak');
    }

    /** Another language: what is still waiting to save goes first, in the language it was typed in. */
    chooseLanguage(code: string): void {
        for (const [id, pending] of this.timers) {
            clearTimeout(pending.timer);
            this.timers.delete(id);
            void this.run(pending.save).then(() => this.stopTyping(id));
        }
        this.linkFor.set('');
        this.lang.set(code);
    }

    richInput(view: AreaView, el: HTMLElement): void {
        this.wordsInput(view, sanitizeRichText(el.innerHTML).replace(/^(<br>)+$/, ''));
    }

    /** Use the file's text (VE-D46): the saved words go, and the page shows the file's again. */
    useFileWords(view: AreaView): void {
        const id = this.fieldId('w', view.area.key);
        this.typing.update(({ [id]: _, ...rest }) => rest);
        void this.run(() => this.session!.useFileText(this.lang(), view.area.key));
    }

    /** Keep mine (VE-D45): the saved words stay, now saved against the file's new text. */
    keepWords(view: AreaView): void {
        void this.run(() => this.saveWords(view, view.words));
    }

    /** The translation is still right (VE-D44): saved again against the default language's words now. */
    translationChecked(view: AreaView): void {
        void this.run(() => this.saveWords(view, view.words));
    }

    // ── Addresses ──────────────────────────────────────────────────────────

    urlInput(view: AreaView, value: string): void {
        const id = this.fieldId('u', view.area.key);
        this.typing.update((t) => ({ ...t, [id]: value }));
        const bad = !!value.trim() && !safePageTextUrl(value);
        this.badUrl.update((b) => ({ ...b, [id]: bad }));
        if (bad) {
            const pending = this.timers.get(id);
            if (pending) clearTimeout(pending.timer);
            this.timers.delete(id);
            return;
        }
        this.schedule(id, () => this.saveUrl(view, value.trim()));
    }

    urlLeft(view: AreaView): void {
        const id = this.fieldId('u', view.area.key);
        if (this.badUrl()[id]) return;
        const pending = this.timers.get(id);
        if (pending) {
            clearTimeout(pending.timer);
            this.timers.delete(id);
            void this.run(pending.save).then(() => this.stopTyping(id));
        } else {
            this.stopTyping(id);
        }
    }

    private saveUrl(view: AreaView, url: string): Promise<void> {
        if (!url) return view.url ? this.session!.useFileUrl(view.area.key) : Promise.resolve();
        return this.session!.saveUrl(view.area.key, url, { fileText: view.fileUrl });
    }

    useFileUrl(view: AreaView): void {
        const id = this.fieldId('u', view.area.key);
        this.typing.update(({ [id]: _, ...rest }) => rest);
        this.badUrl.update(({ [id]: _, ...rest }) => rest);
        void this.run(() => this.session!.useFileUrl(view.area.key));
    }

    keepUrl(view: AreaView): void {
        void this.run(() => this.saveUrl(view, view.url));
    }

    /** A picture or background from the media library. */
    async choosePicture(view: AreaView): Promise<void> {
        const title = this.areaName(view);
        const result = await firstValueFrom(
            this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({ isDialogOpen: true, title })).afterClosed(),
        ) as { mediaUrl?: string; type?: string } | null;
        if (result?.type === 'submit' && result.mediaUrl) await this.run(() => this.saveUrl(view, result.mediaUrl!));
    }

    // ── Rich text ──────────────────────────────────────────────────────────

    format(command: 'bold' | 'italic', el: HTMLElement): void {
        el.focus();
        document.execCommand(command);
    }

    openLink(view: AreaView, el: HTMLElement): void {
        const selection = window.getSelection();
        this.linkRange = selection && selection.rangeCount && el.contains(selection.anchorNode) ? selection.getRangeAt(0).cloneRange() : null;
        this.linkUrl = '';
        this.linkFor.set(view.area.key);
    }

    applyLink(view: AreaView, el: HTMLElement): void {
        const url = safePageTextUrl(this.linkUrl);
        if (!url || !this.linkRange) {
            this.linkFor.set('');
            return;
        }
        el.focus();
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(this.linkRange);
        document.execCommand('createLink', false, url);
        this.linkFor.set('');
        this.richInput(view, el);
        this.wordsLeft(view);
    }

    // ── SEO (VE-D51) ───────────────────────────────────────────────────────

    seoInput(field: 'title' | 'description', value: string): void {
        const id = `s:${this.lang()}:${field}`;
        const lang = this.lang();
        this.typing.update((t) => ({ ...t, [id]: value }));
        this.schedule(id, () => (value.trim()
            ? this.session!.saveSeo(lang, field, value.trim())
            : this.session!.useFileSeo(lang, field)));
    }

    seoLeft(field: 'title' | 'description'): void {
        const id = `s:${this.lang()}:${field}`;
        const pending = this.timers.get(id);
        if (pending) {
            clearTimeout(pending.timer);
            this.timers.delete(id);
            void this.run(pending.save).then(() => this.stopTyping(id));
        } else {
            this.stopTyping(id);
        }
    }

    async chooseShareImage(): Promise<void> {
        const result = await firstValueFrom(this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({
            isDialogOpen: true, title: this.t('admin.more_pages.editor.share_image'),
        })).afterClosed()) as { mediaUrl?: string; type?: string } | null;
        if (result?.type === 'submit' && result.mediaUrl) await this.run(() => this.session!.saveShareImage(result.mediaUrl!));
    }

    useFileShareImage(): void {
        void this.run(() => this.session!.useFileShareImage());
    }

    // ── The page ───────────────────────────────────────────────────────────

    async removeGone(key: string): Promise<void> {
        const ok = await this.confirm.ask({
            titleKey: 'admin.more_pages.editor.remove_title',
            dialogMessage: this.t('admin.more_pages.editor.remove_confirm', { key: escapeHtml(key) }),
            btnText: this.t('admin.more_pages.editor.remove'),
            panelType: 'warn',
        });
        if (ok) await this.run(() => this.session!.removeKey(key));
    }

    /** Publishes the page's areas and SEO (VE-D53), then waits for the published copy to catch up. */
    async publish(): Promise<void> {
        if (!this.session || this.publishing()) return;
        this.publishError.set('');
        // A field still waiting to save goes first.
        await Promise.all([...this.timers.entries()].map(([id, pending]) => {
            clearTimeout(pending.timer);
            this.timers.delete(id);
            return this.run(pending.save).then(() => this.stopTyping(id));
        }));
        if (this.saveError()) return;
        this.publishing.set(true);
        try {
            await this.session.publish();
            this.pollPublished(0);
        } catch (error: any) {
            console.error('[PageTextEditor] Could not publish:', error);
            this.publishing.set(false);
            this.publishError.set(error?.message || String(error));
        }
    }

    private pollPublished(round: number): void {
        this.pollTimer = setTimeout(async () => {
            const published = await this.pageText.published(this.pageId());
            if (published) this.published.set(published);
            if (morePageStatus(this.draft(), published) !== 'changes' || round >= PUBLISH_POLLS) {
                this.publishing.set(false);
                if (round >= PUBLISH_POLLS && morePageStatus(this.draft(), published) === 'changes') {
                    this.publishError.set(this.t('admin.more_pages.editor.publish_slow'));
                }
                if (this.panel() === 'history') void this.loadHistory();
                return;
            }
            this.pollPublished(round + 1);
        }, PUBLISH_POLL_MS);
    }

    showPanel(panel: 'basic' | 'seo' | 'history'): void {
        this.panel.set(panel);
        if (panel === 'history') void this.loadHistory();
    }

    async loadHistory(): Promise<void> {
        this.historyError.set(false);
        try {
            this.history.set(await this.pageText.history(this.pageId()));
        } catch (error) {
            console.error('[PageTextEditor] Could not read the history:', error);
            this.historyError.set(true);
        }
    }

    /** Restore (VE-D51): a version becomes the draft, which then needs Publish. */
    async restore(version: PageTextVersion): Promise<void> {
        const ok = await this.confirm.ask({
            titleKey: 'admin.more_pages.editor.restore_title',
            dialogMessage: this.t('admin.more_pages.editor.restore_confirm'),
            btnText: this.t('admin.more_pages.editor.restore'),
        });
        if (!ok) return;
        await this.run(() => this.session!.restore(version));
        this.panel.set('basic');
    }

    /** Live Preview (VE-D50): the page drawn with the draft, following each save. */
    openPreview(): void {
        const lang = this.lang();
        const path = this.isHome()
            ? `/admin/preview-page/home${lang !== this.defaultLang() ? `/${lang}` : ''}`
            : `/admin/preview-page/p/${this.name()}`;
        const win = window.open(path, `arc-page-preview-${this.pageId()}`);
        win?.focus();
    }

    /** Rich text's words without its tags, for a placeholder. */
    plain(html: string): string {
        return new DOMParser().parseFromString(html || '', 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    }

    /** An area's name: its label, else its section's, else its key made readable. */
    areaName(view: AreaView): string {
        return view.area.label || view.area.key.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
    }

    sectionName(section: SectionView, position: number): string {
        if (section.label) return section.label;
        return section.index < 0 ? this.t('admin.more_pages.editor.rest_of_page') : this.t('admin.more_pages.editor.section', { n: position + 1 });
    }

    cardTypeName(type: string): string {
        return this.cardTypes().get(type)?.name || type;
    }

    cardOwnOrder(type: string): boolean {
        return !!this.cardTypes().get(type)?.ownOrder;
    }

    entryCount(version: PageTextVersion): number {
        const words = Object.values(version.text || {}).reduce((n, byKey) => n + Object.keys(byKey || {}).length, 0);
        return words + Object.keys(version.urls || {}).length;
    }

    millis(time: { toMillis?: () => number } | null | undefined): number | null {
        return time?.toMillis?.() ?? null;
    }

    titleLength(): number {
        const seo = this.seo();
        return this.shown(`s:${this.lang()}:title`, seo?.title ?? '').length || (seo?.titleFallback.length ?? 0);
    }

    descriptionLength(): number {
        const seo = this.seo();
        return this.shown(`s:${this.lang()}:description`, seo?.description ?? '').length || (seo?.descriptionFallback.length ?? 0);
    }
}
