import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ArcTimePipe } from '../../../core/time/arc-time.pipe';
import { injectT } from '../../../core/i18n/inject-t';
import {
    PageTextService, type PageTextSession, type PageTextVersion, type PublishedPageText,
} from '../../../core/site/page-text.service';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import MediaManagerComponent from '../(media)/media.page';
import { mediaPickerDialogConfig } from '../(media)/media-picker-dialog';
import { morePageStatus } from './more-pages.service';
import type { SeoView } from './page-text-editor.model';

/** How often, and how many times, the panel asks whether a publish is out. */
const PUBLISH_POLL_MS = 3000;
const PUBLISH_POLLS = 40;
/** How long after the last key an SEO field saves. */
const SAVE_DELAY_MS = 700;

/**
 * A page's panel (specs/visual-editing-spec.md, VE-D51): **Basic** (where the page
 * stands, Publish), **SEO** (title, description, share picture) and **History**
 * (every publish, Restore). The classic editor shows it beside its fields; the
 * Visual Editor shows it as Page settings.
 */
@Component({
    selector: 'arc-page-text-panel',
    standalone: true,
    imports: [ArcTimePipe, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    styleUrls: ['./page-text-panel.component.scss'],
    template: `
        <div class="panel-tabs" role="tablist">
            @for (tab of tabs; track tab) {
                <button type="button" role="tab" class="panel-tab" [class.active]="tabShown() === tab" [attr.aria-selected]="tabShown() === tab"
                    (click)="showTab(tab)">{{ ('admin.more_pages.editor.tab_' + tab) | transloco }}</button>
            }
        </div>

        @if (tabShown() === 'basic') {
            <div class="panel-body" role="tabpanel">
                <div class="panel-row">
                    <span class="panel-label">{{ 'admin.more_pages.editor.status' | transloco }}</span>
                    <span class="page-status" [class]="'page-status status-' + status()">{{ ('admin.more_pages.status.' + status()) | transloco }}</span>
                </div>
                <div class="panel-row">
                    <span class="panel-label">{{ 'admin.more_pages.last_published' | transloco }}</span>
                    <span>@if (lastPublished()) { {{ lastPublished() | arcTime }} } @else { {{ 'admin.more_pages.never' | transloco }} }</span>
                </div>
                <button type="button" class="btn btn-primary w-100 mt-2" data-testid="publish" (click)="publish()"
                    [disabled]="publishing() || status() !== 'changes' || busy()">
                    @if (publishing()) {
                        <i class="fa-solid fa-spinner fa-spin me-1" aria-hidden="true"></i>{{ 'admin.more_pages.editor.publishing' | transloco }}
                    } @else {
                        <i class="fa-solid fa-upload me-1" aria-hidden="true"></i>{{ 'admin.more_pages.editor.publish' | transloco }}
                    }
                </button>
                @if (publishError()) {
                    <p class="text-danger small mt-2" role="alert">{{ publishError() }}</p>
                } @else if (status() === 'changes' && !publishing()) {
                    <p class="text-muted small mt-2">{{ 'admin.more_pages.editor.publish_note' | transloco }}</p>
                }
                <p class="text-muted small mt-3 mb-0">{{ 'admin.more_pages.editor.cards_note' | transloco }}</p>
            </div>
        }

        @if (tabShown() === 'seo' && seo(); as seo) {
            <div class="panel-body" role="tabpanel">
                <label class="panel-label" for="seo-title">{{ 'admin.more_pages.editor.seo_title' | transloco }}</label>
                <input id="seo-title" class="form-control" type="text" [value]="shown('title', seo.title)" [placeholder]="seo.titleFallback"
                    (input)="seoInput('title', $any($event.target).value)" (blur)="seoLeft('title')">
                <div class="counter" [class.over]="length('title') > 60">{{ 'admin.more_pages.editor.title_count' | transloco: { count: length('title') } }}</div>

                <label class="panel-label mt-3" for="seo-description">{{ 'admin.more_pages.editor.seo_description' | transloco }}</label>
                <textarea id="seo-description" class="form-control" rows="4" [value]="shown('description', seo.description)" [placeholder]="seo.descriptionFallback"
                    (input)="seoInput('description', $any($event.target).value)" (blur)="seoLeft('description')"></textarea>
                <div class="counter" [class.over]="length('description') > 160">{{ 'admin.more_pages.editor.description_count' | transloco: { count: length('description') } }}</div>

                <span class="panel-label mt-3 d-block">{{ 'admin.more_pages.editor.share_image' | transloco }}</span>
                @if (seo.shareImage) {
                    <img class="share-image" [src]="seo.shareImage" alt="">
                } @else {
                    <p class="text-muted small mb-1">{{ 'admin.more_pages.editor.share_image_default' | transloco }}</p>
                }
                <div class="d-flex gap-2 flex-wrap">
                    <button type="button" class="btn btn-outline-primary btn-sm" (click)="chooseShareImage()">{{ 'admin.more_pages.editor.choose_picture' | transloco }}</button>
                    @if (seo.shareImage) {
                        <button type="button" class="btn btn-link btn-sm" (click)="useFileShareImage()">{{ 'admin.more_pages.editor.use_file_picture' | transloco }}</button>
                    }
                </div>
                @if (lang() !== defaultLang()) {
                    <p class="text-muted small mt-3 mb-0">{{ 'admin.more_pages.editor.seo_language_note' | transloco }}</p>
                }
                @if (saveError()) {
                    <p class="text-danger small mt-2" role="alert">{{ 'admin.more_pages.editor.not_saved_detail' | transloco: { error: saveError() } }}</p>
                }
            </div>
        }

        @if (tabShown() === 'history') {
            <div class="panel-body" role="tabpanel" data-testid="history">
                @if (historyError()) {
                    <p class="text-danger small" role="alert">{{ 'admin.more_pages.editor.history_failed' | transloco }}</p>
                } @else if (history() === null) {
                    <p class="text-muted small" role="status">{{ 'admin.more_pages.loading' | transloco }}</p>
                } @else {
                    @for (version of history(); track version.id; let first = $first) {
                        <div class="version">
                            <div>
                                <div>{{ millis(version.publishedAt) | arcTime }} @if (first) { <span class="badge text-bg-success ms-1">{{ 'admin.more_pages.editor.live' | transloco }}</span> }</div>
                                <div class="text-muted small">{{ 'admin.more_pages.editor.version_count' | transloco: { count: entryCount(version) } }}</div>
                            </div>
                            <button type="button" class="btn btn-outline-secondary btn-sm" (click)="restore(version)">{{ 'admin.more_pages.editor.restore' | transloco }}</button>
                        </div>
                    } @empty {
                        <p class="text-muted small">{{ 'admin.more_pages.editor.no_history' | transloco }}</p>
                    }
                }
            </div>
        }
    `,
})
export class PageTextPanelComponent implements OnDestroy {
    private pageText = inject(PageTextService);
    private dialog = inject(MatDialog);
    private confirm = inject(ConfirmService);
    private t = injectT();

    readonly session = input.required<PageTextSession>();
    readonly lang = input.required<string>();
    readonly defaultLang = input.required<string>();
    readonly seo = input<SeoView | null>(null);
    /** Edits elsewhere on the screen still saving: Publish waits for them. */
    readonly busy = input(false);
    /** Run before Publish: saves what is still waiting; false stops the publish (a save failed). */
    readonly beforePublish = input<() => Promise<boolean>>(async () => true);
    /** Run instead of publishing the page's text alone (the Visual Editor's one Publish, VE-D53). */
    readonly publishWith = input<(() => Promise<void>) | null>(null);

    readonly tabs = ['basic', 'seo', 'history'] as const;
    readonly tabShown = signal<'basic' | 'seo' | 'history'>('basic');

    readonly draft = computed(() => this.session().draft());
    readonly published = signal<PublishedPageText | null>(null);
    readonly status = computed(() => morePageStatus(this.draft(), this.published()));
    readonly lastPublished = computed(() => this.published()?.publishedAt?.toMillis?.() ?? null);
    readonly publishing = signal(false);
    readonly publishError = signal('');
    readonly saveError = signal('');
    readonly history = signal<PageTextVersion[] | null>(null);
    readonly historyError = signal(false);

    private typing = signal<Record<string, string>>({});
    private timers = new Map<string, { timer: ReturnType<typeof setTimeout>; save: () => Promise<void> }>();
    private pollTimer: ReturnType<typeof setTimeout> | null = null;

    constructor() {
        // The published copy of the page the panel is for.
        effect(() => {
            const pageId = this.session().pageId;
            void this.pageText.published(pageId).then((published) => {
                if (this.session().pageId === pageId) this.published.set(published);
            });
        });
    }

    ngOnDestroy(): void {
        for (const pending of this.timers.values()) {
            clearTimeout(pending.timer);
            void pending.save();
        }
        if (this.pollTimer) clearTimeout(this.pollTimer);
    }

    showTab(tab: 'basic' | 'seo' | 'history'): void {
        this.tabShown.set(tab);
        if (tab === 'history') void this.loadHistory();
    }

    // ── SEO ────────────────────────────────────────────────────────────────

    private id(field: 'title' | 'description'): string {
        return `${this.lang()}:${field}`;
    }

    shown(field: 'title' | 'description', saved: string): string {
        const typed = this.typing()[this.id(field)];
        return typed !== undefined ? typed : saved;
    }

    length(field: 'title' | 'description'): number {
        const seo = this.seo();
        const own = this.shown(field, (field === 'title' ? seo?.title : seo?.description) ?? '');
        return own.length || ((field === 'title' ? seo?.titleFallback : seo?.descriptionFallback)?.length ?? 0);
    }

    private async run(save: () => Promise<void>): Promise<void> {
        try {
            await save();
            this.saveError.set('');
        } catch (error: any) {
            console.error('[PageTextPanel] Could not save:', error);
            this.saveError.set(error?.message || String(error));
        }
    }

    seoInput(field: 'title' | 'description', value: string): void {
        const id = this.id(field);
        const lang = this.lang();
        const session = this.session();
        this.typing.update((t) => ({ ...t, [id]: value }));
        const pending = this.timers.get(id);
        if (pending) clearTimeout(pending.timer);
        const save = async () => {
            this.timers.delete(id);
            await this.run(() => (value.trim() ? session.saveSeo(lang, field, value.trim()) : session.useFileSeo(lang, field)));
        };
        this.timers.set(id, { timer: setTimeout(save, SAVE_DELAY_MS), save });
    }

    seoLeft(field: 'title' | 'description'): void {
        const id = this.id(field);
        const pending = this.timers.get(id);
        const done = () => this.typing.update(({ [id]: _, ...rest }) => rest);
        if (!pending) {
            done();
            return;
        }
        clearTimeout(pending.timer);
        void pending.save().then(done);
    }

    /** Saves what the panel still waits to save. */
    async flush(): Promise<void> {
        await Promise.all([...this.timers.values()].map((pending) => {
            clearTimeout(pending.timer);
            return pending.save();
        }));
    }

    async chooseShareImage(): Promise<void> {
        const result = await firstValueFrom(this.dialog.open(MediaManagerComponent, mediaPickerDialogConfig({
            isDialogOpen: true, title: this.t('admin.more_pages.editor.share_image'),
        })).afterClosed()) as { mediaUrl?: string; type?: string } | null;
        if (result?.type === 'submit' && result.mediaUrl) await this.run(() => this.session().saveShareImage(result.mediaUrl!));
    }

    useFileShareImage(): void {
        void this.run(() => this.session().useFileShareImage());
    }

    // ── Publish (VE-D53) ───────────────────────────────────────────────────

    async publish(): Promise<void> {
        if (this.publishing()) return;
        this.publishError.set('');
        await this.flush();
        if (this.saveError() || !(await this.beforePublish()())) return;
        this.publishing.set(true);
        try {
            const custom = this.publishWith();
            if (custom) await custom();
            else await this.session().publish();
            this.poll(0);
        } catch (error: any) {
            console.error('[PageTextPanel] Could not publish:', error);
            this.publishing.set(false);
            this.publishError.set(error?.message || String(error));
        }
    }

    /** Asks until the published copy has caught up with the draft. */
    poll(round: number): void {
        this.publishing.set(true);
        this.pollTimer = setTimeout(async () => {
            const published = await this.pageText.published(this.session().pageId);
            if (published) this.published.set(published);
            const waiting = morePageStatus(this.draft(), published) === 'changes';
            if (!waiting || round >= PUBLISH_POLLS) {
                this.publishing.set(false);
                if (waiting) this.publishError.set(this.t('admin.more_pages.editor.publish_slow'));
                if (this.tabShown() === 'history') void this.loadHistory();
                return;
            }
            this.poll(round + 1);
        }, PUBLISH_POLL_MS);
    }

    // ── History (VE-D51) ───────────────────────────────────────────────────

    async loadHistory(): Promise<void> {
        this.historyError.set(false);
        try {
            this.history.set(await this.pageText.history(this.session().pageId));
        } catch (error) {
            console.error('[PageTextPanel] Could not read the history:', error);
            this.historyError.set(true);
        }
    }

    /** Restore: a version becomes the draft, which then needs Publish. */
    async restore(version: PageTextVersion): Promise<void> {
        const ok = await this.confirm.ask({
            titleKey: 'admin.more_pages.editor.restore_title',
            dialogMessage: this.t('admin.more_pages.editor.restore_confirm'),
            btnText: this.t('admin.more_pages.editor.restore'),
        });
        if (!ok) return;
        await this.run(() => this.session().restore(version));
        this.tabShown.set('basic');
    }

    entryCount(version: PageTextVersion): number {
        const words = Object.values(version.text || {}).reduce((n, byKey) => n + Object.keys(byKey || {}).length, 0);
        return words + Object.keys(version.urls || {}).length;
    }

    millis(time: { toMillis?: () => number } | null | undefined): number | null {
        return time?.toMillis?.() ?? null;
    }
}
