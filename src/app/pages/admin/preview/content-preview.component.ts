/**
 * The live preview window, /admin/preview/:type/:id (specs/visual-editing-spec.md,
 * VE1 and VE2).
 *
 * The editor opens it with Preview and sends its unsaved draft over the preview
 * channel (core/preview/preview-channel.ts) as it changes; this page draws it with
 * the site's own content page (ContentDetailComponent, fed by PreviewSession as its
 * DetailSource), so it looks as the published page will, with click to field (VE-D8).
 *
 * Its address starts with /admin, but nothing of the admin is on screen: the
 * site's header, footer and stylesheets are, and a thin strip says what it is.
 * Links open in a new tab and forms never send (VE-D9). Without an editor it
 * shows the saved draft (VE-D6).
 */
import { DOCUMENT, isPlatformBrowser } from '@angular/common';
import {
    ChangeDetectionStrategy, Component, DestroyRef, ElementRef, OnInit, PLATFORM_ID, ViewEncapsulation, computed, effect, inject, signal, untracked,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { ContentDetailComponent } from '../../page.parts/content-detail.component';
import { DetailSource } from '../../page.parts/detail-source';
import { PreviewSession } from './preview-session';
import { PreviewChannel, PreviewMessage, resolvePreviewField, sessionKeyFromFragment } from '../../../core/preview/preview-channel';
import { ContentTypesStore } from '../contents/content-types/content-types.store';
import { ContentType, contentTypeFieldLabel } from '../contents/content-types/content-types.model';
import { DraftContentsService } from '../contents/draft-content-store/draft-contents.service';
import { LocalizationService } from '../../../core/services/localization.service';
import { QueryParams } from '../../../../shared/models/queries.model';

/** How long the page waits for the editor before showing the saved draft. */
const EDITOR_WAIT_MS = 1200;
/** How long a field stays outlined after it is focused in the editor. */
const HIGHLIGHT_MS = 2000;

export type PreviewStatus = 'waiting' | 'connected' | 'closed' | 'saved' | 'missing';

/** The built-in fields' names in the admin language, for "Title is ready in the editor". */
const BUILTIN_LABELS: Record<string, string> = {
    title: 'admin.preview.fields.title',
    content: 'admin.preview.fields.content',
    summary: 'admin.preview.fields.summary',
    coverImage: 'admin.preview.fields.coverImage',
    tags: 'admin.preview.fields.tags',
    seoTitle: 'admin.preview.fields.seoTitle',
    metaDescription: 'admin.preview.fields.metaDescription',
    canonicalUrl: 'admin.preview.fields.canonicalUrl',
    references: 'admin.preview.fields.references',
    authorId: 'admin.preview.fields.authorId',
    layout: 'admin.preview.fields.layout',
};

@Component({
    selector: 'arc-content-preview',
    standalone: true,
    imports: [ContentDetailComponent, TranslocoPipe],
    providers: [
        PreviewSession,
        { provide: DetailSource, useExisting: PreviewSession },
    ],
    template: `
    <div class="arc-pv-strip" role="region" [attr.aria-label]="'admin.preview.strip' | transloco" data-testid="preview-strip">
        <span class="arc-pv-title">{{ (status() === 'saved' ? 'admin.preview.strip_saved' : 'admin.preview.strip') | transloco }}</span>
        @if (languageLabel()) {
        <span class="arc-pv-chip" [title]="'admin.preview.language' | transloco">{{ languageLabel() }}</span>
        }
        <span class="arc-pv-spacer"></span>
        <span class="arc-pv-widths" role="group" [attr.aria-label]="'admin.preview.width' | transloco">
            <button type="button" class="arc-pv-btn" [class.arc-pv-on]="!phone()" [attr.aria-pressed]="!phone()" (click)="phone.set(false)">{{ 'admin.preview.full_width' | transloco }}</button>
            <button type="button" class="arc-pv-btn" [class.arc-pv-on]="phone()" [attr.aria-pressed]="phone()" (click)="phone.set(true)" data-testid="preview-phone">{{ 'admin.preview.phone' | transloco }}</button>
        </span>
        <span class="arc-pv-status" [class.arc-pv-live]="status() === 'connected'" role="status" data-testid="preview-status">{{ statusKey() | transloco }}</span>
    </div>
    @if (note()) {
    <div class="arc-pv-note" role="status" data-testid="preview-note">{{ note() }}</div>
    }
    <div class="arc-pv-frame" [class.arc-pv-phone]="phone()">
        @if (ready()) {
        <arc-content-detail />
        } @else if (status() === 'missing') {
        <p class="arc-pv-empty">{{ 'admin.preview.missing' | transloco }}</p>
        } @else {
        <p class="arc-pv-empty">{{ 'admin.preview.waiting' | transloco }}</p>
        }
    </div>
    `,
    styles: [`
        arc-content-preview { display: block; min-height: 100vh; }
        .arc-pv-strip {
            position: sticky; top: 0; z-index: 2147483000;
            display: flex; align-items: center; flex-wrap: wrap; gap: 8px;
            padding: 6px 12px; margin: 0;
            background: #1f2937; color: #f9fafb;
            font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
            box-shadow: 0 1px 4px rgba(0, 0, 0, .25);
        }
        .arc-pv-title { font-weight: 600; }
        .arc-pv-chip {
            padding: 1px 8px; border-radius: 999px; background: #374151; color: #f9fafb; font-weight: 500;
        }
        .arc-pv-spacer { flex: 1 1 auto; }
        .arc-pv-widths { display: inline-flex; gap: 2px; }
        .arc-pv-btn {
            font: inherit; color: #f9fafb; background: transparent; cursor: pointer;
            border: 1px solid #4b5563; border-radius: 6px; padding: 2px 10px; margin: 0; line-height: 1.4;
        }
        .arc-pv-btn:hover { background: #374151; }
        .arc-pv-btn.arc-pv-on { background: #f9fafb; color: #1f2937; border-color: #f9fafb; }
        .arc-pv-status { padding: 1px 8px; border-radius: 999px; background: #4b5563; }
        .arc-pv-status.arc-pv-live { background: #15803d; }
        .arc-pv-note {
            position: fixed; z-index: 2147483000; top: 48px; right: 16px; max-width: 320px;
            padding: 8px 12px; border-radius: 8px; background: #1f2937; color: #f9fafb;
            font: 500 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
            box-shadow: 0 4px 12px rgba(0, 0, 0, .25);
        }
        .arc-pv-frame.arc-pv-phone {
            max-width: 390px; margin: 16px auto; overflow-x: hidden;
            box-shadow: 0 0 0 1px #d1d5db, 0 8px 24px rgba(0, 0, 0, .12);
        }
        .arc-pv-empty { padding: 48px 16px; text-align: center; color: #6b7280; font: 15px/1.5 system-ui, sans-serif; }
        arc-content-preview [data-arc-field] { cursor: pointer; }
        arc-content-preview [data-arc-pv-highlight] { outline: 3px solid var(--arc-admin-accent) !important; outline-offset: 2px; }
    `],
    changeDetection: ChangeDetectionStrategy.OnPush,
    encapsulation: ViewEncapsulation.None,
})
export class ContentPreviewComponent implements OnInit {
    readonly session = inject(PreviewSession);
    private route = inject(ActivatedRoute);
    private document = inject(DOCUMENT);
    private host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
    private platformId = inject(PLATFORM_ID);
    private destroyRef = inject(DestroyRef);
    private transloco = inject(TranslocoService);
    private typesStore = inject(ContentTypesStore);
    private drafts = inject(DraftContentsService);
    private localization = inject(LocalizationService);

    private channel: PreviewChannel | null = null;
    readonly status = signal<PreviewStatus>('waiting');
    readonly phone = signal(false);
    /** "Also on: Home page" pressed: the home page instead of the entry's own page. */
    readonly showHome = signal(false);
    readonly note = signal('');

    /** The type, kept once read: a store reload never blanks the page. */
    private typeSeen: ContentType | null = null;
    readonly type = computed<ContentType | null>(() => {
        const found = this.typesStore.items().find((t: ContentType) => t.slug === this.session.type) || null;
        if (found) this.typeSeen = found;
        return found ?? this.typeSeen;
    });
    readonly lang = computed(() => this.session.live()?.lang || '');

    /** The page is drawn once there is a draft and its type. */
    readonly ready = computed(() => !!this.type() && !!this.session.live());

    readonly languageLabel = computed(() => {
        const lang = this.lang();
        if (!lang || !this.localization.isMultilingual()) return '';
        return this.localization.find(lang)?.label || lang;
    });

    readonly statusKey = computed(() => ({
        waiting: 'admin.preview.waiting_short',
        connected: 'admin.preview.connected',
        closed: 'admin.preview.editor_closed',
        saved: 'admin.preview.saved_copy',
        missing: 'admin.preview.editor_closed',
    } as const)[this.status()]);

    constructor() {
        // Each draw: back to where the editor was reading.
        effect(() => {
            this.session.live();
            untracked(() => this.afterDraw());
        });
    }

    ngOnInit(): void {
        this.typesStore.getAll({
            whereConditions: [{ field: 'slug', operator: '==', value: this.session.type }],
            orderByField: 'slug',
            orderByDirection: 'asc',
            limitCount: 1,
        } as QueryParams);
        if (!isPlatformBrowser(this.platformId)) return;
        void this.localization.load();

        const key = sessionKeyFromFragment(this.route.snapshot.fragment ?? this.document.location?.hash);
        this.channel = new PreviewChannel(key, (message) => this.onMessage(message));
        this.channel.post({ kind: 'hello' });
        const wait = setTimeout(() => void this.showSavedDraft(), EDITOR_WAIT_MS);

        const onClick = (event: MouseEvent) => this.onClick(event);
        const onSubmit = (event: Event) => { event.preventDefault(); event.stopPropagation(); };
        const onLeave = () => this.channel?.post({ kind: 'bye', from: 'preview' });
        this.document.addEventListener('click', onClick, true);
        this.document.addEventListener('submit', onSubmit, true);
        this.document.defaultView?.addEventListener('pagehide', onLeave);
        this.destroyRef.onDestroy(() => {
            clearTimeout(wait);
            clearTimeout(this.noteTimer);
            onLeave();
            this.channel?.close();
            this.document.removeEventListener('click', onClick, true);
            this.document.removeEventListener('submit', onSubmit, true);
            this.document.defaultView?.removeEventListener('pagehide', onLeave);
        });
    }

    onMessage(message: PreviewMessage): void {
        switch (message.kind) {
            case 'state':
                this.scrollToKeep = this.document.defaultView?.scrollY ?? 0;
                this.status.set('connected');
                this.session.live.set({ content: message.draft, lang: message.lang, translation: message.translation });
                break;
            case 'highlight':
                this.highlight(message.key);
                break;
            case 'bye':
                if (message.from === 'editor' && this.status() === 'connected') this.status.set('closed');
                break;
            default:
                break;
        }
    }

    /** Opened without an editor (a bookmark, a reload): the saved draft, once (VE-D6). */
    private async showSavedDraft(): Promise<void> {
        if (this.session.live()) return;
        const draft = this.session.id ? await this.drafts.getDraftById(this.session.type, this.session.id).catch(() => null) : null;
        // An editor may have answered meanwhile; its draft is newer.
        if (this.session.live()) return;
        if (!draft) {
            this.status.set('missing');
            return;
        }
        this.status.set('saved');
        this.session.live.set({ content: draft as unknown as Record<string, any>, lang: '', translation: null });
    }

    /** The scroll position when the last draft arrived, kept across the redraw (VE-D9). */
    private scrollToKeep: number | null = null;
    private afterDraw(): void {
        if (!isPlatformBrowser(this.platformId)) return;
        const keep = this.scrollToKeep;
        this.scrollToKeep = null;
        if (keep === null) return;
        // The page redraws on the next frames.
        for (const delay of [0, 80]) {
            setTimeout(() => {
                const win = this.document.defaultView;
                if (win && Math.abs(win.scrollY - keep) > 2) win.scrollTo({ top: keep, behavior: 'instant' });
            }, delay);
        }
    }

    /** Click to field (VE-D8); links open in a new tab; form buttons do nothing. */
    onClick(event: MouseEvent): void {
        const target = event.target as Element | null;
        if (!target || typeof target.closest !== 'function' || target.closest('.arc-pv-strip')) return;
        const field = this.fieldAt(target);
        if (field) {
            event.preventDefault();
            event.stopPropagation();
            this.channel?.post({ kind: 'focus', key: field.key, ...(field.row !== undefined ? { row: field.row } : {}) });
            this.showNote(this.transloco.translate('admin.preview.field_ready', { field: this.fieldLabel(field.key) }));
            return;
        }
        if (target.closest('form') && target.closest('button, input[type="submit"], input[type="image"]')) {
            event.preventDefault();
            event.stopPropagation();
            return;
        }
        const link = target.closest('a[href]');
        const href = link?.getAttribute('href') || '';
        if (link && href && !href.startsWith('#') && !href.startsWith('javascript:')) {
            event.preventDefault();
            event.stopPropagation();
            this.document.defaultView?.open(href, '_blank', 'noopener');
        }
    }

    /** The editor field behind the clicked element: the nearest marked element the editor can focus. */
    fieldAt(target: Element): { key: string; row?: number } | null {
        for (let el: Element | null = target.closest('[data-arc-field]'); el; el = el.parentElement?.closest('[data-arc-field]') ?? null) {
            const resolved = resolvePreviewField(el.getAttribute('data-arc-field') || '', this.type());
            if (!resolved) continue;
            const row = el.getAttribute('data-arc-row');
            return row !== null && /^\d+$/.test(row) ? { key: resolved.field, row: Number(row) } : { key: resolved.field };
        }
        return null;
    }

    private fieldLabel(key: string): string {
        if (BUILTIN_LABELS[key]) return this.transloco.translate(BUILTIN_LABELS[key]);
        const field = this.type()?.fields?.find((f) => f.key === key);
        return field ? contentTypeFieldLabel(this.type(), key, field.label, '') : key;
    }

    private noteTimer: ReturnType<typeof setTimeout> | undefined;

    private showNote(text: string): void {
        this.note.set(text);
        clearTimeout(this.noteTimer);
        this.noteTimer = setTimeout(() => this.note.set(''), 2500);
    }

    /** Outlines the elements a field fills, scrolled to when out of view (VE-D8). */
    highlight(key: string): void {
        const type = this.type();
        const found = Array.from(this.host.querySelectorAll<HTMLElement>('[data-arc-field]'))
            .filter((el) => resolvePreviewField(el.getAttribute('data-arc-field') || '', type)?.field === key);
        if (!found.length) return;
        const first = found[0];
        const box = first.getBoundingClientRect();
        const height = this.document.defaultView?.innerHeight ?? 0;
        if (box.bottom < 40 || box.top > height) first.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
        this.outline(found, HIGHLIGHT_MS);
    }

    private outline(elements: Element[], ms: number): void {
        for (const el of elements) el.setAttribute('data-arc-pv-highlight', '');
        setTimeout(() => elements.forEach((el) => el.removeAttribute('data-arc-pv-highlight')), ms);
    }
}

export default ContentPreviewComponent;
