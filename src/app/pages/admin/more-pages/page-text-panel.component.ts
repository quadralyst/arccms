import { ChangeDetectionStrategy, Component, OnDestroy, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { isHeld } from '../../../core/editing/hold';
import { MatDialog } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import { firstValueFrom } from 'rxjs';
import { ArcTimePipe } from '../../../core/time/arc-time.pipe';
import { injectT } from '../../../core/i18n/inject-t';
import {
    PageTextService, goingLive, type PageTextSession, type PageTextVersion, type PublishedPageText,
} from '../../../core/site/page-text.service';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import MediaManagerComponent from '../(media)/media.page';
import { mediaPickerDialogConfig } from '../(media)/media-picker-dialog';
import { morePageStatus } from './more-pages.service';
import { GlobalService } from '../../../../shared/services/global.service';
import { NotifyService } from '../../../../shared/services/notify.service';
import { KeptDraftsComponent } from '../hold/kept-drafts.component';
import type { KeptDraft } from '../../../core/editing/hold.service';
import { editState } from '../edit/edit-state';
import { PageStatusComponent } from '../edit/page-status.component';
import { SharePreviewComponent } from '../edit/share-preview.component';
import type { SeoView } from './page-text-editor.model';

/** How long Publish waits for the published copy before saying it is slow. */
const PUBLISH_WAIT_MS = 120_000;
/** How long after the last key an SEO field saves. */
const SAVE_DELAY_MS = 700;

/**
 * A page's panel (specs/visual-editing-spec.md, VE-D51, VE-D67): **Basic** (where the
 * page stands, its title, cover image, summary and address, as an entry's), **SEO**
 * (how it looks in search and when shared) and **History** (every publish, Restore).
 * The classic editor shows it beside its fields; the Visual Editor shows it as Page
 * settings. Publish is on the screen's own bar, and runs through `publish()` here.
 */
@Component({
    selector: 'arc-page-text-panel',
    standalone: true,
    imports: [ArcTimePipe, TranslocoPipe, KeptDraftsComponent, PageStatusComponent, SharePreviewComponent],
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
                @if (known()) {
                <arc-page-status [state]="state()" [lastPublished]="lastPublished()" />
                }
                @if (locked() || status() === 'changes') {
                    <button type="button" class="btn btn-link btn-sm p-0 mb-2" (click)="review.emit()" data-testid="review-changes">{{ 'admin.hold.review' | transloco }}</button>
                }
                @if (publishError()) {
                    <p class="text-danger small" role="alert">{{ publishError() }}</p>
                } @else if (status() === 'changes' && !publishing()) {
                    <p class="text-muted small">{{ 'admin.more_pages.editor.publish_note' | transloco }}</p>
                }
                @if (seo(); as seo) {
                <div [attr.inert]="locked() ? '' : null">
                <div class="panel-field">
                    <label class="panel-label" for="page-title">{{ 'admin.contents.editor.title_label' | transloco }}</label>
                    <input id="page-title" class="form-control form-control-sm" type="text" [value]="shown('title', seo.title)" [placeholder]="seo.titleFallback"
                        (input)="seoInput('title', $any($event.target).value)" (blur)="seoLeft('title')">
                    <div class="counter" [class.over]="length('title') > 60">{{ 'admin.more_pages.editor.title_count' | transloco: { count: length('title') } }}</div>
                    <small class="text-muted d-block">{{ 'admin.edit_page.page_title_hint' | transloco }}</small>
                </div>
                <div class="panel-field">
                    <span class="panel-label d-block">{{ 'admin.contents.editor.cover_image' | transloco }}</span>
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
                    <small class="text-muted d-block">{{ 'admin.edit_page.page_cover_hint' | transloco }}</small>
                </div>
                <div class="panel-field">
                    <label class="panel-label" for="page-summary">{{ 'admin.contents.editor.summary' | transloco }}</label>
                    <textarea id="page-summary" class="form-control form-control-sm" rows="4" [value]="shown('description', seo.description)" [placeholder]="seo.descriptionFallback"
                        (input)="seoInput('description', $any($event.target).value)" (blur)="seoLeft('description')"></textarea>
                    <div class="counter" [class.over]="length('description') > 160">{{ 'admin.more_pages.editor.description_count' | transloco: { count: length('description') } }}</div>
                    <small class="text-muted d-block">{{ (length('description') ? 'admin.edit_page.page_summary_hint' : 'admin.edit_page.no_summary') | transloco }}</small>
                </div>
                </div>
                }
                @if (url()) {
                <div class="panel-field">
                    <span class="panel-label d-block">{{ 'admin.contents.editor.address' | transloco }}</span>
                    <div class="address">
                        <a [href]="url()" target="_blank" rel="noopener">{{ url() }}</a>
                        <button type="button" class="btn btn-link btn-sm p-0" (click)="copyAddress()" [title]="'admin.contents.editor.copy_address' | transloco"
                            [attr.aria-label]="'admin.contents.editor.copy_address' | transloco" data-testid="copy-address"><i class="fa-regular fa-copy" aria-hidden="true"></i></button>
                    </div>
                    <small class="text-muted d-block">{{ 'admin.edit_page.address_by_developer' | transloco }}</small>
                </div>
                }
                @if (lang() !== defaultLang()) {
                    <p class="text-muted small mt-2 mb-0">{{ 'admin.more_pages.editor.seo_language_note' | transloco }}</p>
                }
                @if (saveError()) {
                    <p class="text-danger small mt-2" role="alert">{{ 'admin.more_pages.editor.not_saved_detail' | transloco }}</p>
                }
                <p class="text-muted small mt-3 mb-0">{{ (publishWith() ? 'admin.more_pages.editor.cards_note_visual' : 'admin.more_pages.editor.cards_note') | transloco }}</p>
            </div>
        }

        @if (tabShown() === 'seo' && seo(); as seo) {
            <div class="panel-body" role="tabpanel" data-testid="seo-panel">
                <p class="text-muted small mb-0">{{ 'admin.edit_page.seo_from_basic' | transloco }}</p>
                <arc-share-preview [title]="shown('title', seo.title) || seo.titleFallback" [description]="shown('description', seo.description) || seo.descriptionFallback"
                    [image]="seo.shareImage" [url]="url()" />
            </div>
        }

        @if (tabShown() === 'history') {
            <div class="panel-body" role="tabpanel" data-testid="history">
                <arc-kept-drafts [path]="session().path || ''" [locked]="locked()" [again]="lastPublished() + '/' + keptChanged()" (restore)="restoreKept($event)" />
                @if (publishing() || goingLive()) {
                    <p class="text-muted small" role="status">{{ 'admin.edit_page.history_publishing' | transloco }}</p>
                }
                @if (historyError()) {
                    <p class="text-danger small" role="alert">{{ 'admin.more_pages.editor.history_failed' | transloco }}</p>
                } @else if (history() === null) {
                    <p class="text-muted small" role="status">{{ 'admin.more_pages.loading' | transloco }}</p>
                } @else {
                    @for (version of history(); track version.id; let first = $first) {
                        <div class="version">
                            <div>
                                <div>{{ millis(version.publishedAt) | arcTime }} @if (first && !goingLive()) { <span class="badge text-bg-success ms-1">{{ 'admin.more_pages.editor.live' | transloco }}</span> }</div>
                                <div class="text-muted small">{{ 'admin.more_pages.editor.version_count' | transloco: { count: entryCount(version) } }}</div>
                            </div>
                            <button type="button" class="btn btn-outline-secondary btn-sm" (click)="restore(version)" [disabled]="locked()">{{ 'admin.more_pages.editor.restore' | transloco }}</button>
                        </div>
                    } @empty {
                        <p class="text-muted small">{{ 'admin.more_pages.editor.no_history' | transloco }}</p>
                    }
                    <p class="text-muted small mt-3 mb-0">{{ 'admin.edit_page.history_words' | transloco }}</p>
                }
            </div>
        }
    `,
})
export class PageTextPanelComponent implements OnDestroy {
    private pageText = inject(PageTextService);
    private global = inject(GlobalService);
    private notify = inject(NotifyService);
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
    /** Cards with unpublished changes the Visual Editor's one Publish also takes (VE-D53). */
    readonly extraChanges = input(0);
    /** The page's public address, shown and copied (VE-D74). */
    readonly url = input('');
    /** Someone else holds the page's words: they are looked at, not changed (VE-D79). */
    readonly locked = input(false);
    /** Review changes was asked for. */
    readonly review = output<void>();
    /** A save somewhere else on the screen failed. */
    readonly failed = input(false);

    readonly tabs = ['basic', 'seo', 'history'] as const;
    readonly tabShown = signal<'basic' | 'seo' | 'history'>('basic');

    readonly draft = computed(() => this.session().draft());
    readonly published = signal<PublishedPageText | null>(null);
    private readonly publishedRead = signal(false);
    readonly status = computed(() => morePageStatus(this.draft(), this.published()));
    readonly lastPublished = computed(() => this.published()?.publishedAt?.toMillis?.() ?? null);
    readonly publishing = signal(false);
    /** Its words were copied and its page is not out yet, also when the screen opens meanwhile. */
    readonly goingLive = computed(() => goingLive(this.published()));
    readonly publishError = signal('');
    readonly saveError = signal('');
    /** SEO words typed or being saved here. */
    private readonly seoSaving = signal(0);
    /** The page's state in the words every editor uses (VE-D70). */
    readonly state = computed(() => editState({
        saving: this.busy() || this.seoSaving() > 0,
        failed: this.failed() || !!this.saveError() || !!this.session().error?.(),
        publishing: this.publishing() || this.goingLive(),
        changed: this.status() === 'changes' || this.extraChanges() > 0,
        live: true,
    }));
    /** Publish has something to do (VE-D73). */
    /** The draft and the published copy were both read: until then nothing is said about the page. */
    readonly known = computed(() => this.publishedRead() && (this.session().loaded?.() ?? true));
    readonly canPublish = computed(() => this.known() && !this.publishing() && !this.busy()
        && (this.locked() ? this.extraChanges() > 0 : this.status() === 'changes' || this.extraChanges() > 0 || !!this.publishError()));
    /** Counts what adds a kept draft, so the list reads them again. */
    readonly keptChanged = signal(0);
    readonly history = signal<PageTextVersion[] | null>(null);
    readonly historyError = signal(false);

    private typing = signal<Record<string, string>>({});
    private timers = new Map<string, { timer: ReturnType<typeof setTimeout>; save: () => Promise<void> }>();
    private waitTimer: ReturnType<typeof setTimeout> | null = null;
    /** While a Publish is waiting: when the page was last published before it. */
    private publishedBefore: number | null = null;

    constructor() {
        // The published copy of the page the panel is for, followed: another editor's publish shows too.
        effect((onCleanup) => {
            const pageId = this.session().pageId;
            const stop = untracked(() => this.pageText.followPublished(pageId, (published) => untracked(() => {
                const before = this.lastPublished();
                this.published.set(published);
                this.publishedRead.set(true);
                this.publishLanded();
                // Whoever published, and however long it took: an open History shows it (VE-D71).
                if (this.tabShown() === 'history' && this.lastPublished() !== before) void this.loadHistory();
            })));
            onCleanup(stop);
        });
    }

    ngOnDestroy(): void {
        for (const pending of this.timers.values()) {
            clearTimeout(pending.timer);
            void pending.save();
        }
        if (this.waitTimer) clearTimeout(this.waitTimer);
        this.publishedBefore = null;
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
        this.seoSaving.update((n) => n + 1);
        try {
            await save();
            this.saveError.set('');
        } catch (error: any) {
            if (isHeld(error)) {
                this.typing.set({});
                return;
            }
            console.error('[PageTextPanel] Could not save:', error);
            this.saveError.set(error?.message || String(error));
        } finally {
            this.seoSaving.update((n) => n - 1);
        }
    }

    async copyAddress(): Promise<void> {
        if (await this.global.copyToClipboard(this.url())) this.notify.success('admin.contents.editor.url_copied');
        else this.notify.error('admin.contents.editor.url_copy_failed');
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
        // Someone else's words are published by Publish these alone; this person's cards still go.
        if (this.publishing() || (this.locked() && !this.publishWith())) return;
        this.publishError.set('');
        await this.flush();
        if (this.saveError() || !(await this.beforePublish()())) return;
        this.publishing.set(true);
        try {
            const custom = this.publishWith();
            if (custom) await custom();
            else await this.session().publish();
            this.awaitPublish();
        } catch (error: any) {
            console.error('[PageTextPanel] Could not publish:', error);
            this.publishing.set(false);
            this.publishError.set(error?.message || String(error));
        }
    }

    /** Publishes the page's words as they are stored, someone else's too (VE-D80: Publish these). */
    async publishWords(): Promise<void> {
        if (!this.locked()) return;
        if (this.publishing()) return;
        this.publishError.set('');
        this.publishing.set(true);
        try {
            await this.session().publish();
            this.awaitPublish();
        } catch (error: any) {
            console.error('[PageTextPanel] Could not publish:', error);
            this.publishing.set(false);
            this.publishError.set(error?.message || String(error));
        }
    }

    /** Waits for the published copy to catch up with the draft (followed in the constructor). */
    awaitPublish(): void {
        this.publishing.set(true);
        this.publishedBefore = this.lastPublished() ?? 0;
        if (this.waitTimer) clearTimeout(this.waitTimer);
        this.waitTimer = setTimeout(() => {
            if (this.publishedBefore === null) return;
            this.finishPublish();
            if (this.status() === 'changes' || this.goingLive()) this.publishError.set(this.t('admin.more_pages.editor.publish_slow'));
        }, PUBLISH_WAIT_MS);
        this.publishLanded();
    }

    /**
     * A Publish waiting is done when the page shows no changes, or when a new
     * published copy came that still does: the page did not go live (it says no
     * draft) or someone saved again meanwhile.
     */
    private publishLanded(): void {
        if (this.publishedBefore === null) return;
        const published = this.published();
        const waiting = this.status() === 'changes';
        const landed = (published?.publishedAt?.toMillis?.() ?? 0) > this.publishedBefore;
        if (waiting && !landed) return;
        // Copied is not live: the page itself is still on its way.
        if (this.goingLive()) return;
        this.finishPublish();
        if (waiting && published?.draftUpdatedAt === null) this.publishError.set(this.t('admin.more_pages.editor.publish_not_live'));
    }

    private finishPublish(): void {
        this.publishedBefore = null;
        if (this.waitTimer) clearTimeout(this.waitTimer);
        this.waitTimer = null;
        this.publishing.set(false);
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

    /** Restores a kept draft (VE-D84); it then needs Publish. */
    async restoreKept(kept: KeptDraft): Promise<void> {
        await this.run(() => this.session().restoreKept(kept.data));
        this.keptChanged.update((n) => n + 1);
        if (!this.saveError()) this.notify.success('admin.hold.kept_restored');
        this.tabShown.set('basic');
    }

    entryCount(version: PageTextVersion): number {
        const words = Object.values(version.text || {}).reduce((n, byKey) => n + Object.keys(byKey || {}).length, 0);
        const seo = Object.values(version.seo || {}).reduce((n, fields) => n + Object.keys(fields || {}).length, 0);
        return words + Object.keys(version.urls || {}).length + seo + (version.shareImage ? 1 : 0);
    }

    millis(time: { toMillis?: () => number } | null | undefined): number | null {
        return time?.toMillis?.() ?? null;
    }
}
