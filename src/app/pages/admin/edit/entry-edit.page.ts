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
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoPipe } from '@jsverse/transloco';
import { CreateContentComponent, PageModeHooks } from '../contents/create-content/create-content.component';
import { previewSessionKey } from '../../../core/preview/preview-channel';
import { HasUnsavedChanges } from '../../../guards/unsaved-changes.guard';
import { PagePanel } from './page-panel';

/** How often the strip reads the draft's state. */
const STATUS_EVERY_MS = 300;
/** How long the screen waits for the frame to draw the page before giving up on the peek. */
const DRAW_WAIT_MS = 20_000;

export type EditStatus = 'saved' | 'saving' | 'unsaved' | 'not_saved';

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
        <span class="arc-ed-title">{{ 'admin.edit_page.strip' | transloco }}</span>
        <span class="arc-ed-status" [class]="'arc-ed-status arc-ed-' + status()" role="status" data-testid="edit-status">{{ statusKey() | transloco }}</span>
        <span class="arc-ed-spacer"></span>
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
            [style.transform]="'translateX(calc(100% - ' + panel.shown() + 'px))'"
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
    `,
    styles: [`
        :host { display: flex; flex-direction: column; height: 100vh; overflow: hidden; background: #e5e7eb; }
        .arc-ed-strip {
            flex: 0 0 auto; display: flex; align-items: center; gap: 8px; flex-wrap: nowrap;
            padding: 6px 12px; background: #1f2937; color: #f9fafb;
            font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
            box-shadow: 0 1px 4px rgba(0, 0, 0, .25); position: relative; z-index: 3;
        }
        .arc-ed-title { font-weight: 600; white-space: nowrap; }
        .arc-ed-status { padding: 1px 8px; border-radius: 999px; background: #4b5563; white-space: nowrap; }
        .arc-ed-status.arc-ed-saved { background: #15803d; }
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
        .arc-ed-btn.arc-ed-primary { background: var(--arc-admin-accent, #2563eb); border-color: var(--arc-admin-accent, #2563eb); }
        .arc-ed-btn:focus-visible, .arc-ed-handle:focus-visible { outline: 2px solid #93c5fd; outline-offset: 1px; }
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
    } as const)[this.status()]);

    @ViewChild(CreateContentComponent) editor?: CreateContentComponent;
    @ViewChild('frame') frame?: ElementRef<HTMLIFrameElement>;
    @ViewChild('panelBox') panelBox?: ElementRef<HTMLElement>;

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
        const timer = setInterval(() => this.readStatus(), STATUS_EVERY_MS);
        const onKey = (event: KeyboardEvent) => this.onKey(event);
        this.document.addEventListener('keydown', onKey);
        this.destroyRef.onDestroy(() => {
            clearInterval(timer);
            this.document.removeEventListener('keydown', onKey);
            this.frameCleanup?.();
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
        const failed = session.saveFailed() || session.entryChanged() || session.entryGone();
        const saving = session.isSavingDraft || session.isAutoSaving || session.creating();
        this.status.set(saving ? 'saving' : failed ? 'not_saved' : session.hasUnsavedChanges() ? 'unsaved' : 'saved');
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
        const onTouch = () => this.panel.touch();
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') this.onKey(event);
            else this.panel.touch();
        };
        doc.addEventListener('pointerdown', onTouch, true);
        doc.addEventListener('keydown', onKey);
        this.frameCleanup = () => {
            doc.removeEventListener('pointerdown', onTouch, true);
            doc.removeEventListener('keydown', onKey);
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
    protected pageDrawn(_doc: Document): void {
        // Editing in place (VE3.6) starts here.
    }

    /** A field the page shows is scrolled to and outlined; false when the page does not show it. */
    revealOnPage(key: string): boolean {
        const doc = this.frameDocument();
        const el = doc?.querySelector<HTMLElement>(`[data-arc-field="${cssEscape(key)}"]`);
        if (!el) return false;
        el.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        el.setAttribute('data-arc-pv-highlight', '');
        setTimeout(() => el.removeAttribute('data-arc-pv-highlight'), 2000);
        return true;
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
