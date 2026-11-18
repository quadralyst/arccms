/**
 * The edit-on-page screen, /admin/edit/:type/:id (specs/visual-editing-spec.md,
 * VE-D14 and VE-D26).
 *
 * The page is drawn as on the site in a same-origin frame that loads the live
 * preview route in edit mode (`?edit=1`), so the site's CSS stays inside the
 * frame. On top is a one-line strip: the draft's status, Full width / Phone,
 * Form (the form editor for the same entry, saving first), Page settings,
 * Publish and Close. Nothing of the admin is around it.
 *
 * The Page settings panel is the form editor itself in page mode: its side
 * panel, whole, with the same fields, wording and checks, on the same
 * EntryDraftSession (VE-D15). That editor owns the draft; this screen sends the
 * draft to the frame through the session's preview channel, so a change in the
 * panel shows on the page at once. The panel slides over the page from the
 * right, peeks when the page is drawn, and has a handle on the page's edge.
 */
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
    AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, PLATFORM_ID, ViewChild,
    computed, inject, signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { Editor } from '@tiptap/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CreateContentComponent, PageModeHooks } from '../contents/create-content/create-content.component';
import { previewSessionKey } from '../../../core/preview/preview-channel';
import { HasUnsavedChanges } from '../../../guards/unsaved-changes.guard';
import { PagePanel } from './page-panel';
import { HintKind, InPlaceEditing, InPlaceHost, RichAt, RichHandle, Spot, spotInfo } from './in-place';
import { editorExtensions } from '../../../../shared/components/tiptap-editor/editor-extensions';
import { ArcEmptyLines } from './empty-lines';
import { isTranslatableField, TRANSLATABLE_BUILTIN_FIELDS } from '../contents/draft-content-store/content-translation.model';
import { placeImage, removeImage, selectImage, selectedImage, setImageAlt } from '../../../../shared/components/tiptap-editor/service/image-actions';
import { UrlAddDialog } from '../../../../shared/components/tiptap-editor/service/url-add-dialog/add-url.component';
import MediaManagerComponent, { MediaSelection } from '../(media)/media.page';
import { mediaPickerDialogConfig } from '../(media)/media-picker-dialog';
import { ContentType } from '../contents/content-types/content-types.model';
import { ContentTypesStore } from '../contents/content-types/content-types.store';
import { Injector } from '@angular/core';

/** How often the strip reads the draft's state. */
const STATUS_EVERY_MS = 300;
/** How long the screen waits for the frame to draw the page before giving up on the peek. */
const DRAW_WAIT_MS = 20_000;

export type EditStatus = 'saved' | 'saving' | 'unsaved' | 'not_saved' | 'publishing' | 'published';

/** The hover text for each kind of value not edited in place (VE-D17). */
const HINT_KEYS: Record<HintKind, string> = {
    author: 'admin.edit_page.hint_author',
    date: 'admin.edit_page.hint_date',
    reading: 'admin.edit_page.hint_reading',
    locked: 'admin.edit_page.hint_locked',
    header: 'admin.edit_page.hint_header',
    footer: 'admin.edit_page.hint_footer',
    site: 'admin.edit_page.hint_site',
    shared: 'admin.edit_page.hint_shared',
};

/** A label inside a sentence ("Add cover image"): its first letter small, unless it starts an acronym (URL, FAQ). */
export function inSentence(label: string): string {
    return /^\p{Lu}\p{Ll}/u.test(label) ? label[0].toLowerCase() + label.slice(1) : label;
}

/** The frame's address: the preview route in edit mode, on the session's channel. */
export function editFrameUrl(type: string, id: string): string {
    const key = previewSessionKey(type, id);
    return `/admin/preview/${encodeURIComponent(type)}/${encodeURIComponent(id)}?edit=1#s=${encodeURIComponent(key)}`;
}

@Component({
    selector: 'arc-entry-edit-page',
    standalone: true,
    imports: [CreateContentComponent, TranslocoPipe],
    template: `
    <div class="arc-ed-strip" role="region" [attr.aria-label]="'admin.edit_page.strip' | transloco" data-testid="edit-strip">
        @if (!richOn()) {
        <span class="arc-ed-title">{{ 'admin.edit_page.strip' | transloco }}</span>
        }
        <span class="arc-ed-status" [class]="'arc-ed-status arc-ed-' + status()" role="status" data-testid="edit-status">{{ statusKey() | transloco }}</span>
        @if (richOn()) {
        <span class="arc-ed-group arc-ed-format" role="toolbar" [attr.aria-label]="'admin.edit_page.formatting' | transloco" data-testid="edit-format">
            @for (b of formatButtons; track b.id) {
            <button type="button" class="arc-ed-btn arc-ed-fmt" [class.arc-ed-on]="formatActive(b.id)" [attr.aria-pressed]="formatActive(b.id)"
                [title]="buttonLabel(b) | transloco" [attr.aria-label]="buttonLabel(b) | transloco"
                (mousedown)="$event.preventDefault()" (click)="format(b.id)" [attr.data-format]="b.id">{{ b.text }}</button>
            }
        </span>
        }
        <span class="arc-ed-spacer"></span>
        @if (langs().length > 1) {
        <!-- The language edited on the page (VE3.8): a translation, as the form's language tabs. -->
        <span class="arc-ed-group" role="group" [attr.aria-label]="'admin.edit_page.language' | transloco" data-testid="edit-languages">
            @for (l of langs(); track l.code) {
            <button type="button" class="arc-ed-btn" [class.arc-ed-on]="lang() === l.code" [attr.aria-pressed]="lang() === l.code"
                [title]="l.label" (click)="switchLanguage(l.code)" [attr.data-lang]="l.code">{{ l.code.toUpperCase() }}</button>
            }
        </span>
        }
        <span class="arc-ed-group" role="group" [attr.aria-label]="'admin.preview.width' | transloco">
            <button type="button" class="arc-ed-btn" [class.arc-ed-on]="!phone()" [attr.aria-pressed]="!phone()" (click)="phone.set(false)">{{ 'admin.preview.full_width' | transloco }}</button>
            <button type="button" class="arc-ed-btn" [class.arc-ed-on]="phone()" [attr.aria-pressed]="phone()" (click)="phone.set(true)" data-testid="edit-phone">{{ 'admin.preview.phone' | transloco }}</button>
        </span>
        <button type="button" class="arc-ed-btn" (click)="toForm()" [disabled]="busy()" [title]="'admin.edit_page.form_title' | transloco" data-testid="edit-form">{{ 'admin.edit_page.form' | transloco }}</button>
        <button type="button" class="arc-ed-btn" (click)="panel.toggle()" [class.arc-ed-on]="panel.open()"
            [attr.aria-expanded]="panel.open()" aria-controls="arc-ed-panel" data-testid="edit-settings">{{ 'admin.edit_page.page_settings' | transloco }}</button>
        <button type="button" class="arc-ed-btn arc-ed-primary" (click)="publish()" [disabled]="busy()" data-testid="edit-publish">{{ 'admin.contents.editor.publish' | transloco }}</button>
        <button type="button" class="arc-ed-btn" (click)="close()" [title]="'common.actions.close' | transloco" data-testid="edit-close">{{ 'common.actions.close' | transloco }}</button>
    </div>
    <div class="arc-ed-stage">
        @if (frameUrl) {
        <iframe #frame class="arc-ed-frame" [class.arc-ed-phone]="phone()" [src]="frameUrl"
            [title]="'admin.edit_page.frame' | transloco" (load)="onFrameLoad()" data-testid="edit-frame"></iframe>
        }
        @if (!drawn()) {
        <p class="arc-ed-loading" role="status">{{ 'admin.edit_page.loading' | transloco }}</p>
        }
        <aside id="arc-ed-panel" class="arc-ed-panel" #panelBox
            [class.arc-ed-dragging]="panel.dragging()"
            [style.transform]="panel.transform()"
            [attr.aria-label]="'admin.edit_page.page_settings' | transloco" data-testid="edit-panel">
            <button type="button" class="arc-ed-handle" data-testid="edit-handle"
                [style.margin-right.px]="panel.shown() ? 0 : scrollbar()"
                [attr.aria-expanded]="panel.open()" aria-controls="arc-ed-panel"
                [attr.aria-label]="'admin.edit_page.page_settings' | transloco" [title]="'admin.edit_page.page_settings' | transloco"
                (pointerdown)="onHandleDown($event)" (pointermove)="panel.move($event.clientX)"
                (pointerup)="panel.release()" (pointercancel)="panel.cancel()"
                (keydown.enter)="$event.preventDefault(); panel.toggle()" (keydown.space)="$event.preventDefault(); panel.toggle()">
                <span aria-hidden="true">{{ panel.open() ? '\u203a' : '\u2039' }}</span>
            </button>
            <div class="arc-ed-panel-body" [attr.inert]="panel.shown() ? null : ''">
                <arc-create-content [contentTypeSlug]="type" [contentId]="id" [pageMode]="true" [pageHooks]="hooks" />
            </div>
        </aside>
    </div>
    <div class="arc-ed-pop" role="dialog" [hidden]="!pop()" [attr.aria-label]="pop()?.title || null"
        [style.top.px]="pop()?.top" [style.left.px]="pop()?.left" data-testid="edit-popover" (keydown.escape)="closePopover(); $event.stopPropagation()">
        <div class="arc-ed-pop-head">
            <!-- A field's own control brings its label; an image's box names it here. -->
            <span class="arc-ed-pop-title">{{ pop()?.image ? pop()?.title : '' }}</span>
            <button type="button" class="arc-ed-pop-done" (click)="closePopover()" data-testid="edit-popover-done">{{ 'admin.edit_page.done' | transloco }}</button>
        </div>
        @if (pop()?.image) {
        <div class="arc-ed-pop-actions">
            <button type="button" class="btn btn-outline-primary btn-sm" (click)="replaceImage()" data-testid="edit-image-replace">{{ 'admin.edit_page.replace' | transloco }}</button>
            <button type="button" class="btn btn-outline-danger btn-sm" (click)="removeImage()" data-testid="edit-image-remove">{{ 'common.actions.remove' | transloco }}</button>
        </div>
        }
        <div class="arc-ed-pop-body" #popBody></div>
    </div>
    <!-- A picture selected in the body: the same actions as the form editor's selection menu (VE-D16). -->
    <div class="arc-ed-pop arc-ed-pic" role="dialog" [hidden]="!pic()" [attr.aria-label]="'admin.edit_page.picture' | transloco"
        [style.top.px]="pic()?.top" [style.left.px]="pic()?.left" data-testid="edit-picture"
        (keydown.escape)="closePicture(); $event.stopPropagation()">
        <div class="arc-ed-pop-head">
            <span class="arc-ed-pop-title">{{ 'admin.edit_page.picture' | transloco }}</span>
            <button type="button" class="arc-ed-pop-done" (click)="closePicture()" data-testid="edit-picture-done">{{ 'admin.edit_page.done' | transloco }}</button>
        </div>
        <label class="arc-ed-pic-alt">
            <span>{{ 'admin.edit_page.alt' | transloco }}</span>
            <input type="text" class="form-control form-control-sm" [value]="pic()?.alt ?? ''" [attr.placeholder]="'admin.edit_page.alt_placeholder' | transloco"
                (change)="pictureAlt($any($event.target).value)" (keydown.enter)="pictureAlt($any($event.target).value)" data-testid="edit-picture-alt">
        </label>
        <div class="arc-ed-pop-actions">
            <button type="button" class="btn btn-outline-primary btn-sm" (click)="pictureReplace()" data-testid="edit-picture-replace">{{ 'admin.edit_page.replace' | transloco }}</button>
            <button type="button" class="btn btn-outline-danger btn-sm" (click)="pictureRemove()" data-testid="edit-picture-remove">{{ 'common.actions.remove' | transloco }}</button>
        </div>
    </div>
    `,
    styles: [`
        :host { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: #e5e7eb; }
        .arc-ed-strip {
            flex: 0 0 auto; display: flex; align-items: center; gap: 8px; flex-wrap: nowrap;
            padding: 6px 12px; background: #1f2937; color: #f9fafb;
            font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
            box-shadow: 0 1px 4px rgba(0, 0, 0, .25); position: relative; z-index: 3;
            overflow-x: auto; scrollbar-width: none;
        }
        .arc-ed-title { font-weight: 600; white-space: nowrap; }
        .arc-ed-status { padding: 1px 8px; border-radius: 999px; background: #4b5563; white-space: nowrap; }
        .arc-ed-status.arc-ed-saved, .arc-ed-status.arc-ed-published { background: #15803d; }
        .arc-ed-status.arc-ed-publishing { background: #a16207; }
        .arc-ed-status.arc-ed-not_saved { background: #b91c1c; }
        .arc-ed-spacer { flex: 1 1 auto; }
        .arc-ed-group { display: inline-flex; gap: 2px; }
        .arc-ed-btn {
            font: inherit; color: #f9fafb; background: transparent; cursor: pointer; white-space: nowrap;
            border: 1px solid #4b5563; border-radius: 6px; padding: 3px 10px; margin: 0; line-height: 1.4;
        }
        .arc-ed-btn:hover:not(:disabled):not(.arc-ed-on):not(.arc-ed-primary) { background: #374151; }
        .arc-ed-btn.arc-ed-primary:hover:not(:disabled) { filter: brightness(1.1); }
        .arc-ed-btn:disabled { opacity: .55; cursor: default; }
        .arc-ed-btn.arc-ed-on { background: #f9fafb; color: #1f2937; border-color: #f9fafb; }
        .arc-ed-btn.arc-ed-primary { background: var(--arc-admin-accent); border-color: var(--arc-admin-accent); }
        .arc-ed-btn:focus-visible { outline: 2px solid #f9fafb; outline-offset: 1px; }
        .arc-ed-handle:focus-visible { outline: 2px solid var(--arc-admin-accent); outline-offset: 1px; }
        .arc-ed-stage { position: relative; flex: 1 1 auto; min-height: 0; overflow: hidden; }
        .arc-ed-frame { display: block; width: 100%; height: 100%; border: 0; background: #fff; }
        .arc-ed-frame.arc-ed-phone { width: 390px; margin: 0 auto; box-shadow: 0 0 0 1px #d1d5db, 0 8px 24px rgba(0, 0, 0, .12); }
        .arc-ed-loading {
            position: absolute; inset: 0; margin: 0; display: flex; align-items: center; justify-content: center;
            background: #fff; color: #6b7280; font: 15px/1.5 system-ui, sans-serif; pointer-events: none;
        }
        .arc-ed-panel {
            position: absolute; top: 0; right: 0; bottom: 0; z-index: 2;
            display: flex; background: #fff; box-shadow: -4px 0 16px rgba(0, 0, 0, .15);
            transition: transform .25s ease;
        }
        .arc-ed-panel.arc-ed-dragging { transition: none; }
        .arc-ed-panel-body { display: flex; flex-direction: column; height: 100%; min-width: 0; overflow: hidden; }
        .arc-ed-handle {
            position: absolute; right: 100%; top: 50%; width: 24px; height: 48px; margin-top: -24px; padding: 0;
            display: flex; align-items: center; justify-content: center; cursor: grab; touch-action: none;
            border: 1px solid #d1d5db; border-right: 0; border-radius: 8px 0 0 8px; color: #374151;
            background-color: #fff;
            background-image: radial-gradient(circle, #cbd5e1 1px, transparent 1.2px);
            background-size: 4px 5px; background-position: center;
            box-shadow: -2px 2px 6px rgba(0, 0, 0, .15);
            font: 700 18px/1 system-ui, sans-serif;
        }
        .arc-ed-handle > span { background: #fff; border-radius: 4px; padding: 0 1px; }
        .arc-ed-dragging .arc-ed-handle { cursor: grabbing; }
        .arc-ed-fmt { padding: 3px 7px; min-width: 28px; font-weight: 600; }
        .arc-ed-pop {
            position: fixed; z-index: 1000; width: 320px; max-width: calc(100vw - 16px); max-height: 60vh; overflow: auto;
            background: #fff; color: #1f2937; border: 1px solid #d1d5db; border-radius: 8px;
            box-shadow: 0 8px 24px rgba(0, 0, 0, .18); padding: 10px 12px;
        }
        .arc-ed-pop-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; font: 600 13px/1.4 system-ui, sans-serif; }
        .arc-ed-pop-body ::ng-deep [id^="req-"] { margin-bottom: 0 !important; }
        .arc-ed-pop-title { flex: 1 1 auto; }
        .arc-ed-pop-done { font: 500 13px/1.4 system-ui, sans-serif; border: 1px solid #d1d5db; border-radius: 6px; background: #fff; padding: 2px 10px; cursor: pointer; }
        .arc-ed-pop-actions { display: flex; gap: 8px; }
        .arc-ed-pop-body:empty { display: none; }
        .arc-ed-pic { width: 340px; }
        .arc-ed-pic-alt { display: flex; flex-direction: column; gap: 2px; margin: 4px 0 8px; font: 500 12px/1.4 system-ui, sans-serif; color: #374151; }
        @media (prefers-reduced-motion: reduce) { .arc-ed-panel { transition: none; } }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export default class EntryEditPage implements AfterViewInit, HasUnsavedChanges {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private document = inject(DOCUMENT);
    private platformId = inject(PLATFORM_ID);
    private destroyRef = inject(DestroyRef);
    private sanitizer = inject(DomSanitizer);
    private dialog = inject(MatDialog);
    private transloco = inject(TranslocoService);
    private injector = inject(Injector);
    private typesStore = inject(ContentTypesStore);

    readonly type = this.route.snapshot.paramMap.get('type') || '';
    readonly id = this.route.snapshot.paramMap.get('id') || '';
    /** Only in the browser: the server draws no frame. */
    readonly frameUrl: SafeResourceUrl | null = isPlatformBrowser(this.platformId) && this.type && this.id
        ? this.sanitizer.bypassSecurityTrustResourceUrl(editFrameUrl(this.type, this.id))
        : null;

    readonly panel = new PagePanel();
    readonly phone = signal(false);
    readonly status = signal<EditStatus>('saved');
    readonly busy = signal(false);
    /** The page is drawn in the frame with the draft in place. */
    readonly drawn = signal(false);
    /** The frame's scrollbar width, which the closed panel's handle sits inside of. */
    readonly scrollbar = signal(0);

    readonly statusKey = computed(() => ({
        saved: 'admin.edit_page.saved',
        saving: 'admin.edit_page.saving',
        unsaved: 'admin.edit_page.unsaved',
        not_saved: 'admin.edit_page.not_saved',
        publishing: 'admin.edit_page.publishing',
        published: 'admin.edit_page.published',
    } as const)[this.status()]);

    @ViewChild(CreateContentComponent) editor?: CreateContentComponent;
    @ViewChild('frame') frame?: ElementRef<HTMLIFrameElement>;
    @ViewChild('panelBox') panelBox?: ElementRef<HTMLElement>;
    @ViewChild('popBody') popBody?: ElementRef<HTMLElement>;

    // ── Editing in place (VE-D16) ────────────────────────────────────────────
    /** Editing in place on the page in the frame, once it is drawn. */
    inPlace: InPlaceEditing | null = null;
    /** The rich text editor on the page, while a rich spot is edited. */
    private richEditor: Editor | null = null;
    readonly richOn = signal(false);
    /** Bumped on each change in the rich editor, so the buttons show what the selection has. */
    private readonly formatTick = signal(0);
    /** The box on a spot: a field's own control, or an image's Replace and Remove. */
    /** The site's languages when it has several, and the one being edited (VE3.8). */
    readonly langs = signal<{ code: string; label: string }[]>([]);
    readonly lang = signal('');

    /** The picture selected in the body, and where its box goes (VE-D16). */
    readonly pic = signal<{ pos: number; alt: string; top: number; left: number } | null>(null);
    readonly pop = signal<{ title: string; top: number; left: number; image: boolean; spot: Spot } | null>(null);
    /** Where a control moved into the box came from, to put it back. */
    private popReturn: { node: HTMLElement; marker: Comment } | null = null;

    readonly formatButtons = [
        { id: 'bold', text: 'B', label: 'admin.edit_page.bold' },
        { id: 'italic', text: 'I', label: 'admin.edit_page.italic' },
        { id: 'h2', text: 'H2', label: 'admin.edit_page.heading' },
        { id: 'h3', text: 'H3', label: 'admin.edit_page.subheading' },
        { id: 'bullets', text: '\u2022', label: 'admin.edit_page.bullets' },
        { id: 'numbers', text: '1.', label: 'admin.edit_page.numbers' },
        { id: 'quote', text: '\u201c', label: 'admin.edit_page.quote' },
        { id: 'link', text: '\u{1F517}', label: 'admin.edit_page.link' },
        { id: 'image', text: '\u{1F5BC}', label: 'admin.edit_page.image' },
        { id: 'undo', text: '\u21b6', label: 'admin.edit_page.undo' },
        { id: 'redo', text: '\u21b7', label: 'admin.edit_page.redo' },
    ] as const;

    /** What the form editor in page mode asks of the page (VE-D26). */
    readonly hooks: PageModeHooks = {
        reveal: (key) => this.revealOnPage(key),
        openPanel: () => this.panel.setOpen(true),
    };

    /** An alert in the panel (a change elsewhere, a failed save or publish) was showing. */
    private alerting = false;
    private frameCleanup: (() => void) | null = null;

    ngAfterViewInit(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        // Every type, as the entries list loads them: the panel shows this one's fields
        // and the page's spots are worked out from them. Nothing else on this screen,
        // outside the admin shell, loads them.
        if (!this.typesStore.items().some((t: ContentType) => t.slug === this.type)) this.typesStore.getAll();
        const timer = setInterval(() => this.readStatus(), STATUS_EVERY_MS);
        const onKey = (event: KeyboardEvent) => this.onKey(event);
        this.document.addEventListener('keydown', onKey);
        this.destroyRef.onDestroy(() => {
            clearInterval(timer);
            this.document.removeEventListener('keydown', onKey);
            this.frameCleanup?.();
            this.closePopover();
            this.inPlace?.detach();
            this.panel.destroy();
        });
    }

    /** The guard's question before leaving with work not stored yet. */
    hasUnsavedChanges(): boolean {
        return this.editor?.hasUnsavedChanges() ?? false;
    }

    /** The strip's status, as the form editor says it, and the panel opened for an alert. */
    readStatus(): void {
        const session = this.editor?.session;
        if (!session) return;
        const langs = session.showLanguageBar() ? session.enabledLanguages().map((l) => ({ code: l.code, label: l.label })) : [];
        if (langs.map((l) => l.code).join() !== this.langs().map((l) => l.code).join()) this.langs.set(langs);
        if (session.activeLang() !== this.lang()) this.lang.set(session.activeLang());
        const failed = session.saveFailed() || session.entryChanged() || session.entryGone();
        const saving = session.isSavingDraft || session.isAutoSaving || session.creating();
        const unsaved = session.hasUnsavedChanges();
        // A publish shows on the strip until the page is live, and then until the next change.
        const deploy = session.deployStatus();
        this.status.set(saving ? 'saving' : failed ? 'not_saved' : deploy === 'pending' ? 'publishing'
            : unsaved ? 'unsaved' : deploy === 'deployed' ? 'published' : 'saved');
        this.busy.set(session.isSavingDraft || session.creating());
        // A line the editor must act on is in the panel: it opens on it.
        const alerting = failed || !!session.publishProblem();
        if (alerting && !this.alerting) this.panel.setOpen(true);
        this.alerting = alerting;
    }

    /** Escape closes the panel; a dialog open over the screen keeps its own Escape. */
    onKey(event: KeyboardEvent): void {
        if (event.key !== 'Escape' || event.defaultPrevented) return;
        if (this.document.querySelector('.cdk-overlay-container .mat-mdc-dialog-container')) return;
        if (this.pop()) {
            this.closePopover();
            event.preventDefault();
            return;
        }
        if (this.pic()) {
            this.closePicture();
            event.preventDefault();
            return;
        }
        if (this.panel.escape()) event.preventDefault();
    }

    onHandleDown(event: PointerEvent): void {
        if (event.button !== 0) return;
        event.preventDefault();
        (event.currentTarget as HTMLElement | null)?.setPointerCapture?.(event.pointerId);
        this.panel.press(event.clientX, this.panelBox?.nativeElement.offsetWidth ?? 0);
    }

    /** Keeps the panel's width current for dragging and the closed position. */
    @HostListener('window:resize')
    measurePanel(): void {
        const width = this.panelBox?.nativeElement.offsetWidth;
        if (width) this.panel.width.set(width);
    }

    // ── The frame ────────────────────────────────────────────────────────────
    /** The frame's document, once it has loaded. */
    frameDocument(): Document | null {
        try {
            return this.frame?.nativeElement.contentDocument ?? null;
        } catch {
            return null;
        }
    }

    onFrameLoad(): void {
        const doc = this.frameDocument();
        const win = doc?.defaultView;
        if (!doc || !win) return;
        this.frameCleanup?.();
        const onTouch = (event: Event) => {
            this.panel.touch();
            // A click on the page puts a box away; the click may open the next one.
            if (this.pop() && !(event.target as Element | null)?.closest?.('[data-arc-edit-kind]')) this.closePopover();
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') this.onKey(event);
            else this.panel.touch();
        };
        doc.addEventListener('pointerdown', onTouch, true);
        doc.addEventListener('keydown', onKey);
        this.frameCleanup = () => {
            doc.removeEventListener('pointerdown', onTouch, true);
            doc.removeEventListener('keydown', onKey);
            this.inPlace?.detach();
            this.inPlace = null;
        };
        this.waitForDraw(doc, win);
    }

    /** Once the page is drawn with the draft in place: the loading line goes and the panel peeks. */
    private waitForDraw(doc: Document, win: Window): void {
        const started = Date.now();
        const check = () => {
            if (this.frameDocument() !== doc) return;
            if (doc.querySelector('[data-arc-field]')) {
                this.drawn.set(true);
                this.measurePanel();
                this.scrollbar.set(Math.max(0, win.innerWidth - doc.documentElement.clientWidth));
                const reduced = !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                this.panel.peek(reduced);
                this.pageDrawn(doc);
                return;
            }
            if (Date.now() - started < DRAW_WAIT_MS) setTimeout(check, 150);
            else this.drawn.set(true);
        };
        check();
    }

    /** The page is drawn in the frame: the place for editing in place to start. */
    protected pageDrawn(doc: Document): void {
        this.inPlace?.detach();
        this.inPlace = new InPlaceEditing(doc, this.inPlaceHost);
        this.inPlace.attach();
    }

    /**
     * A field the form editor asks for (a required one left empty): its spot on the
     * page is scrolled to and opened when it is typed in, else outlined. False when
     * the page does not show it.
     */
    revealOnPage(key: string): boolean {
        const doc = this.frameDocument();
        if (!doc) return false;
        const type = this.contentType();
        const el = Array.from(doc.querySelectorAll<HTMLElement>('[data-arc-field]'))
            .find((node) => spotInfo(node, type)?.field === key)
            ?? doc.querySelector<HTMLElement>(`[data-arc-field="${cssEscape(key)}"]`);
        if (!el) return false;
        el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        const kind = spotInfo(el, type)?.kind;
        if (this.inPlace && (kind === 'text' || kind === 'rich')) {
            this.inPlace.open(el);
            return true;
        }
        el.setAttribute('data-arc-pv-highlight', '');
        setTimeout(() => el.removeAttribute('data-arc-pv-highlight'), 2000);
        return true;
    }

    /** The entry's type, as the form editor has it. */
    contentType(): ContentType | null {
        return (this.editor?.currentContentType() as ContentType | null) ?? null;
    }

    /** How a spot reads and writes the draft: through the form editor, as its own controls do. */
    readonly inPlaceHost: InPlaceHost = {
        type: () => this.contentType(),
        value: (field) => this.fieldValue(field),
        setText: (field, value) => this.setText(field, value),
        setRich: (field, html) => this.setRich(field, html),
        hold: (on) => this.editor?.session.holdPreview(on),
        mountRich: (el, html, onChange) => this.mountRich(el, html, onChange),
        image: (spot) => this.openImage(spot),
        popover: (spot) => this.openPopover(spot),
        panel: (spot) => this.openInPanel(spot),
        placeholder: (field, label) => this.transloco.translate('admin.edit_page.add', { label: inSentence(label ?? this.fieldTitle(field)) }),
        hint: (kind) => this.transloco.translate(HINT_KEYS[kind], { language: this.defaultLanguageLabel() }),
        shared: (field, builtin) => this.sharedField(field, builtin),
        escape: () => {
            if (!this.pic()) return false;
            this.closePicture();
            return true;
        },
        activeChanged: (_spot, rich) => {
            this.closePopover();
            this.richOn.set(!!rich);
            if (!rich) this.richEditor = null;
        },
    };

    fieldValue(field: string): unknown {
        const editor = this.editor;
        if (!editor) return '';
        switch (field) {
            case 'title': return editor.pageTitle ?? '';
            case 'summary': return editor.publishForm?.get('summary')?.value ?? '';
            case 'content': return editor.publishForm?.get('content')?.value ?? '';
            case 'coverImage': return editor.coverImage ?? '';
            default: return editor.customFieldValues?.[field] ?? '';
        }
    }

    /** Typed in place: the same steps as the form editor's own box for the field. */
    setText(field: string, value: string): void {
        const editor = this.editor;
        if (!editor || this.fieldValue(field) === value) return;
        if (field === 'title') {
            editor.pageTitle = value;
            editor.createSlag();
            editor.triggerAutoSave();
        } else if (field === 'summary') {
            editor.publishForm?.get('summary')?.setValue(value);
            editor.triggerAutoSave();
        } else {
            editor.onCustomFieldChange(field, value);
        }
    }

    setRich(field: string, html: string): void {
        const editor = this.editor;
        if (!editor) return;
        if (field === 'content') {
            editor.passEditorContentToParent(html);
            editor.triggerAutoSave();
        } else {
            editor.onCustomFieldChange(field, html);
        }
    }

    /** The rich text editor on the element: the same extensions as the form editor's (spike fix 3). */
    mountRich(el: HTMLElement, html: string, onChange: (html: string) => void): RichHandle {
        let editor: Editor | null = null;
        editor = new Editor({
            element: el,
            content: html,
            autofocus: false,
            enablePasteRules: false,
            extensions: [
                ...editorExtensions({
                    injector: this.injector,
                    translate: (key) => this.transloco.translate(key),
                    openOnClick: false,
                    pickers: { uploadImage: () => editor && this.insertImage(editor), attachFile: () => editor && this.attachFiles(editor) },
                }),
                ArcEmptyLines,
            ],
            editorProps: { attributes: { class: 'arc-in-place-rich', spellcheck: 'true' } },
        });
        // What the buttons show comes from the editor's own events, not straight after a click (spike fix 4).
        editor.on('update', ({ editor: e }) => onChange(e.getHTML()));
        editor.on('transaction', () => {
            this.formatTick.update((n) => n + 1);
            if (editor) this.syncPicture(editor);
        });
        // The box stays beside its picture as the page scrolls.
        const frameWin = el.ownerDocument.defaultView;
        const onScroll = () => editor && this.syncPicture(editor);
        frameWin?.addEventListener('scroll', onScroll, { passive: true });
        this.richEditor = editor;
        return {
            focus: (at) => {
                if (!editor) return;
                // A picture clicked: selected, so its box opens at once.
                if (at?.image && selectImage(editor, at.image.src, at.image.nth) !== null) {
                    editor.view.focus();
                    return;
                }
                const pos = at ? (textPos(editor, at.text) ?? editor.view.posAtCoords({ left: at.x, top: at.y })?.pos ?? null) : null;
                if (pos === null) {
                    editor.chain().focus('start', { scrollIntoView: false }).run();
                    return;
                }
                editor.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(pos).run();
                // The editor drew the spot a little taller or shorter: the clicked line goes back under the pointer.
                try {
                    const caret = editor.view.coordsAtPos(pos);
                    const drift = (caret.top + caret.bottom) / 2 - at!.y;
                    // Instant: a site with smooth scrolling would slide the page away from the click.
                    if (Math.abs(drift) > 2) el.ownerDocument.defaultView?.scrollBy({ top: drift, behavior: 'instant' });
                } catch {
                    // No layout (a hidden frame): the caret is placed all the same.
                }
            },
            destroy: () => {
                frameWin?.removeEventListener('scroll', onScroll);
                this.pic.set(null);
                editor?.destroy();
                if (this.richEditor === editor) this.richEditor = null;
                editor = null;
            },
        };
    }

    formatActive(id: string): boolean {
        this.formatTick();
        const e = this.richEditor;
        if (!e) return false;
        switch (id) {
            case 'bold': return e.isActive('bold');
            case 'italic': return e.isActive('italic');
            case 'h2': return e.isActive('heading', { level: 2 });
            case 'h3': return e.isActive('heading', { level: 3 });
            case 'bullets': return e.isActive('bulletList');
            case 'numbers': return e.isActive('orderedList');
            case 'quote': return e.isActive('blockquote');
            case 'link': return e.isActive('link');
            default: return false;
        }
    }

    /** A formatting button: it keeps the focus in the page (mousedown is stopped) and acts on its selection. */
    format(id: string): void {
        const e = this.richEditor;
        if (!e) return;
        const chain = e.chain().focus();
        switch (id) {
            case 'bold': chain.toggleBold().run(); break;
            case 'italic': chain.toggleItalic().run(); break;
            case 'h2': chain.toggleHeading({ level: 2 }).run(); break;
            case 'h3': chain.toggleHeading({ level: 3 }).run(); break;
            case 'bullets': chain.toggleBulletList().run(); break;
            case 'numbers': chain.toggleOrderedList().run(); break;
            case 'quote': chain.toggleBlockquote().run(); break;
            case 'undo': chain.undo().run(); break;
            case 'redo': chain.redo().run(); break;
            case 'image': this.insertImage(e); break;
            case 'link': this.addLink(e); break;
        }
    }

    private insertImage(editor: Editor): void {
        const ref = this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({ isDialogOpen: true, title: this.pickerTitle('admin.media.picker.image_in') }));
        ref.afterClosed().subscribe((result: MediaSelection | null) => {
            // With a picture selected, the choice takes its place (Replace), as in the form editor.
            if (result?.type === 'submit' && result.mediaUrl && !editor.isDestroyed) placeImage(editor, result.mediaUrl, result.alt);
        });
    }

    private attachFiles(editor: Editor): void {
        const ref = this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({
            isDialogOpen: true, allowFiles: true, allowImages: false, initialTab: 'files', multiple: true,
            title: this.pickerTitle('admin.media.picker.files_in'),
        }));
        ref.afterClosed().subscribe((result: MediaSelection | null) => {
            if (result?.type !== 'submit' || result.kind !== 'file' || editor.isDestroyed) return;
            let chain = editor.chain().focus();
            for (const file of result.files ?? (result.file ? [result.file] : [])) chain = chain.insertFileCard(file);
            chain.run();
        });
    }

    /** A picker's heading naming the field being edited ("Image in Body"), as the editor's own pickers do. */
    private pickerTitle(key: 'admin.media.picker.image_in' | 'admin.media.picker.files_in'): string {
        const field = this.inPlace?.current()?.field || 'content';
        return this.transloco.translate(key, { field: this.fieldTitle(field) });
    }

    /** Edits another language on the page: what is being typed in is kept first, as the form's tabs do. */
    async switchLanguage(code: string): Promise<void> {
        if (!this.editor || code === this.lang()) return;
        this.inPlace?.leave();
        this.closePopover();
        this.closePicture();
        await this.editor.switchLanguage(code);
        this.readStatus();
        // The spots shared by every language change with it.
        this.inPlace?.mark();
    }

    /** While a translation is on screen, a field every language shares: the form locks it, and so does the page. */
    sharedField(field: string, builtin: boolean): boolean {
        const session = this.editor?.session;
        if (!session?.isTranslating()) return false;
        if (builtin) return !(TRANSLATABLE_BUILTIN_FIELDS as readonly string[]).includes(field);
        const def = this.editor?.currentFields.find((f) => f.key === field);
        return def ? !isTranslatableField(def) : false;
    }

    private defaultLanguageLabel(): string {
        const session = this.editor?.session;
        if (!session) return '';
        const code = session.defaultLang();
        return session.enabledLanguages().find((l) => l.code === code)?.label ?? code;
    }

    /** A strip button's name: the image button replaces a selected picture. */
    buttonLabel(b: { id: string; label: string }): string {
        return b.id === 'image' && this.pic() ? 'admin.edit_page.replace_image' : b.label;
    }

    /** Places the picture's box below it, or over its top when below is off the screen; hides it with no picture selected. */
    private syncPicture(editor: Editor): void {
        const image = editor.isDestroyed ? null : selectedImage(editor);
        const dom = image ? (editor.view.nodeDOM(image.pos) as HTMLElement | null) : null;
        const box = dom?.getBoundingClientRect?.();
        if (!image || !box) {
            if (this.pic()) this.pic.set(null);
            return;
        }
        const frame = this.frame?.nativeElement.getBoundingClientRect();
        const win = this.document.defaultView;
        const width = 340;
        const maxTop = (win?.innerHeight ?? 768) - 170;
        const below = (frame?.top ?? 0) + box.bottom + 8;
        const top = below <= maxTop ? below : Math.max(48, (frame?.top ?? 0) + Math.max(box.top, 0) + 8);
        const left = Math.max(8, Math.min((frame?.left ?? 0) + box.left, (win?.innerWidth ?? 1024) - width - 8));
        const now = this.pic();
        if (now && now.pos === image.pos && now.alt === image.alt && now.top === top && now.left === left) return;
        this.pic.set({ pos: image.pos, alt: image.alt, top, left });
    }

    /** Replace: the media picker; its choice takes the selected picture's place. */
    pictureReplace(): void {
        if (this.richEditor && this.pic()) this.insertImage(this.richEditor);
    }

    pictureRemove(): void {
        const e = this.richEditor;
        const pic = this.pic();
        if (!e || !pic) return;
        removeImage(e, pic.pos);
        e.view.focus();
    }

    pictureAlt(alt: string): void {
        const e = this.richEditor;
        const pic = this.pic();
        if (e && pic) setImageAlt(e, pic.pos, alt);
    }

    /** Done or Escape: the cursor goes just past the picture, so its box closes and typing carries on. */
    closePicture(): void {
        const e = this.richEditor;
        const pic = this.pic();
        this.pic.set(null);
        if (!e || !pic || e.isDestroyed) return;
        e.chain().focus(undefined, { scrollIntoView: false }).setTextSelection(Math.min(pic.pos + 1, e.state.doc.content.size)).run();
    }

    private addLink(editor: Editor): void {
        const ref = this.dialog.open(UrlAddDialog, { width: '70vh', data: { msg: 'common.add_url.link_text', placeholder: 'common.add_url.link' }, disableClose: true });
        ref.afterClosed().subscribe((url: string | null) => {
            if (!url || editor.isDestroyed) return;
            editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
        });
    }

    // ── Images, boxes and the panel ──────────────────────────────────────────
    /** An image spot: the picker at once when it is empty, else Replace and Remove on it. */
    openImage(spot: Spot): void {
        if (!this.fieldValue(spot.field)) {
            this.pickImage(spot.field);
            return;
        }
        this.showPopover(spot, true);
    }

    replaceImage(): void {
        const spot = this.pop()?.spot;
        this.closePopover();
        if (spot) this.pickImage(spot.field);
    }

    removeImage(): void {
        const spot = this.pop()?.spot;
        this.closePopover();
        if (!spot || !this.editor) return;
        if (spot.field === 'coverImage') this.editor.removeCoverImage();
        else this.editor.removeCustomFieldImage(spot.field);
    }

    private pickImage(field: string): void {
        const editor = this.editor;
        if (!editor) return;
        if (field === 'coverImage') editor.openMediaManager();
        else editor.openMediaManagerForField(field, this.fieldTitle(field));
    }

    /** A field edited in a box on the element: the form editor's own control for it, moved there. */
    openPopover(spot: Spot): void {
        const node = this.panelControl(spot.field);
        if (!node) {
            this.openInPanel(spot);
            return;
        }
        this.showPopover(spot, false);
        const body = this.popBody?.nativeElement;
        if (!body) return;
        const marker = this.document.createComment('arc-in-place');
        node.parentNode?.insertBefore(marker, node);
        body.appendChild(node);
        this.popReturn = { node, marker };
        setTimeout(() => node.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea, button')?.focus());
    }

    /** The custom field's box in the panel (`#req-{key}`), on the Basic tab. */
    private panelControl(field: string): HTMLElement | null {
        const editor = this.editor;
        if (!editor || !editor.currentFields.some((f) => f.key === field)) return null;
        if (editor.activeTab !== 'basic') {
            editor.activeTab = 'basic';
            editor.cdr.detectChanges();
        }
        return this.document.getElementById(`req-${field}`);
    }

    private showPopover(spot: Spot, image: boolean): void {
        this.closePopover();
        const frame = this.frame?.nativeElement.getBoundingClientRect();
        const box = spot.el.getBoundingClientRect();
        const win = this.document.defaultView;
        const width = 320;
        const top = (frame?.top ?? 0) + box.bottom + 6;
        const left = (frame?.left ?? 0) + box.left;
        const maxLeft = (win?.innerWidth ?? 1024) - width - 8;
        const maxTop = (win?.innerHeight ?? 768) - 160;
        this.pop.set({
            title: spot.label ?? this.fieldTitle(spot.field),
            top: Math.max(48, Math.min(top, maxTop)),
            left: Math.max(8, Math.min(left, maxLeft)),
            image,
            spot,
        });
    }

    /** Puts the box away and its control back in the panel. */
    closePopover(): void {
        const back = this.popReturn;
        this.popReturn = null;
        if (back) {
            if (back.marker.parentNode) back.marker.parentNode.insertBefore(back.node, back.marker);
            back.marker.remove();
        }
        if (this.pop()) this.pop.set(null);
    }

    /** A field not edited on the page: the panel opens on it. */
    openInPanel(spot: Spot): void {
        this.panel.setOpen(true);
        setTimeout(() => this.editor?.focusField(spot.field, spot.row ?? undefined), 260);
    }

    /** A field's name in the admin language. */
    fieldTitle(field: string): string {
        const def = this.editor?.currentFields.find((f) => f.key === field);
        if (def) return this.editor!.fieldLabel(def);
        const key = `admin.preview.fields.${field}`;
        const text = this.transloco.translate(key);
        return text === key ? field : text;
    }

    // ── The strip's buttons ──────────────────────────────────────────────────
    /** The form editor for the same entry, saving first; it stays here when the save did not land. */
    async toForm(): Promise<void> {
        if (!(await this.saveFirst())) return;
        void this.router.navigate(['/admin/contents', this.type, 'edit', this.id]);
    }

    publish(): void {
        void this.editor?.directPublishContent();
    }

    /** Back to the type's entries; the leave question asks when something is not stored. */
    close(): void {
        void this.router.navigate(['/admin/contents', this.type]);
    }

    /** Saves when there is anything to save; true when nothing is left unsaved. */
    private async saveFirst(): Promise<boolean> {
        const editor = this.editor;
        if (!editor) return true;
        if (editor.hasUnsavedChanges()) await editor.saveAsDraft();
        this.readStatus();
        if (editor.hasUnsavedChanges()) {
            this.panel.setOpen(true);
            return false;
        }
        return true;
    }
}

function cssEscape(value: string): string {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

/**
 * The editor position of the text an editor clicked on the page (RichAt.text): the
 * nth editor text piece with the same text, at the same offset. Null when the
 * editor has no such piece, and the point is used instead.
 */
export function textPos(editor: Editor, text: RichAt['text']): number | null {
    if (!text) return null;
    let seen = 0;
    let found: number | null = null;
    editor.state.doc.descendants((node, pos) => {
        if (found !== null) return false;
        if (node.isText && node.text === text.data) {
            if (seen === text.nth) found = pos + Math.min(text.offset, text.data.length);
            seen++;
        }
        return true;
    });
    return found;
}
