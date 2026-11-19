import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
    ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, OnDestroy, OnInit, PLATFORM_ID, ViewChild,
    computed, effect, inject, signal,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { injectT } from '../../../core/i18n/inject-t';
import { safePageTextUrl } from '../../../core/utils/page-text-model';
import MediaManagerComponent from '../(media)/media.page';
import { mediaPickerDialogConfig } from '../(media)/media-picker-dialog';
import { PagePanel } from '../edit/page-panel';
import { PageEditorData } from './page-editor-data';
import { PageInPlace, type PageInPlaceHost } from './page-in-place';
import { PageTextPanelComponent } from './page-text-panel.component';
import type { AreaView } from './page-text-editor.model';

/** How long the screen waits for the frame to draw the page. */
const DRAW_WAIT_MS = 20_000;

/** The frame's address: the page's Live Preview in edit mode (VE-D55). */
export function pageEditFrameUrl(name: string, lang: string, defaultLang: string): string {
    if (name) return `/admin/preview-page/p/${encodeURIComponent(name)}?edit=1`;
    return `/admin/preview-page/home${lang && lang !== defaultLang ? `/${encodeURIComponent(lang)}` : ''}?edit=1`;
}

/** The box for what is not typed in place, and where it shows. */
interface Box {
    view: AreaView;
    el: HTMLElement;
    top: number;
    left: number;
}

/**
 * The Visual Editor for the home page or a static page
 * (specs/visual-editing-spec.md, VE-D49, VE-D50, VE-D55): the page as the site
 * draws it in a frame, its marked areas changed where they are, under the same
 * strip as an entry's Visual Editor, with the page's panel as Page settings. It is
 * the same draft as the classic editor's, and every change saves on its own.
 */
@Component({
    selector: 'arc-page-edit',
    standalone: true,
    imports: [TranslocoPipe, PageTextPanelComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrls: ['../edit/edit-screen.css'],
    styles: [`.page-panel-body { width: min(340px, 100vw - 24px); overflow-y: auto; }`],
    template: `
    <div class="arc-ed-strip" role="region" [attr.aria-label]="'admin.edit_page.strip' | transloco" data-testid="page-edit-strip">
        <span class="arc-ed-title">{{ pageTitle() }}</span>
        <span [class]="'arc-ed-status arc-ed-' + status()" role="status" data-testid="page-edit-status">{{ ('admin.edit_page.' + status()) | transloco }}</span>
        @if (typingRich()) {
        <span class="arc-ed-group arc-ed-format" role="toolbar" [attr.aria-label]="'admin.edit_page.formatting' | transloco">
            <button type="button" class="arc-ed-btn arc-ed-fmt" (mousedown)="$event.preventDefault()" (click)="format('bold')" [attr.aria-label]="'admin.more_pages.editor.bold' | transloco"><b>B</b></button>
            <button type="button" class="arc-ed-btn arc-ed-fmt" (mousedown)="$event.preventDefault()" (click)="format('italic')" [attr.aria-label]="'admin.more_pages.editor.italic' | transloco"><i>I</i></button>
            <button type="button" class="arc-ed-btn arc-ed-fmt" (mousedown)="$event.preventDefault()" (click)="openLinkBox()" [attr.aria-label]="'admin.more_pages.editor.link' | transloco">{{ 'admin.more_pages.editor.link' | transloco }}</button>
        </span>
        }
        <span class="arc-ed-spacer"></span>
        @if (data.languages().length > 1) {
        <span class="arc-ed-group" role="group" [attr.aria-label]="'admin.edit_page.language' | transloco" data-testid="page-edit-languages">
            @for (l of data.languages(); track l.code) {
            <button type="button" class="arc-ed-btn" [class.arc-ed-on]="data.lang() === l.code" [attr.aria-pressed]="data.lang() === l.code"
                [title]="l.label" (click)="switchLanguage(l.code)">{{ l.code.toUpperCase() }}</button>
            }
        </span>
        }
        <span class="arc-ed-group" role="group" [attr.aria-label]="'admin.preview.width' | transloco">
            <button type="button" class="arc-ed-btn" [class.arc-ed-on]="!phone()" [attr.aria-pressed]="!phone()" (click)="phone.set(false)"
                [title]="'admin.preview.full_width' | transloco" [attr.aria-label]="'admin.preview.full_width' | transloco"><i class="bi bi-display" aria-hidden="true"></i></button>
            <button type="button" class="arc-ed-btn" [class.arc-ed-on]="phone()" [attr.aria-pressed]="phone()" (click)="phone.set(true)"
                [title]="'admin.preview.phone' | transloco" [attr.aria-label]="'admin.preview.phone' | transloco"><i class="bi bi-phone" aria-hidden="true"></i></button>
        </span>
        <button type="button" class="arc-ed-btn" (click)="toClassic()" [title]="'admin.edit_page.form_title' | transloco" data-testid="page-edit-classic">{{ 'admin.edit_page.form' | transloco }}</button>
        <button type="button" class="arc-ed-btn" (click)="panel.toggle()" [class.arc-ed-on]="panel.open()"
            [attr.aria-expanded]="panel.open()" aria-controls="arc-ed-panel" data-testid="page-edit-settings">{{ 'admin.edit_page.page_settings' | transloco }}</button>
        <button type="button" class="arc-ed-btn arc-ed-primary" (click)="publish()" [disabled]="!panelRef || saving() > 0" data-testid="page-edit-publish">{{ 'admin.more_pages.editor.publish' | transloco }}</button>
        <button type="button" class="arc-ed-btn" (click)="close()" data-testid="page-edit-close">{{ 'common.actions.close' | transloco }}</button>
    </div>
    @if (data.loadError()) {
    <div class="alert alert-danger m-3" role="alert">{{ data.loadError() }}</div>
    }
    @if (data.session?.error(); as readError) {
    <div class="alert alert-danger m-0 rounded-0 py-2" role="alert">{{ 'admin.more_pages.editor.not_read' | transloco: { error: readError } }}</div>
    }
    @if (saveError()) {
    <div class="alert alert-danger m-0 rounded-0 py-2" role="alert">{{ 'admin.more_pages.editor.not_saved_detail' | transloco: { error: saveError() } }}</div>
    }
    <div class="arc-ed-stage">
        @if (frameUrl(); as url) {
        <iframe #frame class="arc-ed-frame" [class.arc-ed-phone]="phone()" [src]="url" [title]="'admin.edit_page.frame' | transloco"
            (load)="onFrameLoad()" data-testid="page-edit-frame"></iframe>
        }
        @if (!drawn()) {
        <p class="arc-ed-loading" role="status">{{ 'admin.edit_page.loading' | transloco }}</p>
        }
        <aside id="arc-ed-panel" class="arc-ed-panel" #panelBox [class.arc-ed-dragging]="panel.dragging()" [style.transform]="panel.transform()"
            [attr.aria-label]="'admin.edit_page.page_settings' | transloco" data-testid="page-edit-panel">
            <button type="button" class="arc-ed-handle" [attr.aria-expanded]="panel.open()" aria-controls="arc-ed-panel"
                [attr.aria-label]="'admin.edit_page.page_settings' | transloco" [title]="'admin.edit_page.page_settings' | transloco"
                (pointerdown)="onHandleDown($event)" (pointermove)="panel.move($event.clientX)" (pointerup)="panel.release()" (pointercancel)="panel.cancel()"
                (keydown.enter)="$event.preventDefault(); panel.toggle()" (keydown.space)="$event.preventDefault(); panel.toggle()">
                <span aria-hidden="true">{{ panel.open() ? '›' : '‹' }}</span>
            </button>
            <div class="arc-ed-panel-body page-panel-body" [attr.inert]="panel.shown() ? null : ''" (pointerdown)="leaveSpot()">
                @if (data.session; as session) {
                <arc-page-text-panel #panelRef [session]="session" [lang]="data.lang()" [defaultLang]="data.defaultLang()" [seo]="data.seo()"
                    [busy]="saving() > 0" [beforePublish]="beforePublish" />
                }
            </div>
        </aside>
    </div>
    @if (spot(); as spot) {
    <div class="arc-ed-spot" [style.top.px]="spot.top" [style.left.px]="spot.left" data-testid="page-edit-spot">
        <button type="button" (mousedown)="$event.preventDefault()" (click)="cancelSpot()">{{ 'common.actions.cancel' | transloco }}</button>
        <button type="button" class="arc-ed-spot-done" (mousedown)="$event.preventDefault()" (click)="doneSpot()">{{ 'admin.edit_page.done' | transloco }}</button>
    </div>
    }
    @if (box(); as box) {
    <div class="arc-ed-pop arc-ed-pic" role="dialog" [attr.aria-label]="areaName(box.view)" [style.top.px]="box.top" [style.left.px]="box.left"
        (keydown.escape)="closeBox(); $event.stopPropagation()" data-testid="page-edit-box">
        <div class="arc-ed-pop-head">
            <span class="arc-ed-pop-title">{{ areaName(box.view) }}</span>
            <button type="button" class="arc-ed-pop-done" (click)="closeBox()">{{ 'admin.edit_page.done' | transloco }}</button>
        </div>
        @if (box.view.area.kind === 'picture' || box.view.area.kind === 'background') {
        <div class="arc-ed-pop-actions">
            <button type="button" class="btn btn-outline-primary btn-sm" (click)="choosePicture(box.view)">{{ 'admin.more_pages.editor.choose_picture' | transloco }}</button>
            @if (box.view.url) {
            <button type="button" class="btn btn-link btn-sm" (click)="useFileUrl(box.view)">{{ 'admin.more_pages.editor.use_file_picture' | transloco }}</button>
            }
        </div>
        }
        @if (box.view.area.kind === 'picture') {
        <label class="arc-ed-pic-alt mt-2">
            <span>{{ 'admin.more_pages.editor.alt_text' | transloco }}</span>
            <input class="form-control form-control-sm" type="text" [value]="box.view.words" [placeholder]="box.view.wordsFallback"
                (change)="saveWords(box.view, $any($event.target).value)" (keydown.enter)="saveWords(box.view, $any($event.target).value)">
        </label>
        }
        @if (box.view.area.kind === 'section-title') {
        <label class="arc-ed-pic-alt">
            <span>{{ 'admin.edit_page.section_title' | transloco }}</span>
            <input class="form-control form-control-sm" type="text" [value]="box.view.words" [placeholder]="box.view.wordsFallback"
                (change)="saveWords(box.view, $any($event.target).value)" (keydown.enter)="saveWords(box.view, $any($event.target).value)">
        </label>
        }
        @if (box.view.area.kind === 'link' || linkFor()) {
        <label class="arc-ed-pic-alt">
            <span>{{ 'admin.more_pages.editor.address' | transloco }}</span>
            <input class="form-control form-control-sm" type="text" [class.is-invalid]="badUrl()" [value]="linkFor() ? '' : box.view.url"
                [placeholder]="linkFor() ? ('admin.more_pages.editor.address_placeholder' | transloco) : box.view.fileUrl"
                (change)="addressChanged(box.view, $any($event.target).value)" (keydown.enter)="addressChanged(box.view, $any($event.target).value)">
            @if (badUrl()) {
            <small class="arc-ed-error">{{ 'admin.more_pages.editor.bad_address' | transloco }}</small>
            }
        </label>
        @if (box.view.url && !linkFor()) {
        <button type="button" class="btn btn-link btn-sm px-0" (click)="useFileUrl(box.view)">{{ 'admin.more_pages.editor.use_file_address' | transloco }}</button>
        }
        }
    </div>
    }
    `,
})
export default class PageEditPage implements OnInit, OnDestroy, PageInPlaceHost {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private document = inject(DOCUMENT);
    private platformId = inject(PLATFORM_ID);
    private sanitizer = inject(DomSanitizer);
    private dialog = inject(MatDialog);
    private t = injectT();

    readonly data = new PageEditorData(inject(Injector), this.route.snapshot.paramMap.get('name') || '');
    readonly panel = new PagePanel();
    readonly phone = signal(false);
    readonly drawn = signal(false);
    readonly saving = signal(0);
    readonly saveError = signal('');
    readonly typingRich = signal(false);
    readonly spot = signal<{ top: number; left: number } | null>(null);
    readonly box = signal<Box | null>(null);
    readonly badUrl = signal(false);
    /** The rich text being typed in asked for a link: the box takes its address. */
    readonly linkFor = signal(false);
    private linkRange: Range | null = null;

    @ViewChild('frame') frame?: ElementRef<HTMLIFrameElement>;
    @ViewChild('panelBox') panelBox?: ElementRef<HTMLElement>;
    @ViewChild('panelRef') panelRef?: PageTextPanelComponent;

    private inPlace: PageInPlace | null = null;
    private spotEl: HTMLElement | null = null;
    private drawTimer: ReturnType<typeof setTimeout> | null = null;

    readonly pageTitle = computed(() => (this.data.isHome ? this.t('admin.more_pages.home_page') : this.data.fileTitle()));
    readonly status = computed(() => (this.saveError() ? 'not_saved' : this.saving() > 0 ? 'saving' : 'saved'));
    readonly frameUrl = computed<SafeResourceUrl | null>(() => {
        if (!isPlatformBrowser(this.platformId) || this.data.loading() || this.data.loadError()) return null;
        return this.sanitizer.bypassSecurityTrustResourceUrl(pageEditFrameUrl(this.data.name, this.data.lang(), this.data.defaultLang()));
    });
    private readonly views = computed(() => this.data.sections().flatMap((section) => section.areas));

    constructor() {
        // Every save, the screen's own or another editor's, shows on the page (VE-D52).
        effect(() => {
            const views = this.views();
            if (this.drawn()) this.inPlace?.patch(views);
        });
    }

    ngOnInit(): void {
        void this.data.load();
    }

    ngOnDestroy(): void {
        this.inPlace?.detach();
        if (this.drawTimer) clearTimeout(this.drawTimer);
        this.data.close();
        this.panel.destroy();
    }

    // ── The frame ──────────────────────────────────────────────────────────

    private get frameDoc(): Document | null {
        try {
            return this.frame?.nativeElement.contentDocument ?? null;
        } catch {
            return null;
        }
    }

    onFrameLoad(): void {
        const doc = this.frameDoc;
        if (!doc || doc.location.href === 'about:blank') return;
        this.inPlace?.detach();
        this.inPlace = new PageInPlace(doc, this);
        this.inPlace.attach();
        doc.defaultView?.addEventListener('scroll', () => this.place(), { passive: true });
        this.drawn.set(false);
        const started = Date.now();
        const wait = () => {
            // The page is drawn when its marks (or, with none, its body) are there.
            const ready = !!doc.querySelector('[data-arc-edit]') || (doc.body?.innerText.trim().length ?? 0) > 0;
            if (ready || Date.now() - started > DRAW_WAIT_MS) {
                this.drawn.set(true);
                this.inPlace?.patch(this.views());
                if (!this.panel.open()) this.panel.peek(this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
                return;
            }
            this.drawTimer = setTimeout(wait, 200);
        };
        wait();
    }

    /** Where an element of the frame is on this screen. */
    private rectOf(el: HTMLElement): DOMRect {
        const frame = this.frame!.nativeElement.getBoundingClientRect();
        const rect = el.getBoundingClientRect();
        return new DOMRect(frame.left + rect.left, frame.top + rect.top, rect.width, rect.height);
    }

    /** Keeps Done and Cancel, and the box, by their element while the page scrolls. */
    @HostListener('window:resize')
    place(): void {
        if (this.spotEl && this.spot()) {
            const rect = this.rectOf(this.spotEl);
            this.spot.set({ top: Math.max(rect.top - 32, 44), left: rect.right });
        }
        const box = this.box();
        if (box) this.box.set({ ...box, ...this.boxPlace(box.el) });
    }

    private boxPlace(el: HTMLElement): { top: number; left: number } {
        const rect = this.rectOf(el);
        const width = Math.min(340, window.innerWidth - 16);
        const below = rect.bottom + 8;
        const top = below + 260 < window.innerHeight ? below : Math.max(rect.top - 268, 52);
        return { top, left: Math.min(Math.max(rect.left, 8), window.innerWidth - width - 8) };
    }

    // ── PageInPlaceHost ────────────────────────────────────────────────────

    areaFor(key: string): AreaView | null {
        return this.views().find((view) => view.area.key === key) ?? null;
    }

    typing(view: AreaView | null, el: HTMLElement | null): void {
        this.typingRich.set(view?.area.kind === 'rich');
        this.spotEl = el;
        if (el) {
            const rect = this.rectOf(el);
            this.spot.set({ top: Math.max(rect.top - 32, 44), left: rect.right });
        } else {
            this.spot.set(null);
            if (this.linkFor()) this.closeBox();
        }
    }

    open(view: AreaView, el: HTMLElement): void {
        this.badUrl.set(false);
        this.linkFor.set(false);
        this.box.set({ view, el, ...this.boxPlace(el) });
    }

    // ── Saving (VE-D52) ────────────────────────────────────────────────────

    private async run(save: () => Promise<void>): Promise<void> {
        this.saving.update((n) => n + 1);
        try {
            await save();
            this.saveError.set('');
        } catch (error: any) {
            console.error('[PageEdit] Could not save:', error);
            this.saveError.set(error?.message || String(error));
        } finally {
            this.saving.update((n) => n - 1);
        }
    }

    saveWords(view: AreaView, value: string): void {
        const session = this.data.session;
        if (!session) return;
        const lang = this.data.lang();
        const trimmed = value.trim();
        void this.run(() => {
            if (!trimmed) return view.words ? session.useFileText(lang, view.area.key) : Promise.resolve();
            if (trimmed === view.words) return Promise.resolve();
            return session.saveText(lang, view.area.key, trimmed, {
                fileText: view.fileWords,
                ...(lang !== this.data.defaultLang() ? { sourceText: view.defaultWords } : {}),
            });
        });
    }

    addressChanged(view: AreaView, value: string): void {
        const url = value.trim();
        if (this.linkFor()) {
            this.applyLink(url);
            return;
        }
        if (url && !safePageTextUrl(url)) {
            this.badUrl.set(true);
            return;
        }
        this.badUrl.set(false);
        const session = this.data.session;
        if (!session || url === view.url) return;
        void this.run(() => (url ? session.saveUrl(view.area.key, url, { fileText: view.fileUrl }) : session.useFileUrl(view.area.key)));
    }

    useFileUrl(view: AreaView): void {
        const session = this.data.session;
        if (session) void this.run(() => session.useFileUrl(view.area.key));
        this.closeBox();
    }

    async choosePicture(view: AreaView): Promise<void> {
        const result = await firstValueFrom(
            this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({ isDialogOpen: true, title: this.areaName(view) })).afterClosed(),
        ) as { mediaUrl?: string; type?: string } | null;
        const session = this.data.session;
        if (session && result?.type === 'submit' && result.mediaUrl) {
            await this.run(() => session.saveUrl(view.area.key, result.mediaUrl!, { fileText: view.fileUrl }));
        }
    }

    closeBox(): void {
        this.box.set(null);
        this.badUrl.set(false);
        this.linkFor.set(false);
    }

    // ── Typing in place: Done, Cancel, formatting (VE-D37) ─────────────────

    doneSpot(): void {
        this.inPlace?.done();
    }

    cancelSpot(): void {
        this.inPlace?.cancel();
    }

    /** Working in the panel ends typing on the page, saving it. */
    leaveSpot(): void {
        this.inPlace?.done();
        this.closeBox();
    }

    format(command: 'bold' | 'italic'): void {
        this.frameDoc?.execCommand(command);
    }

    /** Link in rich text: the box asks for the address, for the words selected. */
    openLinkBox(): void {
        const doc = this.frameDoc;
        const selection = doc?.getSelection();
        this.linkRange = selection && selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
        const view = this.inPlace?.typing;
        if (!view || !this.spotEl) return;
        this.box.set({ view, el: this.spotEl, ...this.boxPlace(this.spotEl) });
        this.linkFor.set(true);
    }

    private applyLink(url: string): void {
        const safe = safePageTextUrl(url);
        if (!safe) {
            this.badUrl.set(true);
            return;
        }
        const doc = this.frameDoc;
        if (doc && this.linkRange) {
            const selection = doc.getSelection();
            selection?.removeAllRanges();
            selection?.addRange(this.linkRange);
            doc.execCommand('createLink', false, safe);
        }
        this.box.set(null);
        this.linkFor.set(false);
        this.badUrl.set(false);
    }

    // ── The strip ──────────────────────────────────────────────────────────

    switchLanguage(code: string): void {
        if (code === this.data.lang()) return;
        this.leaveSpot();
        this.drawn.set(false);
        this.data.lang.set(code);
    }

    /** The classic editor of the same page: the same draft, the typing saved first. */
    toClassic(): void {
        this.leaveSpot();
        void this.router.navigate(this.data.isHome ? ['/admin/more-pages/home'] : ['/admin/more-pages/p', this.data.name]);
    }

    close(): void {
        this.leaveSpot();
        void this.router.navigate(['/admin/more-pages']);
    }

    /** Waits for what is still saving, after the words being typed are saved. */
    readonly beforePublish = async (): Promise<boolean> => {
        this.leaveSpot();
        while (this.saving() > 0) await new Promise((resolve) => setTimeout(resolve, 50));
        return !this.saveError();
    };

    publish(): void {
        this.panel.setOpen(true);
        void this.panelRef?.publish();
    }

    onHandleDown(event: PointerEvent): void {
        if (event.button !== 0) return;
        event.preventDefault();
        (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
        this.panel.press(event.clientX, this.panelBox?.nativeElement.offsetWidth ?? 0);
    }

    areaName(view: AreaView): string {
        return view.area.label || view.area.key.replace(/[-_]+/g, ' ').replace(/^./, (c) => c.toUpperCase());
    }
}
