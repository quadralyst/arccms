import {
    ChangeDetectionStrategy, Component, ElementRef, Injector, OnDestroy, OnInit, computed, effect, inject, signal, viewChild, viewChildren,
} from '@angular/core';
import { isHeld } from '../../../core/editing/hold';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import type { PageTextSession } from '../../../core/site/page-text.service';
import { safePageTextUrl, sanitizeRichText, LIST_TITLE_KEY, LIST_INTRO_KEY } from '../../../core/utils/page-text-model';
import { injectT } from '../../../core/i18n/inject-t';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { escapeHtml } from '../../../../shared/utils/escape-html';
import MediaManagerComponent from '../(media)/media.page';
import { mediaPickerDialogConfig } from '../(media)/media-picker-dialog';
import { EditStateComponent } from '../edit/page-status.component';
import { HoldBarComponent } from '../hold/hold-bar.component';
import { PageReview } from './page-review';
import { PageTextPanelComponent } from './page-text-panel.component';
import { PageEditorData } from './page-editor-data';
import { LIST_PAGE_KEYS, type AreaView, type SectionView } from './page-text-editor.model';
import { pagePreviewPath, pageRefFrom, visualEditorLink } from './page-ref';

/** How long after the last key a field saves (VE-D52: each field saves on its own). */
const SAVE_DELAY_MS = 700;

/**
 * The classic editor of the home page, a static page or a list page
 * (specs/visual-editing-spec.md, VE-D50 to VE-D52, VE-D65): one field per marked area,
 * grouped by section, the page's card blocks as short boxes, the keys the file no
 * longer has, and a panel with Basic, SEO and History. Every field saves on its
 * own, so two editors on different fields never overwrite each other.
 */
@Component({
    selector: 'arc-page-text-editor',
    standalone: true,
    imports: [RouterLink, TranslocoPipe, EditStateComponent, HoldBarComponent, PageTextPanelComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    templateUrl: './page-text-editor.page.html',
    styleUrls: ['./page-text-editor.page.scss'],
})
export default class PageTextEditorPage implements OnInit, OnDestroy {
    private route = inject(ActivatedRoute);
    private dialog = inject(MatDialog);
    private confirm = inject(ConfirmService);
    private t = injectT();

    /** The page's languages, files and draft, shared with the Visual Editor. */
    readonly data = new PageEditorData(inject(Injector), pageRefFrom(this.route.snapshot.paramMap));
    readonly isList = this.data.isList;
    readonly pageId = this.data.pageId;
    readonly loading = this.data.loading;
    readonly loadError = this.data.loadError;
    readonly languages = this.data.languages;
    readonly defaultLang = this.data.defaultLang;
    readonly lang = this.data.lang;
    readonly cardTypes = this.data.cardTypes;
    readonly draft = this.data.draft;
    readonly sections = this.data.sections;
    readonly seo = this.data.seo;
    readonly gone = this.data.gone;
    readonly isDefaultLang = this.data.isDefaultLang;
    get session(): PageTextSession | null {
        return this.data.session;
    }
    readonly pageTitle = computed(() => {
        if (this.data.isHome) return this.t('admin.more_pages.home_page');
        return this.isList ? this.t('admin.more_pages.list_page', { type: this.data.fileTitle() }) : this.data.fileTitle();
    });

    /** Saves under way, and the last save that failed. */
    readonly saving = signal(0);
    /** Saves that failed, by field id (`*` for a save of no one field): one field's later save never hides another's. */
    private readonly saveErrors = signal<Record<string, string>>({});
    readonly saveError = computed(() => Object.values(this.saveErrors())[0] ?? '');

    /** What is being typed in a field, by field id, while it is: shown instead of the saved value. */
    readonly typing = signal<Record<string, string>>({});
    /** An address typed that cannot be used, by field id. */
    readonly badUrl = signal<Record<string, boolean>>({});
    private timers = new Map<string, { timer: ReturnType<typeof setTimeout>; save: () => Promise<boolean> }>();

    /** The panel, which Publish on the top bar runs through. */
    readonly panelRef = viewChild<PageTextPanelComponent>('panelRef');
    readonly richEditors = viewChildren<ElementRef<HTMLElement>>('rich');
    /** The rich text field whose link box is open, and the selection it applies to. */
    readonly linkFor = signal('');
    linkUrl = '';
    private linkRange: Range | null = null;

    constructor() {
        // A rich text field shows others' saves, but never under the cursor of the person typing in it.
        effect(() => {
            const sections = this.sections();
            for (const ref of this.richEditors()) {
                const el = ref.nativeElement;
                const key = el.dataset['key'] || '';
                const view = sections.flatMap((s) => s.areas).find((a) => a.area.key === key);
                if (!view || el === document.activeElement) continue;
                // Saved words go through the allow-list: a draft can be written straight to Firestore.
                const html = sanitizeRichText(view.words || '');
                if (el.innerHTML !== html) el.innerHTML = html;
            }
        });
    }

    /** Where the Visual Editor was opened from, handed back to it: its Close goes there. */
    openedFrom: Record<string, string> = {};

    ngOnInit(): void {
        const state = typeof window === 'undefined' ? null : window.history.state;
        for (const key of ['arcFrom', 'arcOpenedFrom']) {
            if (typeof state?.[key] === 'string') this.openedFrom = { ...this.openedFrom, [key]: state[key] };
        }
        void this.data.load();
    }

    ngOnDestroy(): void {
        for (const pending of this.timers.values()) {
            clearTimeout(pending.timer);
            void pending.save();
        }
        this.timers.clear();
        this.data.close();
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

    /** Runs a save; true when it landed. A failure stays shown until that field saves. */
    private async run(save: () => Promise<void>, id = '*'): Promise<boolean> {
        this.saving.update((n) => n + 1);
        try {
            await save();
            this.saveErrors.update(({ [id]: _, ...rest }) => rest);
            return true;
        } catch (error: any) {
            // Someone else made the first change: the bar says who, and the fields show theirs.
            if (isHeld(error)) {
                this.typing.set({});
                return false;
            }
            console.error('[PageTextEditor] Could not save:', error);
            this.saveErrors.update((errors) => ({ ...errors, [id]: error?.message || String(error) }));
            return false;
        } finally {
            this.saving.update((n) => n - 1);
        }
    }

    /** Saves a field once typing stops, or at once (`now`, when the field is left). */
    private schedule(id: string, save: () => Promise<void>, now = false): void {
        const pending = this.timers.get(id);
        if (pending) clearTimeout(pending.timer);
        const go = async (): Promise<boolean> => {
            this.timers.delete(id);
            return this.run(save, id);
        };
        if (now) {
            void go().then((ok) => ok && this.stopTyping(id));
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
            void pending.save().then((ok) => ok && this.stopTyping(id));
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
            void pending.save().then((ok) => ok && this.stopTyping(id));
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
            void pending.save().then((ok) => ok && this.stopTyping(id));
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

    /** Saves every field still waiting, before Publish; false when one could not be saved. */
    readonly flushAll = async (): Promise<boolean> => {
        await Promise.all([...this.timers.entries()].map(([id, pending]) => {
            clearTimeout(pending.timer);
            this.timers.delete(id);
            return pending.save().then((ok) => ok && this.stopTyping(id));
        }));
        // A field whose save failed keeps its words and its error: Publish waits for it.
        return !this.saveError();
    };

    private reviews = inject(PageReview);

    /** Review changes (VE-D80): someone else's, or this person's own. */
    review(): void {
        void this.reviews.open(this.data, this.pageTitle(), {
            flush: this.flushAll,
            // Someone else's words as they are, or this person's through the panel.
            publish: () => (this.data.heldBy() ? this.panelRef()?.publishWords() : this.panelRef()?.publish()),
            kept: () => this.panelRef()?.keptChanged.update((n) => n + 1),
            show: (change) => {
                if (change.lang && change.lang !== this.lang()) this.chooseLanguage(change.lang);
                const areaKey = change.field.replace(/^(text|url):/, '');
                const shown = this.sections().some((section) => section.areas.some((view) => view.area.key === areaKey));
                // Title, summary and cover image are in the panel; a list page's SEO words on its SEO tab, and its
                // title and summary in Basic when its file marks no heading or intro (VE-D60).
                if (!/^(text|url):/.test(change.field) || (this.isList && LIST_PAGE_KEYS.includes(areaKey) && !shown)) {
                    const search = this.isList && change.field.startsWith('seo:');
                    this.panelRef()?.showTab(search ? 'seo' : 'basic');
                    const title = /title$/.test(change.field);
                    const id = change.field === 'shareImage' ? '' : `${search ? 'seo' : 'page'}-${title ? 'title' : 'summary'}`;
                    setTimeout(() => document.getElementById(id)?.focus());
                    return;
                }
                setTimeout(() => {
                const key = change.field.replace(/^(text|url):/, '');
                const el = document.getElementById(`${change.field.startsWith('url:') ? 'u' : 'w'}-${key}`);
                el?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
                el?.focus?.({ preventScroll: true });
                });
            },
        });
    }

    /** The Visual Editor of the same page (VE-D49): the same draft. */
    visualEditorLink(): string[] {
        return visualEditorLink(this.data.page);
    }

    /** Live Preview (VE-D50): the page drawn with the draft, following each save. */
    openPreview(): void {
        const win = window.open(pagePreviewPath(this.data.page, this.lang(), this.defaultLang()), `arc-page-preview-${this.pageId}`);
        win?.focus();
    }

    /** Rich text's words without its tags, for a placeholder. */
    plain(html: string): string {
        return new DOMParser().parseFromString(html || '', 'text/html').body.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    }

    /** An area's name: its label, else its section's, else its key made readable. */
    areaName(view: AreaView): string {
        // A list page's heading and intro are its Title and Summary, under those names everywhere (VE-D60).
        if (this.isList && view.area.key === LIST_TITLE_KEY) return this.t('admin.contents.editor.title_label');
        if (this.isList && view.area.key === LIST_INTRO_KEY) return this.t('admin.contents.editor.summary');
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
}
