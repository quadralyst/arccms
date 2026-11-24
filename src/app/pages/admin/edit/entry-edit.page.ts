/**
 * The edit-on-page screen, /admin/edit/:type/:id (specs/visual-editing-spec.md,
 * VE-D14 and VE-D26).
 *
 * The page is drawn as on the site in a same-origin frame that loads the live
 * preview route in edit mode (`?edit=1`), so the site's CSS stays inside the
 * frame. On top is a one-line strip: the draft's status, Full width / Phone (icons),
 * Classic editor (the form editor for the same entry, saving first), Page settings,
 * Publish and Close. Nothing of the admin is around it.
 *
 * The Page settings panel is the form editor itself in page mode: its side
 * panel, whole, with the same fields, wording and checks, on the same
 * EntryDraftSession (VE-D15). That editor owns the draft; this screen sends the
 * draft to the frame through the session's preview channel, so a change in the
 * panel shows on the page at once. The panel slides over the page from the
 * right, peeks when the page is drawn, and has a handle on the page's edge.
 */
import { DOCUMENT, isPlatformBrowser, Location } from '@angular/common';
import {
    AfterViewInit, ChangeDetectionStrategy, Component, DestroyRef, ElementRef, HostListener, PLATFORM_ID, ViewChild,
    computed, inject, signal,
} from '@angular/core';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { MatDialog } from '@angular/material/dialog';
import { Editor } from '@tiptap/core';
import { TextSelection } from 'prosemirror-state';
import { ActivatedRoute, NavigationCancel, Router } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { CreateContentComponent, PageModeHooks } from '../contents/create-content/create-content.component';
import { previewSessionKey } from '../../../core/preview/preview-channel';
import { HasUnsavedChanges } from '../../../guards/unsaved-changes.guard';
import type { EditState } from './edit-state';
import { EditStateComponent } from './page-status.component';
import { HoldBarComponent } from '../hold/hold-bar.component';
import { viewOnlyPage } from '../hold/review.service';
import type { EditingHold } from '../../../core/editing/hold';
import { PagePanel } from './page-panel';
import { HintKind, InPlaceEditing, InPlaceHost, RichAt, RichContext, RichHandle, Spot, SpotInfo, isRowPart, spotInfo } from './in-place';
import { insertRowsAfter, moveRow, removeRow, restoreRow, rowsAcross, setRowLocation, setRowMedia, setRowValue } from './rows';
import { MapPickerComponent, PickedLocation } from '../../../../shared/components/map-picker/map-picker.component';
import { repeaterFieldOf } from '../../../core/preview/row-fields';
import {
    isRepeaterRowEmpty, mediaRowKeys, newRepeaterRow, RepeaterLocationSubField, RepeaterMediaSubField, RepeaterRow, RepeaterSchema, repeaterSchema,
} from '../../../../shared/models/repeater.model';
import { isYouTubeUrl } from '../../../../shared/utils/youtube';
import { editorExtensions } from '../../../../shared/components/tiptap-editor/editor-extensions';
import { ArcEmptyLines } from './empty-lines';
import { boxAt, coversWords, firstClear } from './placement';
import { EditableReveal, readShowEditable, writeShowEditable } from './editable-reveal';
import { inSentence } from '../../../core/utils/in-sentence';
import { isTranslatableField, TRANSLATABLE_BUILTIN_FIELDS } from '../contents/draft-content-store/content-translation.model';
import { placeImage, removeImage, selectImage, selectedImage, setImageAlt } from '../../../../shared/components/tiptap-editor/service/image-actions';
import { UrlAddDialog } from '../../../../shared/components/tiptap-editor/service/url-add-dialog/add-url.component';
import { FieldPlaces, fieldSummary, isPlaceable } from '../../../../shared/components/tiptap-editor/service/field-place';
import { SelectionMenuComponent } from '../../../../shared/components/tiptap-editor/selection-menu/selection-menu.component';
import MediaManagerComponent, { MediaSelection } from '../(media)/media.page';
import { mediaPickerDialogConfig } from '../(media)/media-picker-dialog';
import { ContentType, ContentTypeField } from '../contents/content-types/content-types.model';
import { ContentTypesStore } from '../contents/content-types/content-types.store';
import { Injector } from '@angular/core';

/** How often the strip reads the draft's state. */
const STATUS_EVERY_MS = 300;
/** How long the screen waits for the frame to draw the page before giving up on the peek. */
const DRAW_WAIT_MS = 20_000;


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

/** A label inside a sentence ("Add cover image"), shared with the form editor's placeholders. */
export { inSentence };

/**
 * The frame's channel key: the entry's key plus a part of its own, so only this screen
 * draws in its frame, never another tab editing the same entry (review H2).
 */
export function editFrameKey(type: string, id: string, random: () => string = frameRandom): string {
    return `${previewSessionKey(type, id === 'new' ? '' : id)}.edit.${random()}`;
}

function frameRandom(): string {
    const bytes = new Uint8Array(6);
    globalThis.crypto?.getRandomValues?.(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('') || String(Date.now());
}

/** The frame's address: the preview route in edit mode, on the screen's own channel (`new` before the first save). */
export function editFrameUrl(type: string, id: string, key: string): string {
    return `/admin/preview/${encodeURIComponent(type)}/${encodeURIComponent(id || 'new')}?edit=1#s=${encodeURIComponent(key)}`;
}

@Component({
    selector: 'arc-entry-edit-page',
    standalone: true,
    imports: [CreateContentComponent, EditStateComponent, HoldBarComponent, TranslocoPipe, SelectionMenuComponent, MapPickerComponent],
    template: `
    <div class="arc-ed-strip" role="region" [attr.aria-label]="'admin.edit_page.strip' | transloco" data-testid="edit-strip">
        @if (!richOn()) {
        <span class="arc-ed-title arc-ed-name" [title]="entryTitle()">{{ entryTitle() || ('admin.edit_page.strip' | transloco) }}</span>
        }
        @if (stateKnown()) {
        <arc-edit-state [state]="status()" [dark]="true" data-testid="edit-status" />
        }
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
        <!-- What can be changed, outlined until turned off (remembered for this person). -->
        <button type="button" class="arc-ed-btn" [class.arc-ed-on]="showEditable()" [attr.aria-pressed]="showEditable()" (click)="toggleShowEditable()"
            [title]="'admin.edit_page.show_editable' | transloco" [attr.aria-label]="'admin.edit_page.show_editable' | transloco" data-testid="edit-show-editable"><i class="bi bi-bounding-box" aria-hidden="true"></i></button>
        <span class="arc-ed-group" role="group" [attr.aria-label]="'admin.preview.width' | transloco">
            <button type="button" class="arc-ed-btn" [class.arc-ed-on]="!phone()" [attr.aria-pressed]="!phone()" (click)="phone.set(false)"
                [title]="'admin.preview.full_width' | transloco" [attr.aria-label]="'admin.preview.full_width' | transloco" data-testid="edit-desktop"><i class="bi bi-display" aria-hidden="true"></i></button>
            <button type="button" class="arc-ed-btn" [class.arc-ed-on]="phone()" [attr.aria-pressed]="phone()" (click)="phone.set(true)" data-testid="edit-phone"
                [title]="'admin.preview.phone' | transloco" [attr.aria-label]="'admin.preview.phone' | transloco"><i class="bi bi-phone" aria-hidden="true"></i></button>
        </span>
        <!-- The live preview window, as the classic editor opens it: the same draft, updating as you type. -->
        <button type="button" class="arc-ed-btn" (click)="openPreview()" [title]="'admin.contents.editor.preview_title' | transloco" data-testid="edit-preview">
            <i class="fa-regular fa-eye" aria-hidden="true"></i> {{ 'admin.contents.editor.preview' | transloco }}</button>
        <button type="button" class="arc-ed-btn" (click)="toForm()" [disabled]="busy()" [title]="'admin.edit_page.form_title' | transloco" data-testid="edit-form">{{ 'admin.edit_page.form' | transloco }}</button>
        <button type="button" class="arc-ed-btn" (click)="panel.toggle()" [class.arc-ed-on]="panel.open()"
            [attr.aria-expanded]="panel.open()" aria-controls="arc-ed-panel" data-testid="edit-settings">{{ 'admin.edit_page.page_settings' | transloco }}</button>
        <button type="button" class="arc-ed-btn arc-ed-primary" (click)="publish()" [disabled]="!!heldBy() || busy() || nothingToPublish()" data-testid="edit-publish">{{ 'admin.contents.editor.publish' | transloco }}</button>
        <button type="button" class="arc-ed-btn" (click)="close()" [title]="'common.actions.close' | transloco" data-testid="edit-close">{{ 'common.actions.close' | transloco }}</button>
    </div>
    @if (heldBy(); as hold) {
    <arc-hold-bar [hold]="hold" [lost]="lostWords()" (review)="review()" (showTheirs)="editor?.session?.reloadTheirs()" />
    }
    <div class="arc-ed-stage">
        @if (frameUrl) {
        <iframe #frame class="arc-ed-frame" [class.arc-ed-phone]="phone()" [src]="frameUrl"
            [title]="'admin.edit_page.frame' | transloco" (load)="onFrameLoad()" (transitionend)="widthChanged()" data-testid="edit-frame"></iframe>
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
            <div class="arc-ed-panel-body" [attr.inert]="panel.shown() ? null : ''" (focusin)="panelInUse()" (pointerdown)="panelInUse()">
                <arc-create-content [contentTypeSlug]="type" [contentId]="entryId" [pageMode]="true" [pageHooks]="hooks" />
            </div>
        </aside>
    </div>
    <div class="arc-ed-pop" role="dialog" [hidden]="!pop()" [class.arc-ed-pop-map]="!!pop()?.location" [style.max-height.px]="pop()?.maxHeight ?? null" [attr.aria-label]="pop()?.title || null"
        [style.top.px]="pop()?.top" [style.left.px]="pop()?.left" data-testid="edit-popover" (keydown.escape)="donePopover(); $event.stopPropagation()">
        <div class="arc-ed-pop-head">
            <!-- A field's own control brings its label; an image's box names it here. -->
            <span class="arc-ed-pop-title">{{ pop()?.image || pop()?.location ? pop()?.title : '' }}</span>
            <button type="button" class="arc-ed-pop-done" (click)="donePopover()" data-testid="edit-popover-done">{{ 'admin.edit_page.done' | transloco }}</button>
        </div>
        @if (pop()?.image) {
        <div class="arc-ed-pop-actions">
            <button type="button" class="btn btn-outline-primary btn-sm" (click)="replaceImage()" data-testid="edit-image-replace">{{ 'admin.edit_page.replace' | transloco }}</button>
            <button type="button" class="btn btn-outline-danger btn-sm" (click)="removeImage()" data-testid="edit-image-remove">{{ 'admin.edit_page.remove_picture' | transloco }}</button>
        </div>
        @if (pop()?.video !== undefined) {
        <!-- A gallery item: a YouTube video instead of a photo (VE-D31). -->
        <label class="arc-ed-pic-alt arc-ed-video">
            <span>{{ 'admin.edit_page.use_video' | transloco }}</span>
            <input type="url" class="form-control form-control-sm" [class.is-invalid]="videoError()" [value]="pop()?.video ?? ''"
                [attr.placeholder]="'admin.contents.editor.repeater.video_url' | transloco"
                (change)="setRowVideo($any($event.target).value)" (keydown.enter)="setRowVideo($any($event.target).value)" data-testid="edit-row-video">
            @if (videoError()) {
            <small class="arc-ed-error">{{ 'admin.contents.editor.repeater.video_invalid' | transloco }}</small>
            }
        </label>
        }
        }
        @if (pop()?.location; as loc) {
        <!-- A map row: the form's own map picker, search and drag (VE-D34). -->
        <arc-map-picker [address]="loc.address" [lat]="loc.lat" [lng]="loc.lng" [zoom]="loc.zoom"
            (picked)="rowLocationPicked($event)" (cleared)="rowLocationCleared()" data-testid="edit-row-map" />
        }
        <div class="arc-ed-pop-body" #popBody></div>
    </div>
    @if (bar(); as b) {
    <!-- A row of a repeating field: add after, move, remove (VE-D32); in a translation, where rows are arranged (VE-D35). -->
    <div class="arc-ed-bar" role="toolbar" [attr.aria-label]="b.label" [style.top.px]="b.top" [style.left.px]="b.left"
        (pointerenter)="barHovered(true)" (pointerleave)="barHovered(false)" data-testid="edit-row-bar">
        @if (b.locked) {
        <span class="arc-ed-bar-note">{{ 'admin.edit_page.rows_locked' | transloco: { language: defaultLanguageLabel() } }}</span>
        } @else {
        <button type="button" class="arc-ed-bar-btn" (click)="rowAddAfter()" [title]="'admin.edit_page.row_add_after' | transloco"
            [attr.aria-label]="'admin.edit_page.row_add_after' | transloco" data-testid="edit-row-add"><i class="bi bi-plus-lg" aria-hidden="true"></i></button>
        <button type="button" class="arc-ed-bar-btn" (click)="rowMove(-1)" [disabled]="b.first" [title]="(b.across ? 'admin.edit_page.row_move_left' : 'admin.edit_page.row_move_up') | transloco"
            [attr.aria-label]="(b.across ? 'admin.edit_page.row_move_left' : 'admin.edit_page.row_move_up') | transloco" data-testid="edit-row-before">
            <i class="bi" [class.bi-arrow-left]="b.across" [class.bi-arrow-up]="!b.across" aria-hidden="true"></i></button>
        <button type="button" class="arc-ed-bar-btn" (click)="rowMove(1)" [disabled]="b.last" [title]="(b.across ? 'admin.edit_page.row_move_right' : 'admin.edit_page.row_move_down') | transloco"
            [attr.aria-label]="(b.across ? 'admin.edit_page.row_move_right' : 'admin.edit_page.row_move_down') | transloco" data-testid="edit-row-after">
            <i class="bi" [class.bi-arrow-right]="b.across" [class.bi-arrow-down]="!b.across" aria-hidden="true"></i></button>
        <button type="button" class="arc-ed-bar-btn" (click)="rowRemove()" [title]="'admin.edit_page.row_remove' | transloco: { row: rowWord(b.label) }"
            [attr.aria-label]="'admin.edit_page.row_remove' | transloco: { row: rowWord(b.label) }" data-testid="edit-row-remove"><i class="bi bi-trash" aria-hidden="true"></i></button>
        }
    </div>
    }
    @if (spotActions(); as at) {
    <!-- The value being typed in: Done keeps it (as clicking elsewhere does), Cancel puts back what was there (VE-D37). -->
    <div class="arc-ed-spot" role="group" [attr.aria-label]="'admin.edit_page.editing' | transloco" [style.top.px]="at.top" [style.left.px]="at.left"
        (mousedown)="$event.preventDefault()" data-testid="edit-spot-actions">
        <button type="button" class="arc-ed-spot-done" (click)="spotDone()" [title]="'admin.edit_page.done_title' | transloco" data-testid="edit-spot-done">
            <i class="bi bi-check-lg" aria-hidden="true"></i> {{ 'admin.edit_page.done' | transloco }}</button>
        <button type="button" (click)="spotCancel()" [title]="'admin.edit_page.cancel_title' | transloco" data-testid="edit-spot-cancel">
            <i class="bi bi-arrow-counterclockwise" aria-hidden="true"></i> {{ 'common.actions.cancel' | transloco }}</button>
    </div>
    }
    @if (undo(); as u) {
    <!-- A row just removed: Undo for a few seconds instead of a question first (VE-D32). -->
    <div class="arc-ed-undo" role="status" data-testid="edit-row-undo">
        <span>{{ u.text }}</span>
        <button type="button" (click)="undoRemove()" data-testid="edit-row-undo-btn">{{ 'admin.edit_page.undo' | transloco }}</button>
    </div>
    }
    @if (sel(); as at) {
    <!-- Text selected in the body: the form editor's selection menu, beside it (VE-D27). -->
    <div class="arc-ed-sel" [class.arc-ed-sel-below]="at.below" [style.top.px]="at.top" [style.left.px]="at.left"
        (mousedown)="keepSelection($event)" data-testid="edit-selection-menu">
        <arc-selection-menu [editor]="at.editor" />
    </div>
    }
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
            <button type="button" class="btn btn-outline-danger btn-sm" (click)="pictureRemove()" data-testid="edit-picture-remove">{{ 'admin.edit_page.remove_picture' | transloco }}</button>
        </div>
    </div>
    `,
    styleUrls: ['./edit-screen.css'],
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
    /** The entry the form editor loads: '' for `new`, an entry started on the page (review H3). */
    readonly entryId = this.id === 'new' ? '' : this.id;
    /** The frame's own channel (review H2). */
    private readonly frameKey = editFrameKey(this.type, this.id);
    /** Only in the browser: the server draws no frame. */
    readonly frameUrl: SafeResourceUrl | null = isPlatformBrowser(this.platformId) && this.type && this.id
        ? this.sanitizer.bypassSecurityTrustResourceUrl(editFrameUrl(this.type, this.entryId, this.frameKey))
        : null;
    private location = inject(Location);

    readonly panel = new PagePanel();
    readonly phone = signal(false);
    /** The top bar's switch: every part that can be changed outlined, as this person left it. */
    readonly showEditable = signal(readShowEditable());
    /** The outlines that show what can be changed, on the frame's page. */
    reveal: EditableReveal | null = null;
    /** The outlines move once when the screen opens, not again when the frame is drawn again. */
    private revealedOnce = false;
    /** When a click on the page last put a box away: that click does not also explain the page. */
    private boxClosedAt = 0;
    readonly status = signal<EditState>('saving');
    /** The entry's title, which the strip names. */
    readonly entryTitle = signal('');
    readonly nothingToPublish = signal(false);
    /** The stored entry was read (a new one has none): until then nothing is said about it. */
    readonly stateKnown = signal(false);
    /** Someone else holds the entry: the page is looked at, not changed (VE-D79). */
    readonly heldBy = signal<EditingHold | null>(null);
    readonly lostWords = signal(false);
    /** Ends the page's being only looked at. */
    private endViewOnly: (() => void) | null = null;
    readonly busy = signal(false);
    /** The page is drawn in the frame with the draft in place. */
    readonly drawn = signal(false);
    /** The frame's scrollbar width, which the closed panel's handle sits inside of. */
    readonly scrollbar = signal(0);

    @ViewChild(CreateContentComponent) editor?: CreateContentComponent;
    @ViewChild('frame') frame?: ElementRef<HTMLIFrameElement>;
    @ViewChild('panelBox') panelBox?: ElementRef<HTMLElement>;
    @ViewChild('popBody') popBody?: ElementRef<HTMLElement>;

    // ── Editing in place (VE-D16) ────────────────────────────────────────────
    /** Editing in place on the page in the frame, once it is drawn. */
    inPlace: InPlaceEditing | null = null;
    /** The screen has closed: a late timer does nothing. */
    private destroyed = false;
    /** The rich text editor on the page, while a rich spot is edited. */
    private richEditor: Editor | null = null;
    readonly richOn = signal(false);
    /** Bumped on each change in the rich editor, so the buttons show what the selection has. */
    private readonly formatTick = signal(0);
    /** The box on a spot: a field's own control, or an image's Replace and Remove. */
    /** The site's languages when it has several, and the one being edited (VE3.8). */
    readonly langs = signal<{ code: string; label: string }[]>([]);
    readonly lang = signal('');

    /** Text selected in the body: the editor, and where the selection menu goes (VE-D27). */
    readonly sel = signal<{ editor: Editor; top: number; left: number; below: boolean } | null>(null);
    /** The picture selected in the body, and where its box goes (VE-D16). */
    readonly pic = signal<{ pos: number; alt: string; top: number; left: number } | null>(null);
    readonly pop = signal<{
        title: string; top: number; left: number; image: boolean; spot: Spot; video?: string;
        /** A map row's place, for the map picker (VE-D34). */
        location?: { address: string; lat: number | null; lng: number | null; zoom: number | null };
        /** The map box's height, so it never runs past the window's bottom. */
        maxHeight?: number;
    } | null>(null);
    /** The pasted link in a gallery item's box is not a YouTube link. */
    readonly videoError = signal(false);
    /** Done and Cancel beside the value being typed in (VE-D37), and where they go. */
    readonly spotActions = signal<{ top: number; left: number } | null>(null);
    /** The row added last, still to be typed in: Cancel takes it away again while it is blank. */
    private justAdded: { field: string; id: string } | null = null;
    /** The row bar (VE-D32): the row it is for and where it goes. */
    readonly bar = signal<RowBar | null>(null);
    /** A row just removed, for Undo (VE-D32). */
    readonly undo = signal<{ text: string; field: string; row: RepeaterRow; index: number } | null>(null);
    private undoTimer: ReturnType<typeof setTimeout> | null = null;
    private barHideTimer: ReturnType<typeof setTimeout> | null = null;
    private onBar = false;
    /** Just after a move the bar stays with the row it moved, not the one now under the pointer. */
    private barPinnedUntil = 0;
    /** Where a control moved into the box came from, to put it back. */
    /** The control moved into the box, where it goes back, and the panel's tab before the box opened. */
    private popReturn: { node: HTMLElement; marker: Comment; tab: CreateContentComponent['activeTab'] | null } | null = null;

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
        stored: (id) => this.showEntryAddress(id),
    };

    /** An entry started on the page is written: the address names it, so a reload opens it (review H3). */
    private showEntryAddress(id: string): void {
        if (!id || this.entryId) return;
        this.location.replaceState(this.entryPath(id), '', typeof history !== 'undefined' ? history.state : undefined);
    }

    private entryPath(id: string): string {
        return `/admin/edit/${encodeURIComponent(this.type)}/${encodeURIComponent(id)}`;
    }

    /** The entry being edited: its id once written, '' before. */
    private currentId(): string {
        return this.editor?.contentId || this.entryId;
    }

    /** An alert in the panel (a change elsewhere, a failed save or publish) was showing. */
    private alerting = false;
    private frameCleanup: (() => void) | null = null;

    ngAfterViewInit(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        // Every type, as the entries list loads them: the panel shows this one's fields
        // and the page's spots are worked out from them. Nothing else on this screen,
        // outside the admin shell, loads them.
        if (!this.typesStore.items().some((t: ContentType) => t.slug === this.type)) this.typesStore.getAll();
        // The frame draws from this screen's own channel, from the first moment (review H2, H3).
        this.editor?.session.connectFrame(this.frameKey);
        // A leave question answered Stay puts the router's address back: an entry written meanwhile keeps its own.
        const cancelled = this.router.events?.subscribe((event) => {
            const id = this.editor?.contentId;
            if (event instanceof NavigationCancel && id && !this.entryId) {
                this.location.replaceState(this.entryPath(id), '', typeof history !== 'undefined' ? history.state : undefined);
            }
        });
        this.destroyRef.onDestroy(() => cancelled?.unsubscribe());
        const timer = setInterval(() => {
            this.readStatus();
            // The page may have been drawn again: the bar follows its row, the buttons their value.
            this.syncBar();
            this.syncSpotActions();
            this.placePopover();
        }, STATUS_EVERY_MS);
        const onKey = (event: KeyboardEvent) => this.onKey(event);
        this.document.addEventListener('keydown', onKey);
        this.destroyRef.onDestroy(() => {
            this.destroyed = true;
            clearInterval(timer);
            if (this.undoTimer) clearTimeout(this.undoTimer);
            if (this.barHideTimer) clearTimeout(this.barHideTimer);
            this.document.removeEventListener('keydown', onKey);
            this.frameCleanup?.();
            this.closePopover();
            this.inPlace?.detach();
            this.reveal?.detach();
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
        this.status.set(session.editState());
        this.nothingToPublish.set(session.nothingToPublish());
        this.stateKnown.set(!this.entryId || session.entryRead());
        this.entryTitle.set(this.editor?.pageTitle ?? '');
        this.readHold();
        this.busy.set(session.isSavingDraft || session.creating());
        // A line the editor must act on is in the panel: it opens on it.
        const alerting = failed || !!session.publishProblem();
        if (alerting && !this.alerting) this.panel.setOpen(true);
        this.alerting = alerting;
    }

    /** Who holds the entry, and the page opened for editing or only for looking, as it changes. */
    private readHold(): void {
        const session = this.editor?.session;
        if (!session) return;
        const was = this.heldBy();
        const hold = session.heldBy();
        this.lostWords.set(session.lostWords());
        if (was === hold) return;
        this.heldBy.set(hold);
        if (!!was === !!hold) return;
        const doc = this.frameDocument();
        if (doc && this.drawn()) this.pageDrawn(doc);
    }

    /** Review changes, on the form's own list. */
    review(): void {
        void this.editor?.reviewChanges();
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
            // A click on the page puts a box away; the click may open the next one. A click on a
            // row's map (which takes no clicks itself) is a spot too.
            const target = event.target as Element | null;
            const onSpot = !!target?.closest?.('[data-arc-edit-kind]')
                || (!!target && !!this.inPlace?.frameSpotAt(target, (event as PointerEvent).clientX, (event as PointerEvent).clientY));
            if (this.pop() && !onSpot) {
                this.closePopover();
                this.boxClosedAt = Date.now();
            }
        };
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') this.onKey(event);
            else this.panel.touch();
        };
        const onScroll = () => {
            this.syncBar();
            this.syncSpotActions();
            this.placePopover();
        };
        // A value growing as it is typed in: its buttons move with its end.
        const onInput = () => this.syncSpotActions();
        doc.addEventListener('input', onInput, true);
        doc.addEventListener('pointerdown', onTouch, true);
        doc.addEventListener('keydown', onKey);
        win.addEventListener('scroll', onScroll, { passive: true });
        this.frameCleanup = () => {
            doc.removeEventListener('pointerdown', onTouch, true);
            doc.removeEventListener('keydown', onKey);
            win.removeEventListener('scroll', onScroll);
            doc.removeEventListener('input', onInput, true);
            this.bar.set(null);
            this.inPlace?.detach();
            this.inPlace = null;
            this.reveal?.detach();
            this.reveal = null;
            this.endViewOnly?.();
            this.endViewOnly = null;
        };
        this.waitForDraw(doc, win);
    }

    /** Once the page is drawn with the draft in place: the loading line goes and the panel peeks. */
    private waitForDraw(doc: Document, win: Window): void {
        const started = Date.now();
        const check = () => {
            if (this.destroyed || this.frameDocument() !== doc) return;
            // A page with no field marks but empty fields' boxes is drawn too.
            if (doc.querySelector('[data-arc-field], [data-arc-empty]')) {
                this.drawn.set(true);
                this.measurePanel();
                this.scrollbar.set(Math.max(0, win.innerWidth - doc.documentElement.clientWidth));
                const reduced = !!win.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
                this.panel.peek(reduced);
                this.pageDrawn(doc);
                return;
            }
            if (Date.now() - started < DRAW_WAIT_MS) setTimeout(check, 150);
            else {
                // A page that marks nothing: the cover goes, and later redraws are still watched.
                this.drawn.set(true);
                this.pageDrawn(doc);
            }
        };
        check();
    }

    /** Full width and Phone finished sliding: what is drawn over the page follows it. */
    widthChanged(): void {
        const doc = this.frameDocument();
        const win = doc?.defaultView;
        if (win && doc) this.scrollbar.set(Math.max(0, win.innerWidth - doc.documentElement.clientWidth));
        this.syncBar();
        this.syncSpotActions();
        this.placePopover();
    }

    /** The page is drawn in the frame: the place for editing in place to start. */
    protected pageDrawn(doc: Document): void {
        this.endViewOnly?.();
        this.endViewOnly = null;
        this.inPlace?.detach();
        this.inPlace = null;
        if (this.heldBy()) {
            this.closePopover();
            this.bar.set(null);
            this.reveal?.detach();
            this.reveal = null;
            this.endViewOnly = viewOnlyPage(doc, () => this.review());
            return;
        }
        this.inPlace = new InPlaceEditing(doc, this.inPlaceHost);
        this.inPlace.attach();
        this.reveal?.detach();
        this.reveal = new EditableReveal(doc, { selector: '[data-arc-edit-kind]' });
        this.reveal.attach();
        this.reveal.setShown(this.showEditable());
        // The page opens showing what can be changed on it, once.
        if (!this.revealedOnce) {
            this.revealedOnce = true;
            this.reveal.flash();
        }
    }

    /** The top bar's switch: every part that can be changed outlined, or not. */
    toggleShowEditable(): void {
        const on = !this.showEditable();
        this.showEditable.set(on);
        writeShowEditable(on);
        this.reveal?.setShown(on);
    }

    /**
     * A click on the page that opens nothing: a note by the click says why (where the
     * value comes from, or that the design fixes it) and the parts that can be changed move.
     */
    private fixedClick(target: Element, x: number, y: number): void {
        if (!this.reveal || Date.now() - this.boxClosedAt < 600 || this.pic()) return;
        const hint = target.closest('[data-arc-hint]')?.getAttribute('data-arc-hint') as HintKind | null;
        this.reveal.explainFixed(target, x, y, {
            lead: hint && HINT_KEYS[hint] ? this.inPlaceHost.hint(hint) : this.transloco.translate('admin.edit_page.fixed_text'),
            outlined: this.transloco.translate('admin.edit_page.fixed_outlined'),
            scroll: this.transloco.translate('admin.edit_page.fixed_scroll'),
        });
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
        const reduced = !!doc.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
        el.scrollIntoView?.({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
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
        mountRich: (el, html, onChange, context) => this.mountRich(el, html, onChange, context),
        image: (spot) => this.openImage(spot),
        popover: (spot) => this.openPopover(spot),
        panel: (spot) => this.openInPanel(spot),
        placeholder: (field, label, info) => this.placeholderFor(field, label, info),
        hint: (kind) => this.transloco.translate(HINT_KEYS[kind], { language: this.defaultLanguageLabel() }),
        fieldName: (info, label) => label ?? this.spotName(info),
        fixedClick: (target, x, y) => this.fixedClick(target, x, y),
        shared: (field, builtin, info) => this.sharedField(field, builtin, info),
        partText: (info) => this.partText(info),
        setPartText: (info, value) => this.setPartText(info, value),
        untranslated: (info) => !!this.editor?.session.isTranslating()
            && !(isRowPart(info) ? this.partText(info) : String(this.fieldValue(info.field) ?? '')),
        rowHover: (row) => this.rowHover(row),
        translating: () => !!this.editor?.session.isTranslating(),
        emptyList: (field) => this.emptyList(field),
        addFirst: (field) => this.rowAdd(field, null),
        escape: () => {
            if (!this.pic()) return false;
            this.closePicture();
            return true;
        },
        activeChanged: (_spot, rich) => {
            this.closePopover();
            this.richOn.set(!!rich);
            if (!rich) this.richEditor = null;
            this.syncSpotActions();
            // A row is "just added" until its first value is left: Cancel, which runs next, still sees it.
            if (this.justAdded && (!_spot || _spot.rowId !== this.justAdded.id)) queueMicrotask(() => {
                if (!this.inPlace?.current() || this.inPlace.current()?.rowId !== this.justAdded?.id) this.justAdded = null;
            });
        },
        cancelled: (spot) => this.spotCancelled(spot),
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
    mountRich(el: HTMLElement, html: string, onChange: (html: string) => void, context?: RichContext): RichHandle {
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
                    // The body places custom fields in its text (VE-D28); other rich fields do not.
                    places: context?.field === 'content' ? this.fieldPlaces(context.drawn) : null,
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
            if (editor) this.syncSelection(editor);
        });
        // The boxes stay beside their picture or text as the page scrolls.
        const frameWin = el.ownerDocument.defaultView;
        const onScroll = () => {
            if (!editor) return;
            this.syncPicture(editor);
            this.syncSelection(editor);
        };
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
                this.sel.set(null);
                editor?.destroy();
                if (this.richEditor === editor) this.richEditor = null;
                editor = null;
            },
        };
    }

    /**
     * The body's custom fields that can be placed in its text (VE-D28), as the form
     * editor offers them: a placed field's card shows the field as the page drew it,
     * and Edit opens it in Page settings.
     */
    private fieldPlaces(drawn: Map<string, Element>): FieldPlaces {
        // The page's drawing of a field holds until the field is changed in Page settings;
        // from then on the card lists what the field holds.
        const valueOf = (key: string) => JSON.stringify(this.editor?.customFieldValues[key] ?? null);
        const drawnAs = new Map([...drawn.keys()].map((key) => [key, valueOf(key)]));
        return {
            fields: () => (this.editor?.currentFields ?? [])
                .filter((f) => !!f.key && isPlaceable(f.type))
                .map((f) => ({ key: f.key, label: this.editor!.fieldLabel(f), type: f.type })),
            open: (key) => this.openField(key),
            drawn: (key) => (drawnAs.get(key) === valueOf(key) ? (drawn.get(key)?.cloneNode(true) as Element | undefined) ?? null : null),
            summary: (key) => {
                const field = this.editor?.currentFields.find((f) => f.key === key);
                return field ? fieldSummary(field.type, this.editor!.customFieldValues[key]) : [];
            },
            translate: (key, params) => this.transloco.translate(key, params),
            changes: (redraw) => {
                const sub = this.editor?.session.edited$.subscribe(redraw);
                return () => sub?.unsubscribe();
            },
        };
    }

    /** Opens Page settings on a field. */
    openField(field: string): void {
        this.panel.setOpen(true);
        setTimeout(() => {
            if (!this.destroyed) this.editor?.focusField(field);
        }, 260);
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
        // Undo puts a row back in the default language: not from another one.
        this.clearUndo();
        await this.editor.switchLanguage(code);
        // The screen closed meanwhile: nothing is left to refresh.
        if (this.destroyed) return;
        this.readStatus();
        // The spots shared by every language change with it.
        this.inPlace?.mark();
    }

    /**
     * While a translation is on screen, a field every language shares: the form locks it, and so
     * does the page. A row's picture and a map's pin are shared, its words are not (VE-D35).
     */
    sharedField(field: string, builtin: boolean, info?: SpotInfo): boolean {
        const session = this.editor?.session;
        if (!session?.isTranslating()) return false;
        const schema = info && (info.heading || info.sub) ? this.repeater(field)?.schema : null;
        if (schema && info?.heading) return schema.heading?.translatable !== true;
        if (schema && info?.sub) {
            const sub = schema.subFields.find((s) => s.key === info.sub);
            // A map row's point is the same in every language; its address is typed (VE-D35).
            if (sub?.type === 'location') return info.kind !== 'text';
            return sub?.translatable !== true;
        }
        if (builtin) return !(TRANSLATABLE_BUILTIN_FIELDS as readonly string[]).includes(field);
        const def = this.editor?.currentFields.find((f) => f.key === field);
        return def ? !isTranslatableField(def) : false;
    }

    defaultLanguageLabel(): string {
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

    /**
     * Shows the selection menu above selected text, or below it when above would go under
     * the strip; hides it when nothing is selected. A selected picture has its own box.
     */
    private syncSelection(editor: Editor): void {
        const selection = editor.isDestroyed ? null : editor.state.selection;
        // Text only: a selected picture has its own box, a placed field its card.
        if (!(selection instanceof TextSelection) || selection.empty) {
            if (this.sel()) this.sel.set(null);
            return;
        }
        const { from, to } = selection;
        let start: { top: number; bottom: number; left: number };
        let end: { bottom: number };
        try {
            start = editor.view.coordsAtPos(from);
            end = editor.view.coordsAtPos(to);
        } catch {
            return; // No layout (a hidden frame).
        }
        const frame = this.frame?.nativeElement.getBoundingClientRect();
        const win = this.document.defaultView;
        const frameTop = frame?.top ?? 0;
        const above = frameTop + start.top - 8;
        // About one row of buttons tall; under the strip, it goes below the selection.
        const below = above < frameTop + 48;
        const top = below ? frameTop + Math.max(end.bottom, 0) + 8 : above;
        const left = Math.max(8, Math.min((frame?.left ?? 0) + start.left, (win?.innerWidth ?? 1024) - 600));
        const now = this.sel();
        if (now && now.editor === editor && now.top === top && now.left === left && now.below === below) return;
        this.sel.set({ editor, top, left, below });
    }

    /** A press on the menu keeps the selection in the page, except in a box that takes typing. */
    keepSelection(event: MouseEvent): void {
        const target = event.target as HTMLElement | null;
        if (!target?.closest('input, textarea, select')) event.preventDefault();
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

    // ── Repeating fields (VE-D30 to VE-D35) ─────────────────────────────────
    /** A repeating field of the entry's type: its definition and row shape. */
    repeater(field: string): { def: ContentTypeField; schema: RepeaterSchema } | null {
        const def = this.editor?.currentFields.find((f) => f.key === field);
        const schema = def ? repeaterSchema(def.type) : null;
        return def && schema ? { def, schema } : null;
    }

    /** A repeating field's rows as the form shows them: in a translation, its words over the default language's rows. */
    rows(field: string): RepeaterRow[] {
        const ref = this.repeater(field);
        return ref && this.editor ? this.editor.repeaterRows(ref.def) : [];
    }

    /** Writes a repeating field's rows, as the form's row editor does. */
    private writeRows(field: string, rows: RepeaterRow[]): void {
        this.editor?.onRepeaterRowsChange(field, rows);
    }

    /** A row's value or a section heading, as typed, in the language on screen. */
    partText(info: SpotInfo): string {
        const ref = this.repeater(info.field);
        if (!ref || !this.editor) return '';
        if (info.heading) return this.editor.repeaterHeading(ref.def);
        const row = this.rows(info.field).find((r) => r.id === info.rowId);
        const value = row && info.sub ? row[info.sub] : '';
        return typeof value === 'string' ? value : '';
    }

    setPartText(info: SpotInfo, value: string): void {
        const ref = this.repeater(info.field);
        if (!ref || !this.editor || this.partText(info) === value) return;
        if (info.heading) {
            this.editor.onRepeaterHeadingChange(ref.def, value);
            return;
        }
        if (!info.rowId || !info.sub) return;
        this.writeRows(info.field, setRowValue(this.rows(info.field), info.rowId, info.sub, value));
    }

    /**
     * An empty spot's placeholder (VE-D18): "Add {label}"; a section heading's own
     * (such as "Frequently asked questions"); a row's picture "Add a picture"; in a
     * translation, a row's words in the default language (VE-D35).
     */
    placeholderFor(field: string, label: string | null, info?: SpotInfo): string {
        const ref = info && (info.heading || info.sub) ? this.repeater(field) : null;
        if (ref && info?.heading) {
            if (this.editor?.session.isTranslating()) {
                const base = this.editor.baseRepeaterHeading(ref.def);
                if (base.trim()) return base;
            }
            const own = ref.schema.heading?.placeholder;
            return label ? this.transloco.translate('admin.edit_page.add', { label: inSentence(label) }) : own || this.fieldTitle(field);
        }
        if (ref && info?.sub) {
            const sub = ref.schema.subFields.find((s) => s.key === info.sub);
            if (this.editor?.session.isTranslating() && info.rowId) {
                const base = this.editor.baseRepeaterPlaceholders(ref.def)[info.rowId]?.[info.sub];
                if (typeof base === 'string' && base.trim()) return base;
            }
            if (sub?.type === 'media') return this.transloco.translate('admin.edit_page.add_picture');
            return this.transloco.translate('admin.edit_page.add', { label: inSentence(label ?? sub?.label ?? this.fieldTitle(field)) });
        }
        return this.transloco.translate('admin.edit_page.add', { label: inSentence(label ?? this.fieldTitle(field)) });
    }

    /** An empty list's line (VE-D33): add its first row, or in a translation, where rows are added (VE-D35). */
    emptyList(field: string): { text: string; add: boolean } | null {
        const ref = this.repeater(field);
        if (!ref) return null;
        if (this.editor?.session.isTranslating()) {
            return { text: this.transloco.translate('admin.edit_page.rows_locked', { language: this.defaultLanguageLabel() }), add: false };
        }
        return { text: this.transloco.translate('admin.edit_page.add_first', { row: inSentence(ref.schema.rowLabel) }), add: true };
    }

    /** The pointer is on a row, or on none: the bar shows at once and goes a moment after, unless the pointer is on it. */
    rowHover(row: HTMLElement | null): void {
        // Just after a move: the bar stays with its row, but can still go away.
        if (row && Date.now() < this.barPinnedUntil) return;
        if (this.barHideTimer) clearTimeout(this.barHideTimer);
        this.barHideTimer = null;
        if (row) {
            this.placeBar(row);
            return;
        }
        this.barHideTimer = setTimeout(() => {
            this.barHideTimer = null;
            if (!this.onBar && !this.destroyed) this.bar.set(null);
        }, 400);
    }

    /**
     * What a screen reader calls a spot: a row's value by its own name and its row
     * ("Headline of card 2"), a section heading as the field's heading, else the field.
     */
    spotName(info: SpotInfo): string {
        const field = this.fieldTitle(info.field);
        if (info.heading) return this.transloco.translate('admin.edit_page.heading_name', { field });
        const ref = info.rowId != null && info.sub != null ? this.repeater(info.field) : null;
        const part = ref?.schema.subFields.find((s) => s.key === info.sub)?.label;
        if (!ref || !part) return field;
        const n = this.rows(info.field).findIndex((r) => r.id === info.rowId) + 1;
        const row = ref.schema.rowLabel;
        // The value that is the row (an FAQ's question): "Question 2", not "Question of question 2".
        if (part.trim().toLowerCase() === row.trim().toLowerCase()) return this.transloco.translate('admin.edit_page.row_number', { row, n: n || '' }).trim();
        return this.transloco.translate('admin.edit_page.row_part_name', { part, row: inSentence(row), n: n || '' }).trim();
    }

    /** A row's name inside a sentence ("Remove card"). */
    rowWord(label: string): string {
        return inSentence(label);
    }

    barHovered(on: boolean): void {
        this.onBar = on;
        if (!on) this.rowHover(null);
    }

    /**
     * The bar at the row's top right: just above the row when that covers no words, else
     * inside its top (review M10); below the strip; across arrows for rows side by side.
     */
    private placeBar(row: HTMLElement): void {
        const field = row.getAttribute('data-arc-field') || '';
        const type = this.contentType();
        const ref = repeaterFieldOf(field, type);
        const id = row.getAttribute('data-arc-row-id') || '';
        if (!ref || !id) {
            this.bar.set(null);
            return;
        }
        const frame = this.frame?.nativeElement.getBoundingClientRect();
        const box = rowBox(row);
        const ids = this.rows(ref.key).map((r) => r.id);
        const index = ids.indexOf(id);
        const next = row.ownerDocument.querySelector<HTMLElement>(`[data-arc-row][data-arc-field="${cssEscape(field)}"][data-arc-row-id="${cssEscape(ids[index + 1] ?? ids[index - 1] ?? '')}"]`);
        const frameTop = frame?.top ?? 0;
        const frameBottom = frame?.bottom ?? (this.document.defaultView?.innerHeight ?? 768);
        const doc = row.ownerDocument;
        const width = doc.documentElement.clientWidth;
        const right = Math.min(box.right, width) - 4;
        const place = firstClear(
            [boxAt(right, box.top - BAR_HEIGHT - 2, BAR_WIDTH, BAR_HEIGHT), boxAt(right, box.top + 4, BAR_WIDTH, BAR_HEIGHT)],
            { width, height: frameBottom - frameTop },
            (b) => coversWords(doc, b),
        );
        // Off the frame's top: held at its top while the row is still showing.
        const top = Math.round(Math.min(Math.max(frameTop + place.top, frameTop + 4), frameBottom - 34));
        const left = Math.round((frame?.left ?? 0) + right);
        const visible = box.bottom > 0 && box.top < frameBottom - frameTop;
        if (!visible) {
            this.bar.set(null);
            return;
        }
        const now = this.bar();
        const across = rowsAcross(box, next ? rowBox(next) : null);
        const locked = !!this.editor?.session.isTranslating();
        const label = ref.schema.rowLabel;
        if (now && now.id === id && now.top === top && now.left === left && now.across === across && now.locked === locked
            && now.first === (index <= 0) && now.last === (index === ids.length - 1)) return;
        this.bar.set({ field: ref.key, id, top, left, across, locked, label, first: index <= 0, last: index === ids.length - 1 });
    }

    /** The bar follows its row as the page scrolls or is drawn again. */
    syncBar(): void {
        const now = this.bar();
        const doc = this.frameDocument();
        if (!now || !doc) return;
        const row = doc.querySelector<HTMLElement>(`[data-arc-row][data-arc-row-id="${cssEscape(now.id)}"]`);
        if (!row) {
            if (!this.onBar) this.bar.set(null);
            return;
        }
        this.placeBar(row);
    }

    /** Add after: a blank row after this one, its first words typed at once; on a gallery, photos picked first. */
    rowAddAfter(): void {
        const b = this.bar();
        if (b) this.rowAdd(b.field, b.id);
    }

    /** New rows after `afterId` (null: the first row of an empty list). */
    rowAdd(field: string, afterId: string | null): void {
        const ref = this.repeater(field);
        if (!ref || this.editor?.session.isTranslating()) return;
        this.inPlace?.leave();
        const bulk = ref.schema.subFields.find((s): s is RepeaterMediaSubField => s.type === 'media' && s.allowBulkAdd === true);
        if (bulk) {
            // A gallery item is its photo: the photos are picked, one item each.
            this.openRowPicker(ref.def, bulk, true).subscribe((result: MediaSelection | null) => {
                if (result?.type !== 'submit' || this.destroyed) return;
                const urls = result.mediaUrls?.length ? result.mediaUrls : result.mediaUrl ? [result.mediaUrl] : [];
                if (!urls.length) return;
                const added = urls.map((url) => ({ ...newRepeaterRow(ref.schema, 0), [bulk.key]: url }));
                this.writeRows(field, insertRowsAfter(this.rows(field), afterId, added));
            });
            return;
        }
        const row = newRepeaterRow(ref.schema, 0);
        this.writeRows(field, insertRowsAfter(this.rows(field), afterId, [row]));
        this.justAdded = { field, id: row.id };
        this.inPlace?.openWhenDrawn(row.id);
    }

    rowMove(step: -1 | 1): void {
        const b = this.bar();
        if (!b || b.locked) return;
        this.inPlace?.leave();
        this.barPinnedUntil = Date.now() + BAR_PIN_MS;
        this.writeRows(b.field, moveRow(this.rows(b.field), b.id, step));
    }

    /** Remove at once; a row with anything in it can be put back with Undo for a few seconds. */
    rowRemove(): void {
        const b = this.bar();
        const ref = b ? this.repeater(b.field) : null;
        if (!b || !ref || b.locked) return;
        this.inPlace?.leave();
        const { rows, removed, index } = removeRow(this.rows(b.field), b.id);
        if (!removed) return;
        // A box open on a value of this row goes with it: its Replace would change nothing.
        const open = this.pop()?.spot;
        if (open && open.field === b.field && open.rowId === b.id) this.closePopover();
        this.bar.set(null);
        this.onBar = false;
        // The next row is now under the pointer: its bar waits until the pointer moves, so a
        // second click on the same place does not remove that row too.
        this.inPlace?.holdRowsUntilMoved();
        this.writeRows(b.field, rows);
        // A row with nothing in it goes with no note; an earlier row's Undo stays.
        if (isRepeaterRowEmpty(removed, ref.schema)) return;
        this.clearUndo();
        this.undo.set({ text: this.transloco.translate('admin.edit_page.row_removed', { row: ref.schema.rowLabel }), field: b.field, row: removed, index });
        this.undoTimer = setTimeout(() => {
            this.undoTimer = null;
            this.undo.set(null);
        }, UNDO_MS);
    }

    undoRemove(): void {
        const u = this.undo();
        this.clearUndo();
        if (u && !this.editor?.session.isTranslating()) this.writeRows(u.field, restoreRow(this.rows(u.field), u.row, u.index));
    }

    private clearUndo(): void {
        if (this.undoTimer) clearTimeout(this.undoTimer);
        this.undoTimer = null;
        this.undo.set(null);
    }

    /** The media picker for a row's picture: images, and icons where the row takes them. */
    private openRowPicker(def: ContentTypeField, sub: RepeaterMediaSubField, multiple: boolean) {
        const allowImages = sub.allowImages !== false;
        const allowIcons = !multiple && sub.allowIcons === true;
        return this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({
            isDialogOpen: true,
            title: this.transloco.translate('admin.media.picker.repeater_field', { field: this.editor?.fieldLabel(def) ?? def.label, sub: sub.label }),
            allowImages,
            allowIcons,
            multiple,
            initialTab: allowImages ? undefined : 'icons',
        })).afterClosed();
    }

    /** A row's picture: the picker at once when it has none, else Replace and Remove (and, on a gallery, a video link). */
    private openRowImage(spot: Spot): void {
        const ref = this.repeater(spot.field);
        const sub = ref?.schema.subFields.find((s): s is RepeaterMediaSubField => s.key === spot.sub && s.type === 'media');
        const row = this.rows(spot.field).find((r) => r.id === spot.rowId);
        if (!ref || !sub || !row) return;
        const has = mediaRowKeys(sub).some((key) => !!row[key]);
        if (!has) {
            this.pickRowImage(spot);
            return;
        }
        this.showPopover(spot, true);
        const video = sub.videoKey && typeof row[sub.videoKey] === 'string' ? row[sub.videoKey] as string : '';
        if (sub.videoKey) this.pop.update((p) => (p ? { ...p, video } : p));
    }

    private pickRowImage(spot: Spot): void {
        const ref = this.repeater(spot.field);
        const sub = ref?.schema.subFields.find((s): s is RepeaterMediaSubField => s.key === spot.sub && s.type === 'media');
        if (!ref || !sub || !spot.rowId) return;
        const id = spot.rowId;
        this.openRowPicker(ref.def, sub, false).subscribe((result: MediaSelection | null) => {
            if (result?.type !== 'submit' || this.destroyed) return;
            const chosen = result.kind === 'icon' && result.icon && sub.iconKey ? { [sub.iconKey]: result.icon }
                : result.mediaUrl ? { [sub.key]: result.mediaUrl } : null;
            if (chosen) this.writeRows(spot.field, setRowMedia(this.rows(spot.field), id, sub, chosen));
        });
    }

    /** A gallery item's YouTube link, checked as the form checks it; empty clears it. */
    setRowVideo(raw: string): void {
        const spot = this.pop()?.spot;
        const ref = spot ? this.repeater(spot.field) : null;
        const sub = ref?.schema.subFields.find((s): s is RepeaterMediaSubField => s.key === spot?.sub && s.type === 'media');
        if (!spot?.rowId || !sub?.videoKey) return;
        const link = raw.trim();
        if (link && !isYouTubeUrl(link)) {
            this.videoError.set(true);
            return;
        }
        this.videoError.set(false);
        const row = this.rows(spot.field).find((r) => r.id === spot.rowId);
        // An empty box takes the video away, never a photo the item shows.
        if (link) this.writeRows(spot.field, setRowMedia(this.rows(spot.field), spot.rowId, sub, { [sub.videoKey]: link }));
        else if (row?.[sub.videoKey]) this.writeRows(spot.field, setRowValue(this.rows(spot.field), spot.rowId, sub.videoKey, ''));
        this.closePopover();
    }

    /** A map row's place: the map picker in a box on the map, the address or the directions link (VE-D34). */
    private openRowLocation(spot: Spot): void {
        const sub = this.locationSub(spot);
        const row = this.rows(spot.field).find((r) => r.id === spot.rowId);
        if (!sub || !row || this.editor?.session.isTranslating()) return;
        // Already open for this row: it stays, with what is typed in it.
        const open = this.pop();
        if (open?.location && open.spot.field === spot.field && open.spot.rowId === spot.rowId) return;
        const num = (value: unknown) => (typeof value === 'number' ? value : null);
        this.showPopover(spot, false);
        this.pop.update((p) => p && {
            ...p,
            ...this.popPlace(spot.el, true),
            title: spot.label ?? sub.label,
            location: { address: typeof row[sub.key] === 'string' ? row[sub.key] as string : '', lat: num(row[sub.latKey]), lng: num(row[sub.lngKey]), zoom: num(row[sub.zoomKey]) },
        });
    }

    private locationSub(spot: Spot | undefined): RepeaterLocationSubField | null {
        if (!spot?.rowId || !spot.sub) return null;
        const sub = this.repeater(spot.field)?.schema.subFields.find((s) => s.key === spot.sub);
        return sub?.type === 'location' ? sub : null;
    }

    /** The point moved or the address changed in the map box: the row takes both, as the form's row editor writes them. */
    rowLocationPicked(picked: PickedLocation): void {
        const spot = this.pop()?.spot;
        const sub = this.locationSub(spot);
        // The point is the same in every language: only the default language moves it (VE-D35).
        if (!spot?.rowId || !sub || this.editor?.session.isTranslating()) return;
        this.writeRows(spot.field, setRowLocation(this.rows(spot.field), spot.rowId, sub, picked));
        this.pop.update((p) => (p ? { ...p, location: { address: picked.address, lat: picked.lat, lng: picked.lng, zoom: picked.zoom } } : p));
    }

    rowLocationCleared(): void {
        const spot = this.pop()?.spot;
        const sub = this.locationSub(spot);
        if (!spot?.rowId || !sub || this.editor?.session.isTranslating()) return;
        this.writeRows(spot.field, setRowLocation(this.rows(spot.field), spot.rowId, sub, null));
        this.pop.update((p) => (p ? { ...p, location: { address: '', lat: null, lng: null, zoom: null } } : p));
    }

    // ── Done and Cancel (VE-D37) ─────────────────────────────────────────────
    /** Done: the value is left, its change kept, as a click elsewhere does. */
    spotDone(): void {
        this.inPlace?.leave();
    }

    /** Cancel: the value goes back to what it held when it was opened. */
    spotCancel(): void {
        this.inPlace?.cancel();
    }

    /** A row just added and still blank goes when its first value is cancelled. */
    spotCancelled(spot: Spot): void {
        const added = this.justAdded;
        if (!added || spot.field !== added.field || spot.rowId !== added.id) return;
        this.justAdded = null;
        const ref = this.repeater(spot.field);
        const row = this.rows(spot.field).find((r) => r.id === added.id);
        if (!ref || !row || !isRepeaterRowEmpty(row, ref.schema)) return;
        this.writeRows(spot.field, removeRow(this.rows(spot.field), added.id).rows);
    }

    /**
     * Done and Cancel just outside the value's bottom right; for a value taller than the
     * window (the body), at the window's bottom until its end shows. Hidden while it is
     * out of sight.
     */
    syncSpotActions(): void {
        const spot = this.inPlace?.current();
        const frame = this.frame?.nativeElement;
        const typed = spot && (spot.kind === 'text' || spot.kind === 'rich');
        if (!typed || !frame || !spot.el.isConnected) {
            if (this.spotActions()) this.spotActions.set(null);
            return;
        }
        const area = frame.getBoundingClientRect();
        const box = spot.el.getBoundingClientRect();
        if (box.bottom < 0 || box.top > area.height) {
            if (this.spotActions()) this.spotActions.set(null);
            return;
        }
        // Page settings open over the page: the buttons stay on the page's side of it.
        const panelLeft = this.panel.shown() ? this.panelBox?.nativeElement.getBoundingClientRect().left ?? Infinity : Infinity;
        const doc = spot.el.ownerDocument;
        const width = Math.min(doc.documentElement.clientWidth - 4, panelLeft - 8 - area.left);
        const pair = this.document.querySelector<HTMLElement>('.arc-ed-spot')?.getBoundingClientRect().width || SPOT_ACTIONS_PAIR;
        // A short value near the left edge: the pair keeps inside the window.
        const right = Math.max(Math.min(box.right, width), pair + 4);
        const below = boxAt(right, Math.min(box.bottom + 6, area.height - SPOT_ACTIONS_HEIGHT - 8), pair, SPOT_ACTIONS_HEIGHT);
        // A value taller than the window (the body): at the window's bottom, as before. Else the
        // first place that covers no words: below, beside the last line, above (review M10).
        const place = box.bottom + 6 + SPOT_ACTIONS_HEIGHT > area.height ? below : firstClear([
            below,
            boxAt(box.right + 8 + pair, box.bottom - SPOT_ACTIONS_HEIGHT, pair, SPOT_ACTIONS_HEIGHT),
            boxAt(right, box.top - SPOT_ACTIONS_HEIGHT - 6, pair, SPOT_ACTIONS_HEIGHT),
        ], { width, height: area.height }, (b) => coversWords(doc, b));
        const top = Math.round(area.top + place.top);
        // A short value near the left edge: the buttons keep inside the window.
        const left = Math.round(Math.max(area.left + place.right, SPOT_ACTIONS_WIDTH + 8));
        const now = this.spotActions();
        if (now && now.top === top && now.left === left) return;
        this.spotActions.set({ top, left });
    }

    // ── Images, boxes and the panel ──────────────────────────────────────────
    /** An image spot: the picker at once when it is empty, else Replace and Remove on it. */
    openImage(spot: Spot): void {
        if (spot.rowId && spot.sub) {
            this.openRowImage(spot);
            return;
        }
        if (!this.fieldValue(spot.field)) {
            this.pickImage(spot.field);
            return;
        }
        this.showPopover(spot, true);
    }

    replaceImage(): void {
        const spot = this.pop()?.spot;
        this.closePopover();
        if (spot?.rowId && spot.sub) this.pickRowImage(spot);
        else if (spot) this.pickImage(spot.field);
    }

    removeImage(): void {
        const spot = this.pop()?.spot;
        this.closePopover();
        if (!spot || !this.editor) return;
        if (spot.rowId && spot.sub) {
            const sub = this.repeater(spot.field)?.schema.subFields.find((s): s is RepeaterMediaSubField => s.key === spot.sub && s.type === 'media');
            if (sub) this.writeRows(spot.field, setRowMedia(this.rows(spot.field), spot.rowId, sub, {}));
            return;
        }
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
        if (spot.rowId && spot.sub) {
            if (this.locationSub(spot)) this.openRowLocation(spot);
            else this.openInPanel(spot);
            return;
        }
        const tab = this.editor?.activeTab ?? null;
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
        this.popReturn = { node, marker, tab };
        setTimeout(() => {
            if (!this.destroyed) node.querySelector<HTMLElement>('input:not([type="hidden"]), select, textarea, button')?.focus();
        });
    }

    /** The custom field's box in the panel (`#req-{key}`), on the Basic tab; the box puts the tab back as it closes. */
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
        this.pop.set({ title: spot.label ?? this.fieldTitle(spot.field), ...this.popPlace(spot.el, false), image, spot });
    }

    /**
     * Where the box on a value goes: under it, kept inside the window. The map box is
     * wide and tall: it goes where all of it fits, and scrolls inside when the window is
     * shorter than it.
     */
    private popPlace(el: Element, map: boolean): { top: number; left: number; maxHeight?: number } {
        const frame = this.frame?.nativeElement.getBoundingClientRect();
        const box = el.getBoundingClientRect();
        const win = this.document.defaultView;
        const height = win?.innerHeight ?? 768;
        const width = win?.innerWidth ?? 1024;
        const top = Math.max(48, Math.min((frame?.top ?? 0) + box.bottom + 6, height - 160));
        const left = Math.max(8, Math.min((frame?.left ?? 0) + box.left, width - 320 - 8));
        if (!map) return { top, left };
        const mapTop = Math.max(48, Math.min(top, height - MAP_BOX_HEIGHT - 8));
        return { top: mapTop, left: Math.max(8, Math.min(left, width - MAP_BOX_WIDTH - 8)), maxHeight: height - mapTop - 8 };
    }

    /** The box stays on its value as the page scrolls, is drawn again or changes width. */
    placePopover(): void {
        const spot = this.popSpot();
        const p = this.pop();
        if (!p || !spot) return;
        const at = this.popPlace(spot.el, !!p.location);
        if (at.top !== p.top || at.left !== p.left || at.maxHeight !== p.maxHeight) this.pop.set({ ...p, ...at });
    }

    /**
     * The box's value now. A change made in the box draws the page again, so its element
     * is a new one: it is found again by its mark, and the box goes on following it.
     */
    private popSpot(): Spot | null {
        const p = this.pop();
        if (!p) return null;
        if (p.spot.el.isConnected) return p.spot;
        const again = this.inPlace?.find(p.spot) ?? null;
        if (again) this.pop.set({ ...p, spot: again });
        return again;
    }

    /**
     * Work in Page settings starts: a box on the page closes (its control goes home before
     * the panel's tab can change under it) and the spot being typed in is left, so leaving
     * it later cannot write its older words over what the panel changes.
     */
    panelInUse(): void {
        // The person works in the panel as it is now: the box does not switch its tab back under the click.
        if (this.popReturn) this.popReturn.tab = null;
        this.closePopover();
        this.inPlace?.leave();
    }

    /** Done or Escape in the box: it closes and the keyboard is back on the spot. */
    donePopover(): void {
        const spot = this.popSpot() ?? this.pop()?.spot;
        this.closePopover();
        spot?.el.focus?.({ preventScroll: true });
    }

    /** Puts the box away and its control back in the panel. */
    closePopover(): void {
        // A box typed in commits on leaving it (the map's address): it is left before it goes.
        const focused = this.document.activeElement as HTMLElement | null;
        if (this.pop() && focused?.closest?.('[data-testid="edit-popover"]')) focused.blur();
        const back = this.popReturn;
        this.popReturn = null;
        if (back) {
            // The panel drew its fields again meanwhile: the old control is not put back.
            if (back.marker.isConnected && back.marker.parentNode) back.marker.parentNode.insertBefore(back.node, back.marker);
            else back.node.remove();
            back.marker.remove();
            // The panel is back on the tab it was on (SEO, Checks): the box does not lose the place.
            const editor = this.editor;
            if (editor && back.tab && editor.activeTab !== back.tab) {
                editor.activeTab = back.tab;
                editor.cdr.detectChanges();
            }
        }
        if (this.pop()) this.pop.set(null);
        this.videoError.set(false);
    }

    /** A field not edited on the page: the panel opens on it. */
    openInPanel(spot: Spot): void {
        this.panel.setOpen(true);
        setTimeout(() => {
            if (!this.destroyed) this.editor?.focusField(spot.field, spot.row ?? undefined);
        }, 260);
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
        // The screen closed while saving: the editor has gone somewhere else already.
        if (!(await this.saveFirst()) || this.destroyed) return;
        const id = this.currentId();
        void this.router.navigate(id ? ['/admin/contents', this.type, 'edit', id] : ['/admin/contents', this.type, 'add']);
    }

    /** Live Preview: the entry's own preview window, opened or brought forward, as from the classic editor. */
    openPreview(): void {
        this.editor?.openPreview();
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
        if (this.destroyed) return false;
        this.readStatus();
        if (editor.hasUnsavedChanges()) {
            this.panel.setOpen(true);
            return false;
        }
        return true;
    }
}

/** What the row bar shows for a row (VE-D32). */
export interface RowBar {
    field: string;
    id: string;
    top: number;
    left: number;
    /** Rows side by side: the arrows point left and right. */
    across: boolean;
    /** A translation: no changes, only where rows are arranged (VE-D35). */
    locked: boolean;
    label: string;
    first: boolean;
    last: boolean;
}

/** How tall and wide the Done and Cancel buttons are, to keep them inside the window. */
const SPOT_ACTIONS_HEIGHT = 28;
const SPOT_ACTIONS_WIDTH = 170;
/** Done and Cancel's own width before they are first drawn. */
const SPOT_ACTIONS_PAIR = 150;
/** The row bar's size, for finding a place that covers no words. */
const BAR_HEIGHT = 30;
const BAR_WIDTH = 124;

/** About how tall the map box is: search, map, address and point boxes. */
const MAP_BOX_HEIGHT = 470;
/** The map box's width (its CSS). */
const MAP_BOX_WIDTH = 440;

/** How long the bar stays with a row it just moved. */
const BAR_PIN_MS = 1500;

/** How long Undo stays after a row is removed. */
const UNDO_MS = 8000;

/** A row's box; one drawn by its children alone (display: contents) is the box around them. */
function rowBox(row: HTMLElement): DOMRect {
    const own = row.getBoundingClientRect();
    if (own.width || own.height) return own;
    const boxes = Array.from(row.children).map((child) => child.getBoundingClientRect()).filter((b) => b.width || b.height);
    if (!boxes.length) return own;
    const left = Math.min(...boxes.map((b) => b.left));
    const top = Math.min(...boxes.map((b) => b.top));
    const right = Math.max(...boxes.map((b) => b.right));
    const bottom = Math.max(...boxes.map((b) => b.bottom));
    return { left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) } as DOMRect;
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
