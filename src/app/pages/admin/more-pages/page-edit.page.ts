import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import { isHeld } from '../../../core/editing/hold';
import {
    ChangeDetectionStrategy, Component, ElementRef, HostListener, Injector, OnDestroy, OnInit, PLATFORM_ID, ViewChild,
    computed, effect, inject, signal, untracked, viewChild,
} from '@angular/core';
import { DomSanitizer, type SafeResourceUrl } from '@angular/platform-browser';
import { ActivatedRoute, Router } from '@angular/router';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { injectT } from '../../../core/i18n/inject-t';
import { safePageTextUrl } from '../../../core/utils/page-text-model';
import { resolvePreviewField } from '../../../core/preview/preview-channel';
import { NotifyService } from '../../../../shared/services/notify.service';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { CreateContentComponent, type PageModeHooks } from '../contents/create-content/create-content.component';
import { ContentTypesStore } from '../contents/content-types/content-types.store';
import { contentTypeSingularName, type ContentType } from '../contents/content-types/content-types.model';
import { PageCardActions, cardHasReplace, cardProblem, type CardRef } from './page-card-actions';
import type { EditState } from '../edit/edit-state';
import { EditStateComponent } from '../edit/page-status.component';
import type { Change } from '../../../core/editing/compare';
import { HoldService } from '../../../core/editing/hold.service';
import { HoldBarComponent } from '../hold/hold-bar.component';
import type { ReviewCard } from '../hold/review-changes-dialog.component';
import { PageReview } from './page-review';
import { pageValuesHaveReplace } from './page-text-editor.model';
import { classicEditorLink, pagePreviewPath, pageRefFrom, type PageRef } from './page-ref';
export { pageValuesHaveReplace };
import { isPageChange, type PageCardsMessage } from './page-cards';
import MediaManagerComponent from '../(media)/media.page';
import { mediaPickerDialogConfig } from '../(media)/media-picker-dialog';
import { PagePanel } from '../edit/page-panel';
import { EditableReveal, readShowEditable, writeShowEditable } from '../edit/editable-reveal';
import { PageEditorData } from './page-editor-data';
import { PageInPlace, cardOf, type PageInPlaceHost } from './page-in-place';
import type { HasUnsavedChanges } from '../../../guards/unsaved-changes.guard';
import { PageTextPanelComponent } from './page-text-panel.component';
import type { AreaView } from './page-text-editor.model';

/** How long the screen waits for the frame to draw the page. */
const DRAW_WAIT_MS = 20_000;
/** How long a drawn list page waits for its cards to be marked, so the outlines find them. */
const CARDS_DRAW_WAIT_MS = 5_000;
/** How long the screen waits for a card's form to load the card. */
const CARD_WAIT_MS = 10_000;
/** About how wide the card bar is at most, so it never runs off the left edge. */
const CARD_BAR_WIDTH = 300;

function cssEscape(value: string): string {
    return typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(value) : value.replace(/["\\]/g, '\\$&');
}

/** A type's name inside a sentence ("new testimonial"): its first letter small, unless it starts an acronym. */
function inSentenceName(name: string): string {
    return /^\p{Lu}\p{Ll}/u.test(name) ? name[0].toLowerCase() + name.slice(1) : name;
}

/** The frame's address: the page's Live Preview in edit mode (VE-D55). */
/**
 * The address of the site page an editor came from, to go back to on Close: the
 * path of a referrer on this site that is not an admin page, else ''.
 */
export function siteAddressOpenedFrom(referrer: string, origin: string): string {
    if (!referrer || !origin) return '';
    try {
        const url = new URL(referrer);
        if (url.origin !== origin || url.pathname.startsWith('//') || url.pathname === '/admin' || url.pathname.startsWith('/admin/')) return '';
        return url.pathname + url.search;
    } catch {
        return '';
    }
}

/** The Visual Editor's frame: the page's preview, to be edited. */
export function pageEditFrameUrl(page: PageRef, lang: string, defaultLang: string): string {
    return `${pagePreviewPath(page, lang, defaultLang)}?edit=1`;
}

/** Live Preview from the Visual Editor: the page with its draft and the changed cards, as the one Publish would put them out. */
export function pageLivePreviewUrl(page: PageRef, lang: string, defaultLang: string): string {
    return `${pagePreviewPath(page, lang, defaultLang)}?cards=1`;
}

/** The list page's own nodes were drawn again, not an area's words changed or a card marked. */
export function listReplaced(record: MutationRecord): boolean {
    if (record.type !== 'childList') return false;
    if ((record.target as Element).hasAttribute?.('data-arc-list-drawn')) return true;
    return Array.from(record.addedNodes).some((node) => {
        const el = node as Element;
        return !!el.matches?.('[data-arc-list-drawn]') || !!el.querySelector?.('[data-arc-list-drawn]');
    });
}

/** A list page is drawn: its template is, and its cards are marked as entries (VE-D66); with none, or after a wait, its template alone. */
export function listDrawn(doc: Document, waited = false): boolean {
    const list = doc.querySelector('[data-arc-list-drawn]');
    if (!list) return false;
    return waited || !list.querySelector('[data-arc-field="items"]') || !!list.querySelector('[data-arc-card-id]');
}

/** A card on the page, as the screen reads it from the frame's marks (VE-D54). */
export interface PageCard extends CardRef {
    /** Drawn from a draft with unpublished changes: Publish takes it (VE-D53). */
    changed: boolean;
    /** Changed on this page by the person whose page is being looked at (VE-D81). */
    theirs?: boolean;
    /** Publish would push it out of a full block. */
    leaving: boolean;
}

/** The cards the frame marks, once each, outside the header and footer (VE-D20). */
export function pageCardsIn(doc: Document): PageCard[] {
    const cards: PageCard[] = [];
    for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-arc-card-id]'))) {
        const found = cardOf(el);
        if (!found) continue;
        const key = `${found.card.type}/${found.card.id}`;
        const changed = el.hasAttribute('data-arc-changed');
        const leaving = el.hasAttribute('data-arc-leaving');
        const theirs = el.hasAttribute('data-arc-theirs');
        const known = cards.find((card) => `${card.type}/${card.id}` === key);
        if (known) {
            known.changed ||= changed;
            continue;
        }
        cards.push({ ...found.card, changed, leaving, ...(theirs ? { theirs } : {}) });
    }
    return cards;
}

/** The card bar (VE-D54): the card it is for, where it goes and what it offers. */
export interface CardBar {
    card: CardRef;
    top: number;
    left: number;
    /** A type without pages: Add and Remove; with pages: Open. */
    hasPages: boolean;
    /** In the type's own order: Move, and which ways. */
    move: { before: string | null; after: string | null; across: boolean } | null;
    /** Shown newest first: said on hover. */
    newest: boolean;
    leaving: boolean;
    /** Someone else is editing the entry: it is not removed from here. */
    locked?: boolean;
    typeName: string;
}

/** The box for what is not typed in place, and where it shows. */
interface Box {
    view: AreaView;
    el: HTMLElement;
    top: number;
    left: number;
}

/**
 * The Visual Editor for the home page, a static page or a list page
 * (specs/visual-editing-spec.md, VE-D49, VE-D50, VE-D55, VE-D58): the page as the site
 * draws it in a frame, its marked areas changed where they are, under the same
 * strip as an entry's Visual Editor, with the page's panel as Page settings. It is
 * the same draft as the classic editor's, and every change saves on its own.
 */
@Component({
    selector: 'arc-page-edit',
    standalone: true,
    imports: [TranslocoPipe, EditStateComponent, HoldBarComponent, PageTextPanelComponent, CreateContentComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrls: ['../edit/edit-screen.css'],
    styles: [`
        .page-panel-body { width: min(340px, 100vw - 24px); overflow-y: auto; }
        .page-text-panel-box[hidden] { display: none; }
        /* A card's form fits a narrow window too. */
        .page-card-body { width: min(420px, 100vw - 24px); }
        .page-card-body > arc-create-content { overflow-x: hidden; }
        .page-card-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 6px 12px; border-bottom: 1px solid var(--bs-border-color, #dee2e6); }
        .page-card-note { padding: 8px 12px; background: #f8f9fa; border-bottom: 1px solid var(--bs-border-color, #dee2e6); }
        .page-card-type { font-size: .8rem; color: var(--bs-secondary-color, #6c757d); }
        .arc-ed-bar-text { width: auto; padding: 0 8px; font-size: 12px; }
    `],
    template: `
    <div class="arc-ed-strip" role="region" [attr.aria-label]="'admin.edit_page.strip' | transloco" data-testid="page-edit-strip">
        <span class="arc-ed-title arc-ed-name" [title]="pageTitle()">{{ pageTitle() }}</span>
        @if (panelRef()?.known() || data.session?.error()) {
        <arc-edit-state [state]="status()" [dark]="true" data-testid="page-edit-status" />
        }
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
        <!-- What can be changed, outlined until turned off (remembered for this person). -->
        <button type="button" class="arc-ed-btn" [class.arc-ed-on]="showEditable()" [attr.aria-pressed]="showEditable()" (click)="toggleShowEditable()"
            [title]="'admin.edit_page.show_editable' | transloco" [attr.aria-label]="'admin.edit_page.show_editable' | transloco" data-testid="page-edit-show-editable"><i class="bi bi-bounding-box" aria-hidden="true"></i></button>
        <span class="arc-ed-group" role="group" [attr.aria-label]="'admin.preview.width' | transloco">
            <button type="button" class="arc-ed-btn" [class.arc-ed-on]="!phone()" [attr.aria-pressed]="!phone()" (click)="phone.set(false)"
                [title]="'admin.preview.full_width' | transloco" [attr.aria-label]="'admin.preview.full_width' | transloco"><i class="bi bi-display" aria-hidden="true"></i></button>
            <button type="button" class="arc-ed-btn" [class.arc-ed-on]="phone()" [attr.aria-pressed]="phone()" (click)="phone.set(true)"
                [title]="'admin.preview.phone' | transloco" [attr.aria-label]="'admin.preview.phone' | transloco"><i class="bi bi-phone" aria-hidden="true"></i></button>
        </span>
        <!-- The page in its own window, updating with each save, the changed cards included, as on an entry's strip. -->
        @if (data.isList) {
        <!-- A new entry of the type starts on its own page (VE-D62). -->
        <button type="button" class="arc-ed-btn" (click)="addEntry()" [disabled]="!!data.loadError()" data-testid="page-edit-add-entry">
            <i class="bi bi-plus-lg" aria-hidden="true"></i> {{ 'admin.contents.list.add_item' | transloco: { type: singularTitle() } }}</button>
        }
        <button type="button" class="arc-ed-btn" (click)="openPreview()" [disabled]="!panelRef()" [title]="'admin.contents.editor.preview_title' | transloco" data-testid="page-edit-preview">
            <i class="fa-regular fa-eye" aria-hidden="true"></i> {{ 'admin.contents.editor.preview' | transloco }}</button>
        <button type="button" class="arc-ed-btn" (click)="toClassic()" [title]="'admin.edit_page.form_title' | transloco" data-testid="page-edit-classic">{{ 'admin.edit_page.form' | transloco }}</button>
        <button type="button" class="arc-ed-btn" (click)="panel.toggle()" [class.arc-ed-on]="panel.open()"
            [attr.aria-expanded]="panel.open()" aria-controls="arc-ed-panel" data-testid="page-edit-settings">{{ 'admin.edit_page.page_settings' | transloco }}</button>
        <button type="button" class="arc-ed-btn arc-ed-primary" (click)="publish()" [disabled]="!panelRef()?.canPublish() || checking()"
            [attr.aria-busy]="checking() || publishing()" data-testid="page-edit-publish">{{ 'admin.contents.editor.publish' | transloco }}</button>
        <button type="button" class="arc-ed-btn" (click)="close()" data-testid="page-edit-close">{{ 'common.actions.close' | transloco }}</button>
    </div>
    @if (data.loadError()) {
    <div class="alert alert-danger m-3" role="alert">{{ data.loadError() }}</div>
    }
    @if (data.session?.error()) {
    <div class="alert alert-danger m-0 rounded-0 py-2" role="alert">{{ 'admin.more_pages.editor.not_read' | transloco }}</div>
    }
    @if (saveError()) {
    <div class="alert alert-danger m-0 rounded-0 py-2" role="alert">{{ 'admin.more_pages.editor.not_saved_detail' | transloco }}</div>
    }
    @if (data.heldBy(); as hold) {
    <arc-hold-bar [hold]="hold" (review)="review()" />
    }
    <div class="arc-ed-stage">
        @if (frameUrl(); as url) {
        <iframe #frame class="arc-ed-frame" [class.arc-ed-phone]="phone()" [src]="url" [title]="'admin.edit_page.frame' | transloco"
            (load)="onFrameLoad()" data-testid="page-edit-frame"></iframe>
        }
        @if (!drawn() && !data.loadError()) {
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
            <div class="arc-ed-panel-body" [class.page-panel-body]="!card()" [class.page-card-body]="!!card()" [attr.inert]="panel.shown() ? null : ''" (pointerdown)="leaveSpot()">
                @if (card(); as open) {
                <!-- A card's own form while it is edited (VE-D54): the entry editor in page mode, on its own draft. -->
                <div class="page-card-head" data-testid="page-edit-card-head">
                    <button type="button" class="btn btn-link btn-sm px-0" (click)="backToPage()" data-testid="page-edit-back">
                        <i class="bi bi-arrow-left" aria-hidden="true"></i> {{ 'admin.edit_page.back_to_page' | transloco }}</button>
                    <span class="page-card-type">{{ typeName(open.type) }}</span>
                </div>
                @if (cardAside()) {
                <div class="page-card-note" data-testid="page-edit-card-aside">
                    <p class="small mb-1">{{ 'admin.hold.card_publish_with_hint' | transloco }}</p>
                    <button type="button" class="btn btn-outline-primary btn-sm" (click)="includeCard(open)" data-testid="page-edit-card-include">{{ 'admin.hold.card_publish_with' | transloco }}</button>
                </div>
                } @else {
                <p class="page-card-note small mb-0">{{ 'admin.hold.card_everywhere' | transloco: { type: singularName(open.type) } }}</p>
                }
                @for (each of [open]; track each.type + '/' + each.id) {
                <arc-create-content [contentTypeSlug]="each.type" [contentId]="each.id" [pageMode]="true" [cardMode]="true"
                    [cardOnPage]="cardAside() ? null : data.pageId" [pageHooks]="cardHooks" />
                }
                }
                <div class="page-text-panel-box" [hidden]="!!card()">
                @if (data.session; as session) {
                <arc-page-text-panel #panelRef [session]="session" [lang]="data.lang()" [defaultLang]="data.defaultLang()" [seo]="data.seo()" [basics]="data.basics()"
                    [busy]="saving() > 0" [failed]="!!saveError()" [url]="data.url()" [beforePublish]="beforePublish" [publishWith]="publishWith" [extraChanges]="changedCards().length"
                    [locked]="!!data.heldBy()" (review)="review()" />
                }
                </div>
            </div>
        </aside>
    </div>
    @if (cardBar(); as b) {
    <!-- A card's bar (VE-D54): Add and Remove, or Open; Move in a type's own order. -->
    <div class="arc-ed-bar" role="toolbar" [attr.aria-label]="b.typeName" [style.top.px]="b.top" [style.left.px]="b.left"
        (pointerenter)="barHovered(true)" (pointerleave)="barHovered(false)" data-testid="page-edit-card-bar">
        @if (b.leaving) {
        <span class="arc-ed-bar-note">{{ 'admin.edit_page.card_leaving' | transloco }}</span>
        } @else {
        @if (!b.hasPages) {
        <button type="button" class="arc-ed-bar-btn" (click)="addCard(b)" [title]="'admin.edit_page.card_add' | transloco: { type: b.typeName }"
            [attr.aria-label]="'admin.edit_page.card_add' | transloco: { type: b.typeName }" data-testid="page-edit-card-add"><i class="bi bi-plus-lg" aria-hidden="true"></i></button>
        }
        @if (b.move; as m) {
        <button type="button" class="arc-ed-bar-btn" (click)="moveCard(b, false)" [disabled]="!m.before" [title]="(m.across ? 'admin.edit_page.row_move_left' : 'admin.edit_page.row_move_up') | transloco"
            [attr.aria-label]="(m.across ? 'admin.edit_page.row_move_left' : 'admin.edit_page.row_move_up') | transloco" data-testid="page-edit-card-before">
            <i class="bi" [class.bi-arrow-left]="m.across" [class.bi-arrow-up]="!m.across" aria-hidden="true"></i></button>
        <button type="button" class="arc-ed-bar-btn" (click)="moveCard(b, true)" [disabled]="!m.after" [title]="(m.across ? 'admin.edit_page.row_move_right' : 'admin.edit_page.row_move_down') | transloco"
            [attr.aria-label]="(m.across ? 'admin.edit_page.row_move_right' : 'admin.edit_page.row_move_down') | transloco" data-testid="page-edit-card-after">
            <i class="bi" [class.bi-arrow-right]="m.across" [class.bi-arrow-down]="!m.across" aria-hidden="true"></i></button>
        }
        @if (b.hasPages) {
        <button type="button" class="arc-ed-bar-btn arc-ed-bar-text" (click)="openCardPage(b)" [title]="'admin.edit_page.card_open_title' | transloco"
            data-testid="page-edit-card-open">{{ 'admin.edit_page.card_open' | transloco }}</button>
        } @else if (!b.locked) {
        <button type="button" class="arc-ed-bar-btn" (click)="removeCard(b)" [title]="'common.actions.remove' | transloco"
            [attr.aria-label]="'common.actions.remove' | transloco" data-testid="page-edit-card-remove"><i class="bi bi-trash" aria-hidden="true"></i></button>
        }
        @if (b.newest) {
        <span class="arc-ed-bar-note">{{ 'admin.edit_page.card_newest' | transloco }}</span>
        }
        }
    </div>
    }
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
export default class PageEditPage implements OnInit, OnDestroy, PageInPlaceHost, HasUnsavedChanges {
    private route = inject(ActivatedRoute);
    private router = inject(Router);
    private document = inject(DOCUMENT);
    private platformId = inject(PLATFORM_ID);
    private sanitizer = inject(DomSanitizer);
    private dialog = inject(MatDialog);
    private notify = inject(NotifyService);
    private confirm = inject(ConfirmService);
    private typesStore = inject(ContentTypesStore);
    private actions = inject(PageCardActions);
    private t = injectT();

    readonly data = new PageEditorData(inject(Injector), pageRefFrom(this.route.snapshot.paramMap));
    readonly panel = new PagePanel();
    readonly phone = signal(false);
    /** The top bar's switch: every part that can be changed outlined, as this person left it. */
    readonly showEditable = signal(readShowEditable());
    /** The outlines that show what can be changed, on the frame's page. */
    private reveal: EditableReveal | null = null;
    /** The outlines move once when the screen opens, not again for another language. */
    private revealedOnce = false;
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
    readonly panelRef = viewChild<PageTextPanelComponent>('panelRef');
    /** The open card's form (VE-D54). */
    readonly cardEditor = viewChild(CreateContentComponent);

    // ── Cards (VE-D53, VE-D54) ─────────────────────────────────────────────
    /** The card whose form the panel shows, or null for the page's own panel. */
    readonly card = signal<CardRef | null>(null);
    /** The cards on the page, read from the frame's marks. */
    readonly cards = signal<PageCard[]>([]);
    readonly changedCards = computed(() => this.cards().filter((card) => card.changed));
    /** The open card was changed elsewhere: its changes stay out of this page's Publish until it is included (VE-D72). */
    readonly cardAside = signal(false);
    private reviews = inject(PageReview);
    private holds = inject(HoldService);
    readonly cardBar = signal<CardBar | null>(null);
    readonly publishing = computed(() => this.panelRef()?.publishing() ?? false);
    /** The one Publish is saving and checking the cards (VE-D53). */
    readonly checking = signal(false);
    /** What the card form in page mode asks of the screen. */
    readonly cardHooks: PageModeHooks = {
        reveal: () => false,
        openPanel: () => this.panel.setOpen(true),
    };
    /** The cards checked by the one Publish, published after the page's words. */
    private toPublish: { card: CardRef; draft: Record<string, any> }[] = [];
    /** Words typed on a card, still being put into its form. */
    private cardSaves = new Set<Promise<void>>();
    private cardsObserver: MutationObserver | null = null;
    private scanTimer: ReturnType<typeof setTimeout> | null = null;
    private barTimer: ReturnType<typeof setTimeout> | null = null;
    private onBar = false;
    private holding = false;
    private releaseTimer: ReturnType<typeof setTimeout> | null = null;

    private inPlace: PageInPlace | null = null;
    private spotEl: HTMLElement | null = null;
    private drawTimer: ReturnType<typeof setTimeout> | null = null;

    readonly pageTitle = computed(() => {
        if (this.data.isHome) return this.t('admin.more_pages.home_page');
        return this.data.isList ? this.t('admin.more_pages.list_page', { type: this.data.fileTitle() }) : this.data.fileTitle();
    });
    /** The panel says it, the same there and on the strip (VE-D70); until it is there the page is opening. */
    readonly status = computed<EditState>(() => {
        if (this.saveError() || this.data.session?.error()) return 'not_saved';
        return this.checking() ? 'publishing' : this.panelRef()?.state() ?? 'published';
    });
    readonly frameUrl = computed<SafeResourceUrl | null>(() => {
        if (!isPlatformBrowser(this.platformId) || this.data.loading() || this.data.loadError()) return null;
        return this.sanitizer.bypassSecurityTrustResourceUrl(pageEditFrameUrl(this.data.page, this.data.lang(), this.data.defaultLang()));
    });
    private readonly views = computed(() => this.data.sections().flatMap((section) => section.areas));

    constructor() {
        // Every save, the screen's own or another editor's, shows on the page (VE-D52).
        effect(() => {
            const views = this.views();
            if (this.drawn()) untracked(() => this.patchPage(views));
        });
        // Someone else's page is drawn with the cards they changed on it, and its own areas only looked at (VE-D72, VE-D79).
        effect(() => {
            const by = this.data.heldBy()?.by ?? null;
            if (!this.drawn()) return;
            untracked(() => {
                this.post({ arcPageCards: 'shows', uid: by });
                this.showReveal();
                if (by) {
                    this.leaveSpot();
                    this.closeBox();
                }
            });
        });
        // The frame draws the open card from its form, as typed (VE-D54).
        effect(() => {
            const card = this.card();
            if (this.drawn()) untracked(() => this.tellFrame(card));
        });
    }

    ngOnInit(): void {
        // The page the editor was opened from counts only when the admin app itself opened on this screen (a click on the site's admin bar), not after other admin pages.
        const view = this.document.defaultView;
        if (isPlatformBrowser(this.platformId) && view?.history?.state?.navigationId === 1) {
            this.openedFrom = siteAddressOpenedFrom(this.document.referrer, view.location.origin);
        }
        const state = view?.history?.state;
        // Back from the classic editor: where this editor was first opened.
        if (view && !this.openedFrom && typeof state?.arcOpenedFrom === 'string') {
            this.openedFrom = siteAddressOpenedFrom(`${view.location.origin}${state.arcOpenedFrom}`, view.location.origin);
        }
        this.openedFromEntries = this.data.isList && state?.arcFrom === 'entries';
        void this.data.load();
        // The card forms need every type, as the entries list loads them.
        if (isPlatformBrowser(this.platformId) && !this.typesStore.items().length) this.typesStore.getAll();
    }

    /** The leave question asks while the open card's form has changes not saved yet. */
    hasUnsavedChanges(): boolean {
        return !!this.card() && (this.cardEditor()?.hasUnsavedChanges() ?? false);
    }

    ngOnDestroy(): void {
        this.inPlace?.detach();
        this.reveal?.detach();
        this.cardsObserver?.disconnect();
        for (const timer of [this.scanTimer, this.barTimer, this.releaseTimer]) if (timer) clearTimeout(timer);
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
        // A wait for an earlier drawing (another language) stops here.
        if (this.drawTimer) clearTimeout(this.drawTimer);
        this.drawTimer = null;
        const doc = this.frameDoc;
        if (!doc || doc.location.href === 'about:blank') return;
        this.inPlace?.detach();
        this.inPlace = new PageInPlace(doc, this);
        this.inPlace.attach();
        this.showReveal();
        doc.defaultView?.addEventListener('scroll', () => this.place(), { passive: true });
        this.drawn.set(false);
        const started = Date.now();
        const wait = () => {
            // The page is drawn when its marks (or, with none, its body) are there.
            const ready = this.data.isList ? listDrawn(doc, Date.now() - started > CARDS_DRAW_WAIT_MS) : !!doc.querySelector('[data-arc-edit]') || (doc.body?.innerText.trim().length ?? 0) > 0;
            if (ready || Date.now() - started > DRAW_WAIT_MS) {
                this.drawn.set(true);
                this.patchPage(this.views());
                this.watchCards(doc);
                // The page opens showing what can be changed on it, once.
                if (!this.revealedOnce) {
                    this.revealedOnce = true;
                    this.reveal?.flash();
                }
                this.tellFrame(this.card());
                if (!this.panel.open()) this.panel.peek(this.document.defaultView?.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false);
                return;
            }
            this.drawTimer = setTimeout(wait, 200);
        };
        wait();
    }

    /** The outlines of what can be changed: the cards alone while someone else holds the page's words. */
    private showReveal(): void {
        const doc = this.frameDoc;
        if (!doc) return;
        const areas = this.data.heldBy() ? '' : '[data-arc-edit]:not([data-arc-fixed]), ';
        this.reveal?.detach();
        this.reveal = new EditableReveal(doc, {
            selector: `${areas}[data-arc-card-id]`,
            outlineSelector: `${areas}[data-arc-card-id]:not(:is(arc-header, arc-footer) *)`,
            // Cards in the header and footer are not edited here (VE-D20).
            skip: (el) => el.hasAttribute('data-arc-card-id') && !el.hasAttribute('data-arc-edit') && !!el.closest('arc-header, arc-footer'),
        });
        this.reveal.attach();
        this.reveal.setShown(this.showEditable());
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
        // The card bar comes back with the next hover.
        if (this.cardBar() && !this.onBar) this.cardBar.set(null);
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
        // Someone else holds the page's words: looked at, not changed.
        if (this.data.heldBy()) return null;
        return this.views().find((view) => view.area.key === key) ?? null;
    }

    typing(view: AreaView | null, el: HTMLElement | null): void {
        this.typingRich.set(view?.area.kind === 'rich');
        // Words typed on a card: the frame does not draw the cards again under the cursor.
        const holding = !!el && !view;
        if (holding !== this.holding) {
            this.holding = holding;
            if (this.releaseTimer) clearTimeout(this.releaseTimer);
            this.releaseTimer = null;
            if (holding) this.post({ arcPageCards: 'hold', on: true });
            // Released once the words reached the form and the form sent them; typing again first keeps it.
            else this.releaseTimer = setTimeout(() => {
                this.releaseTimer = null;
                this.post({ arcPageCards: 'hold', on: false });
            }, 400);
        }
        if (holding) this.cardBar.set(null);
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

    /** Words typed on the page and not stored, by language and area: until their save lands, and after one failed. */
    private readonly unsavedWords = new Map<string, string>();

    private async run(save: () => Promise<void>, words?: { id: string; value: string }): Promise<void> {
        this.saving.update((n) => n + 1);
        if (words) this.unsavedWords.set(words.id, words.value);
        const stored = () => {
            if (words && this.unsavedWords.get(words.id) === words.value) this.unsavedWords.delete(words.id);
        };
        try {
            await save();
            stored();
            this.saveError.set('');
        } catch (error: any) {
            // Someone else made the first change: the bar says who, and the page shows theirs.
            if (isHeld(error)) return stored();
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
        }, { id: `${lang}:${view.area.key}`, value: trimmed });
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
        // The open card's form follows the page's language.
        const editor = this.cardEditor();
        if (this.card() && editor) void editor.switchLanguage(code);
    }

    /**
     * Live Preview: the page in a window of its own, drawn with the draft and the changed
     * cards, following each save. The window is the classic editor's for this page, so
     * either editor brings the same one forward.
     */
    openPreview(): void {
        const win = this.document.defaultView?.open(pageLivePreviewUrl(this.data.page, this.data.lang(), this.data.defaultLang()), `arc-page-preview-${this.data.pageId}`);
        win?.focus();
    }

    /** The classic editor of the same page: the same draft, the typing saved first. */
    async toClassic(): Promise<void> {
        this.leaveSpot();
        if (!(await this.saveCard())) return;
        // Where this editor was opened from goes along, for its Close once it is opened from there.
        const from = {
            ...(this.openedFromEntries ? { arcFrom: 'entries' } : {}),
            ...(this.openedFrom ? { arcOpenedFrom: this.openedFrom } : {}),
        };
        void this.router.navigate(classicEditorLink(this.data.page), ...(Object.keys(from).length ? [{ state: from }] : []));
    }

    /** Where the editor was opened from when that was the site's own page (the admin bar's Edit link), else ''. */
    private openedFrom = '';
    /** A list page's editor opened from its type's entries: Close goes back to them. */
    private openedFromEntries = false;

    /** Close goes back to where the editor was opened: the page on the site, else More Pages. */
    async close(): Promise<void> {
        this.leaveSpot();
        if (!(await this.saveCard())) return;
        if (this.openedFrom) {
            this.document.defaultView?.location.assign(this.openedFrom);
            return;
        }
        void this.router.navigate(this.openedFromEntries ? ['/admin/contents', this.data.name] : ['/admin/more-pages']);
    }

    /** Add new (VE-D62): the open card and the words saved first. */
    async addEntry(): Promise<void> {
        this.leaveSpot();
        if (!(await this.saveCard())) return;
        void this.router.navigate(['/admin/edit', this.data.name, 'new']);
    }

    /** The list page's type, one entry of it. */
    singularTitle(): string {
        const type = this.typeOf(this.data.name);
        return (type && contentTypeSingularName(type)) || this.data.fileTitle();
    }

    /**
     * Before the one Publish (VE-D53): what is typed is saved, the open card's
     * form too, then every card shown with unpublished changes is read and
     * checked as the entry editor checks (required fields, an address, text
     * still to replace). If anything fails nothing is published, and that card
     * opens on the field.
     */
    readonly beforePublish = async (): Promise<boolean> => {
        this.toPublish = [];
        this.leaveSpot();
        await Promise.all([...this.cardSaves]);
        const open = this.card();
        if (!(await this.saveCard())) return false;
        while (this.saving() > 0) await new Promise((resolve) => setTimeout(resolve, 50));
        if (this.saveError()) return false;
        this.card.set(null);

        // The cards shown with changes, and the card just saved, which the frame may not have marked yet.
        const shown = this.cards().filter((card) => !card.leaving);
        const candidates = [...this.changedCards()];
        if (open && shown.some((card) => card.type === open.type && card.id === open.id) && !candidates.some((c) => c.type === open.type && c.id === open.id)) {
            candidates.push({ ...open, changed: true, leaving: false });
        }
        let read: { card: CardRef; draft: Record<string, any> | null }[];
        try {
            read = await Promise.all(candidates.map(async (card) => ({ card: { type: card.type, id: card.id }, draft: await this.actions.read(card) })));
        } catch (error: any) {
            console.error('[PageEdit] Could not read the cards:', error);
            this.notify.error('admin.edit_page.cards_not_read');
            return false;
        }
        const toPublish = read.filter((each): each is { card: CardRef; draft: Record<string, any> } =>
            !!each.draft && isPageChange(each.draft, this.data.pageId, this.holds.me()?.uid ?? null));

        for (const each of toPublish) {
            const type = this.typeOf(each.card.type);
            const problem = type ? cardProblem(each.draft, type) : null;
            if (!problem) continue;
            const field = problem.field === 'title' ? this.t('admin.contents.editor.title_label')
                : problem.field === 'urlSlug' ? this.t('admin.edit_page.card_address') : this.fieldName(type!, problem.field);
            this.notify.error('admin.edit_page.card_problem', { type: this.typeName(each.card.type), field });
            this.openCard(each.card, problem.field === 'urlSlug' ? null : problem.field, 'failed');
            return false;
        }

        const replace = toPublish.find((each) => cardHasReplace(each.draft));
        const pageChanged = !this.data.heldBy() && this.panelRef()?.status() === 'changes';
        if (replace || (pageChanged && pageValuesHaveReplace(this.data.draft()))) {
            const ok = await this.confirm.ask({
                titleKey: 'admin.contents.editor.replace_prompt_title',
                dialogMessage: this.t('admin.contents.editor.replace_prompt_confirm'),
                btnText: this.t('admin.contents.editor.publish_anyway'),
            });
            if (!ok) {
                if (replace) this.openCard(replace.card, null, 'failed');
                return false;
            }
        }
        this.toPublish = toPublish;
        return true;
    };

    /** The one Publish (VE-D53): the page's words and SEO when they changed, then each card checked. */
    readonly publishWith = async (): Promise<void> => {
        const session = this.data.session;
        // Someone else's words stay theirs to publish; this person's cards on the page go out.
        if (session && !this.data.heldBy() && this.panelRef()?.status() === 'changes') await session.publish();
        const cards = this.toPublish;
        this.toPublish = [];
        const failed: string[] = [];
        for (const each of cards) {
            try {
                // False: saved or unpublished by someone since it was checked; Publish again checks it anew.
                if (!(await this.actions.publish(each.card, each.draft, this.data.pageId))) failed.push(String(each.draft['title'] || each.card.id));
            } catch (error) {
                console.error('[PageEdit] Could not publish a card:', error);
                failed.push(String(each.draft['title'] || each.card.id));
            }
        }
        const done = cards.length - failed.length;
        if (done) this.notify.success('admin.edit_page.cards_published', { count: done });
        // The panel shows it: the page's words (and the cards before) went out, these did not.
        if (failed.length) throw new Error(this.t('admin.edit_page.cards_publish_failed', { cards: failed.join(', ') }));
    };

    async publish(): Promise<void> {
        const panel = this.panelRef();
        if (!panel || this.checking()) return;
        this.panel.setOpen(true);
        this.checking.set(true);
        try {
            await panel.publish();
        } finally {
            this.checking.set(false);
        }
    }

    // ── Cards (VE-D54) ─────────────────────────────────────────────────────

    private post(message: PageCardsMessage): void {
        const win = this.frame?.nativeElement.contentWindow;
        if (win) win.postMessage(message, this.document.defaultView?.location.origin ?? '*');
    }

    /** The frame draws the open card from its form, and outlines it. */
    private tellFrame(card: CardRef | null): void {
        this.post({ arcPageCards: 'focus', focus: card });
        this.decorateCards();
    }

    /** Follows the cards the frame marks, as they are drawn again. */
    private watchCards(doc: Document): void {
        this.cardsObserver?.disconnect();
        let replaced = false;
        const scan = () => {
            this.scanTimer = null;
            if (this.frameDoc !== doc) return;
            const cards = pageCardsIn(doc);
            if (JSON.stringify(cards) !== JSON.stringify(this.cards())) this.cards.set(cards);
            // Said again as cards are drawn: the first may come before the frame listens.
            this.post({ arcPageCards: 'shows', uid: this.data.heldBy()?.by ?? null });
            this.decorateCards();
            // A list page's cards and areas are one template: drawing the cards draws the areas too.
            if (replaced && this.redrawn(doc)) replaced = false;
        };
        const view = doc.defaultView as (Window & typeof globalThis) | null;
        if (!view?.MutationObserver || !doc.body) return;
        this.cardsObserver = new view.MutationObserver((records) => {
            if (this.data.isList && records?.some(listReplaced)) replaced = true;
            if (!this.scanTimer) this.scanTimer = setTimeout(scan, 120);
        });
        this.cardsObserver.observe(doc.body, {
            childList: true, subtree: true, attributes: true, attributeFilter: ['data-arc-card-id', 'data-arc-changed', 'data-arc-leaving', 'data-arc-held', 'data-arc-elsewhere', 'data-arc-theirs'],
        });
        scan();
    }

    /** The areas drawn again with the list's cards: their values put back, and the open box kept by its area. */
    private redrawn(doc: Document): boolean {
        // Not while another language is being drawn: its values are not this page's.
        const at = doc.location;
        if (!this.drawn() || `${at?.pathname}${at?.search}` !== pageEditFrameUrl(this.data.page, this.data.lang(), this.data.defaultLang())) return false;
        this.patchPage(this.views());
        const box = this.box();
        if (!box || box.el.isConnected) return true;
        const el = doc.querySelector<HTMLElement>(`[data-arc-edit="${cssEscape(box.view.area.key)}"]`);
        if (el) this.box.set({ ...box, el, ...this.boxPlace(el) });
        else this.closeBox();
        return true;
    }

    /** Puts the areas' values on the page; words not saved (on their way, or refused by a failure) stay as they were typed. */
    private patchPage(views: AreaView[]): void {
        const lang = this.data.lang();
        const unsaved = this.data.heldBy() ? null : this.unsavedWords;
        this.inPlace?.patch(!unsaved?.size ? views : views.map((view) => {
            const typed = unsaved.get(`${lang}:${view.area.key}`);
            return typed === undefined ? view : { ...view, words: typed };
        }));
    }

    /** The note on a card (Publish would push it out, or it is not this person's to publish here), and the outline on the open card. */
    private decorateCards(): void {
        const doc = this.frameDoc;
        if (!doc) return;
        const noteOf = (el: HTMLElement): string => {
            if (el.hasAttribute('data-arc-leaving')) return this.t('admin.edit_page.card_leaving');
            const held = el.getAttribute('data-arc-held');
            if (held) return this.t('admin.hold.card_held', { name: held });
            return el.hasAttribute('data-arc-elsewhere') ? this.t('admin.hold.card_elsewhere') : '';
        };
        const open = this.card();
        for (const el of Array.from(doc.querySelectorAll<HTMLElement>('[data-arc-card-id]'))) {
            const note = noteOf(el);
            if (note) {
                if (el.getAttribute('data-arc-note') !== note) el.setAttribute('data-arc-note', note);
            } else if (el.hasAttribute('data-arc-note')) {
                el.removeAttribute('data-arc-note');
            }
            const isOpen = !!open && el.getAttribute('data-arc-card-type') === open.type && el.getAttribute('data-arc-card-id') === open.id;
            if (isOpen !== el.hasAttribute('data-arc-card-open')) el.toggleAttribute('data-arc-card-open', isOpen);
        }
    }

    typeOf(slug: string): ContentType | null {
        return (this.typesStore.items() as ContentType[]).find((type) => type.slug === slug) ?? null;
    }

    typeName(slug: string): string {
        return this.typeOf(slug)?.name || this.data.cardTypes().get(slug)?.name || slug;
    }

    private fieldName(type: ContentType, key: string): string {
        return (type.fields || []).find((field) => field.key === key)?.label || key;
    }

    /** A card's element in the frame. */
    private cardElement(card: CardRef): HTMLElement | null {
        return this.frameDoc?.querySelector<HTMLElement>(`[data-arc-card-type="${cssEscape(card.type)}"][data-arc-card-id="${cssEscape(card.id)}"]`) ?? null;
    }

    /** One entry of a type, in a sentence. */
    singularName(slug: string): string {
        const type = this.typeOf(slug);
        return inSentenceName(type?.singularName || type?.name || this.typeName(slug));
    }

    /** A card someone else holds, or changed elsewhere: its form first, so what would go out is seen (VE-D72). */
    private cardNotHere(card: CardRef): boolean {
        const el = this.cardElement(card);
        return !!el && (el.hasAttribute('data-arc-held') || el.hasAttribute('data-arc-elsewhere') || el.hasAttribute('data-arc-theirs'));
    }

    /** Publish with this page (VE-D72). */
    async includeCard(card: CardRef): Promise<void> {
        if (!(await this.saveCard())) return;
        try {
            await this.actions.include(card, this.data.pageId);
            this.cardAside.set(false);
        } catch (error) {
            console.error('[PageEdit] Could not include the card:', error);
            this.notify.error('admin.edit_page.card_not_saved');
        }
    }

    /** Review changes (VE-D80): someone else's page with the cards they changed on it, or this person's own. */
    review(): void {
        const hold = this.data.heldBy();
        const cards: ReviewCard[] = !hold ? [] : this.cards().filter((card) => card.theirs)
            .map((card) => ({ type: card.type, id: card.id, name: this.cardName(card), take: true }));
        void this.reviews.open(this.data, this.pageTitle(), {
            cards,
            flush: async () => {
                this.leaveSpot();
                await this.panelRef()?.flush();
                while (this.saving() > 0) await new Promise((resolve) => setTimeout(resolve, 50));
                return !this.saveError();
            },
            publish: (chosen) => (hold ? this.publishTheirs(chosen) : this.publish()),
            takeCards: async (chosen) => {
                for (const card of chosen) if (hold) await this.actions.takeOver(card, hold.by);
            },
            show: (change) => this.showChange(change),
            kept: () => this.panelRef()?.keptChanged.update((n) => n + 1),
        });
    }

    /** Someone else's words as they are, and their cards chosen, through the same checks (VE-D80). */
    private async publishTheirs(cards: readonly ReviewCard[]): Promise<void> {
        const read: { card: ReviewCard; draft: Record<string, any> }[] = [];
        try {
            for (const card of cards) {
                const draft = await this.actions.read(card);
                if (draft) read.push({ card, draft });
            }
        } catch (error) {
            console.error('[PageEdit] Could not read the cards:', error);
            this.notify.error('admin.edit_page.cards_not_read');
            return;
        }
        for (const { card, draft } of read) {
            const type = this.typeOf(card.type);
            const problem = type ? cardProblem(draft, type) : null;
            if (!problem) continue;
            this.notify.error('admin.edit_page.card_problem', { type: this.typeName(card.type), field: problem.field === 'title' ? this.t('admin.contents.editor.title_label') : this.fieldName(type!, problem.field) });
            return;
        }
        // The page's own words are asked about by the review; the cards here.
        if (read.some(({ draft }) => cardHasReplace(draft))) {
            const ok = await this.confirm.ask({
                titleKey: 'admin.contents.editor.replace_prompt_title',
                dialogMessage: this.t('admin.contents.editor.replace_prompt_confirm'),
                btnText: this.t('admin.contents.editor.publish_anyway'),
            });
            if (!ok) return;
        }
        await this.panelRef()?.publishWords();
        const failed: string[] = [];
        for (const { card } of read) {
            try {
                await this.actions.publishTheirs(card);
            } catch (error) {
                console.error('[PageEdit] Could not publish a card:', error);
                failed.push(card.name);
            }
        }
        if (failed.length) this.notify.error('admin.edit_page.cards_publish_failed', { cards: failed.join(', ') });
    }

    /** A card's name in a list: its title as the page shows it, else its type. */
    private cardName(card: CardRef): string {
        const el = this.cardElement(card);
        const title = el?.querySelector('[data-arc-sub="title"], h1, h2, h3, h4, h5')?.textContent?.trim();
        return title ? `${this.typeName(card.type)}: ${title}` : this.typeName(card.type);
    }

    /** Show: a change's place on the page, or the panel for what the page does not show. */
    private showChange(change: Change): void {
        if (change.lang && change.lang !== this.data.lang()) this.switchLanguage(change.lang);
        const key = change.field.replace(/^(text|url):/, '');
        const el = this.frameDoc?.querySelector<HTMLElement>(`[data-arc-edit="${cssEscape(key)}"]`);
        if (!el || key === change.field) {
            this.panel.setOpen(true);
            // A list page's own search words are in SEO; its title and summary in Basic (VE-D69).
            this.panelRef()?.showTab(this.data.isList && change.field.startsWith('seo:') ? 'seo' : 'basic');
            return;
        }
        el.scrollIntoView?.({ block: 'center' });
        el.setAttribute('data-arc-pv-highlight', '');
        setTimeout(() => el.removeAttribute('data-arc-pv-highlight'), 2000);
    }

    cardText(card: CardRef, sub: string): string | null {
        if (this.cardNotHere(card)) return null;
        const type = this.typeOf(card.type);
        const resolved = resolvePreviewField(sub, type);
        if (!type || !resolved) return null;
        const field = resolved.field;
        // The value is the field itself, not one made from it (an excerpt, a formatted date).
        const exact = sub === field || field === `${type.slug}-${sub}` || field === `${type.slug}_${sub}`;
        if (!exact) return null;
        if (resolved.builtin) return field === 'title' || field === 'summary' ? field : null;
        return (type.fields || []).find((f) => f.key === field)?.type === 'text' ? field : null;
    }

    /**
     * Opens a card's form in the panel (VE-D54), saving the open one first; on
     * `field` when a value of the card was clicked, or a check failed on it.
     */
    openCard(card: CardRef, sub: string | null, how: boolean | 'failed' = false): void {
        const typing = how === true;
        const failed = how === 'failed';
        this.cardBar.set(null);
        const open = this.card();
        const same = !!open && open.type === card.type && open.id === card.id;
        const go = async () => {
            if (!same) {
                if (!(await this.saveCard())) return;
                // Changed elsewhere, or held by someone else now: what it holds is looked through before it goes out from here.
                const el = this.cardElement(card);
                this.cardAside.set(!!el && (el.hasAttribute('data-arc-elsewhere') || el.hasAttribute('data-arc-held')));
                this.card.set(card);
            }
            // Words typed on the card: its form loads in the panel without covering the card.
            if (!typing) this.panel.setOpen(true);
            const editor = await this.cardEditorFor(card);
            if (!editor) return;
            const lang = this.data.lang();
            if (lang && lang !== this.data.defaultLang() && editor.session.activeLang() !== lang) await editor.switchLanguage(lang);
            const field = sub ? (resolvePreviewField(sub, this.typeOf(card.type))?.field ?? sub) : null;
            if (field === 'title' && failed) this.showCard(card);
            else if (field) editor.focusField(field);
        };
        void go();
    }

    /** The card scrolled into view and outlined for a moment. */
    private showCard(card: CardRef): void {
        const el = this.cardElement(card);
        if (!el) return;
        el.scrollIntoView?.({ block: 'center' });
        el.setAttribute('data-arc-pv-highlight', '');
        setTimeout(() => el.removeAttribute('data-arc-pv-highlight'), 2000);
    }

    /** The open card's form once it has loaded that card; null when it does not in time. */
    private async cardEditorFor(card: CardRef): Promise<CreateContentComponent | null> {
        const started = Date.now();
        while (Date.now() - started < CARD_WAIT_MS) {
            const editor = this.cardEditor();
            const open = this.card();
            if (!open || open.type !== card.type || open.id !== card.id) return null;
            if (editor && editor.contentId === card.id && editor.publishForm && editor.pageTitle) return editor;
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
        return null;
    }

    /** Words typed on a card go into its form, as its own box would take them. */
    saveCardText(card: CardRef, field: string, value: string): void {
        const save = (async () => {
            const editor = await this.cardEditorFor(card);
            if (!editor) {
                this.notify.error('admin.edit_page.card_not_saved');
                return;
            }
            // Words typed on a translated page belong to that language, never the default one.
            const lang = this.data.lang();
            if (lang && lang !== this.data.defaultLang() && editor.session.activeLang() !== lang) await editor.switchLanguage(lang);
            if (field === 'title') {
                editor.pageTitle = value;
                editor.createSlag();
            } else if (field === 'summary') {
                editor.publishForm?.get('summary')?.setValue(value);
            } else {
                editor.onCustomFieldChange(field, value);
                return;
            }
            editor.triggerAutoSave();
        })();
        this.cardSaves.add(save);
        void save.finally(() => this.cardSaves.delete(save));
    }

    /** Saves the open card's form when it has anything to save; false when that did not land. */
    private async saveCard(): Promise<boolean> {
        const editor = this.cardEditor();
        if (!this.card() || !editor) return true;
        await Promise.all([...this.cardSaves]);
        if (editor.hasUnsavedChanges()) await editor.saveAsDraft();
        if (editor.hasUnsavedChanges()) {
            this.panel.setOpen(true);
            return false;
        }
        return true;
    }

    /** Back to page: the card's form saved, the page's own panel again. */
    async backToPage(): Promise<void> {
        if (await this.saveCard()) this.card.set(null);
    }

    /**
     * A click on the page that opens nothing: a note by the click says the design fixes
     * it, and the parts that can be changed move. A click that puts a box away only does that.
     */
    fixedClick(target: Element, x: number, y: number): void {
        if (this.box()) {
            this.closeBox();
            return;
        }
        const hold = this.data.heldBy();
        this.reveal?.explainFixed(target, x, y, {
            lead: hold && target.closest('[data-arc-edit]') ? this.t('admin.hold.card_held', { name: hold.name || '?' }) : this.t('admin.edit_page.fixed_text'),
            outlined: this.t('admin.edit_page.fixed_outlined'),
            scroll: this.t('admin.edit_page.fixed_scroll'),
        });
    }

    /** The top bar's switch: every part that can be changed outlined, or not. */
    toggleShowEditable(): void {
        const on = !this.showEditable();
        this.showEditable.set(on);
        writeShowEditable(on);
        this.reveal?.setShown(on);
    }

    cardHover(el: HTMLElement | null): void {
        if (this.barTimer) clearTimeout(this.barTimer);
        this.barTimer = null;
        if (!el) {
            this.barTimer = setTimeout(() => {
                if (!this.onBar) this.cardBar.set(null);
            }, 400);
            return;
        }
        if (this.inPlace?.typingCard) return;
        const found = cardOf(el);
        if (!found) return;
        const type = this.typeOf(found.card.type);
        const rect = this.rectOf(el);
        const leaving = el.hasAttribute('data-arc-leaving');
        let move: CardBar['move'] = null;
        if (type?.entryOrder === 'manual' && !leaving) {
            const block = el.closest('arc-content-partials, arc-content-list');
            const inBlock = Array.from(block?.querySelectorAll<HTMLElement>('[data-arc-card-id]:not([data-arc-leaving])') ?? []).filter((card) => cardOf(card));
            const at = inBlock.indexOf(el);
            const before = inBlock[at - 1] ?? null;
            const after = inBlock[at + 1] ?? null;
            const other = before ?? after;
            const across = !!other && Math.abs(other.getBoundingClientRect().top - el.getBoundingClientRect().top) < 8;
            move = { before: before?.getAttribute('data-arc-card-id') ?? null, after: after?.getAttribute('data-arc-card-id') ?? null, across };
        }
        this.cardBar.set({
            card: found.card,
            top: Math.max(rect.top - 30, 44),
            // The bar's right edge on the card's (it is drawn leftwards, as the row bar), inside the window.
            left: Math.min(Math.max(rect.right, CARD_BAR_WIDTH), window.innerWidth - 8),
            hasPages: type ? type.hasPublicUrl !== false : true,
            move,
            newest: !!type && type.entryOrder !== 'manual',
            leaving,
            locked: el.hasAttribute('data-arc-held') || el.hasAttribute('data-arc-theirs'),
            typeName: this.typeName(found.card.type),
        });
    }

    barHovered(on: boolean): void {
        this.onBar = on;
        if (!on) this.cardHover(null);
    }

    /** Add (VE-D54): a new draft of the type in the block, opened in the panel. */
    async addCard(bar: CardBar): Promise<void> {
        const type = this.typeOf(bar.card.type);
        if (!type) return;
        this.cardBar.set(null);
        if (!(await this.saveCard())) return;
        try {
            const title = `[Replace: ${this.t('admin.edit_page.card_new_title', { type: inSentenceName(bar.typeName) })}]`;
            const id = await this.actions.add(type, this.data.pageId, title, bar.card.id);
            this.openCard({ type: type.slug, id }, null);
        } catch (error) {
            console.error('[PageEdit] Could not add a card:', error);
            this.notify.error('admin.edit_page.card_add_failed');
        }
    }

    /** Remove (VE-D54): after asking, the card leaves the page; it is unpublished, never deleted. */
    async removeCard(bar: CardBar): Promise<void> {
        this.cardBar.set(null);
        const ok = await this.confirm.ask({
            titleKey: 'admin.edit_page.card_remove_title',
            dialogMessage: this.t('admin.edit_page.card_remove_confirm', { type: bar.typeName }),
            btnText: this.t('common.actions.remove'),
            panelType: 'warn',
        });
        if (!ok) return;
        const open = this.card();
        if (open && open.type === bar.card.type && open.id === bar.card.id) {
            if (!(await this.saveCard())) return;
            this.card.set(null);
        }
        try {
            await this.actions.remove(bar.card);
            this.notify.success('admin.edit_page.card_removed');
        } catch (error) {
            console.error('[PageEdit] Could not remove the card:', error);
            this.notify.error('admin.edit_page.card_remove_failed');
        }
    }

    /** Move (VE-D54): beside its neighbour on the page, saved and republished as Arrange does. */
    async moveCard(bar: CardBar, after: boolean): Promise<void> {
        const neighbour = after ? bar.move?.after : bar.move?.before;
        if (!neighbour) return;
        this.cardBar.set(null);
        try {
            await this.actions.move(bar.card, neighbour, after);
            this.post({ arcPageCards: 'reorder', type: bar.card.type });
        } catch (error) {
            console.error('[PageEdit] Could not move the card:', error);
            this.notify.error('admin.edit_page.card_move_failed');
        }
    }

    /** Open (VE-D54): a card with a page of its own, in its own Visual Editor. */
    async openCardPage(bar: CardBar): Promise<void> {
        this.leaveSpot();
        if (!(await this.saveCard())) return;
        void this.router.navigate(['/admin/edit', bar.card.type, bar.card.id]);
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
