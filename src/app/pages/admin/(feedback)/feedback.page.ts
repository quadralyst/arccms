/**
 * Admin, Feedback: what people sent with the feedback button (docs/features/feedback.html),
 * newest first. The switch at the top turns the button on or off for everyone.
 */
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { ArcTimePipe } from '../../../core/time/arc-time.pipe';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslocoPipe } from '@jsverse/transloco';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { injectT } from '../../../core/i18n/inject-t';
import { describeBrowser, FeedbackAdminService, type FeedbackFilter, type FeedbackItem } from './feedback-admin.service';
import { LoaderComponent } from '../../../../shared/components/loader/loader.component';
import { ConfirmService } from '../../../../shared/components/confirmation-popup/confirm.service';
import { NotifyService } from '../../../../shared/services/notify.service';
import { isSitePath } from '../../../../shared/utils/site-path';

@Component({
    selector: 'arc-feedback-inbox',
    standalone: true,
    imports: [LoaderComponent, ArcTimePipe, MatButtonModule, MatButtonToggleModule, MatSlideToggleModule, TranslocoPipe, PageHeaderComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
    template: `
        <div class="content-area">
            <arc-page-header [title]="'admin.feedback.title' | transloco" [subtitle]="'admin.feedback.subtitle' | transloco">
                <mat-slide-toggle [checked]="inbox.enabled()" (change)="toggle($event.checked)" [disabled]="saving()">
                    {{ (inbox.enabled() ? 'admin.feedback.button_on' : 'admin.feedback.button_off') | transloco }}
                </mat-slide-toggle>
            </arc-page-header>

            <mat-button-toggle-group class="mb-3" [value]="filter()" (change)="setFilter($event.value)"
                [attr.aria-label]="'admin.feedback.filter' | transloco">
                <mat-button-toggle value="new">{{ 'admin.feedback.filter_new' | transloco }}</mat-button-toggle>
                <mat-button-toggle value="done">{{ 'admin.feedback.filter_done' | transloco }}</mat-button-toggle>
                <mat-button-toggle value="all">{{ 'admin.feedback.filter_all' | transloco }}</mat-button-toggle>
            </mat-button-toggle-group>

            @if (loadError() && !inbox.loading()) {
                <!-- The detail is in the console; the admin reads a plain sentence and can try again. -->
                <div class="alert alert-danger d-flex flex-wrap align-items-center gap-2" role="alert">
                    <span class="flex-grow-1"><strong>{{ 'common.table.load_failed_title' | transloco }}.</strong> {{ 'common.table.load_failed_text' | transloco }}</span>
                    <button type="button" class="btn btn-sm btn-outline-danger" (click)="retry()">{{ 'common.table.retry' | transloco }}</button>
                </div>
            } @else if (!inbox.loading() && !inbox.items().length) {
                <div class="fb-empty">
                    <i class="fa-regular fa-comment-dots" aria-hidden="true"></i>
                    <p>{{ (filter() === 'new' ? 'admin.feedback.empty_new' : 'admin.feedback.empty') | transloco }}</p>
                    @if (!inbox.enabled()) {
                        <p class="text-muted">{{ 'admin.feedback.off_hint' | transloco }}</p>
                    }
                </div>
            }

            <div class="fb-list">
                @for (item of inbox.items(); track item.id) {
                    <article class="fb-item" [class.done]="item.status === 'done'">
                        @if (item.screenshotUrl) {
                            <a class="fb-shot" [href]="item.screenshotUrl" target="_blank" rel="noopener"
                                [attr.aria-label]="'admin.feedback.open_screenshot' | transloco">
                                <img [src]="item.screenshotUrl" alt="" loading="lazy" />
                            </a>
                        }
                        <div class="fb-body">
                            <div class="fb-meta">
                                <strong>{{ item.sender?.name || item.sender?.email || item.sender?.phone || ('admin.feedback.someone' | transloco) }}</strong>
                                <span class="text-muted">{{ item.createdAt | arcTime: 'dateTime' }}</span>
                                @if (item.status === 'new') {
                                    <span class="badge bg-primary">{{ 'admin.feedback.filter_new' | transloco }}</span>
                                }
                            </div>
                            @if (item.sender?.email || item.sender?.phone) {
                                <div class="fb-contact text-muted">
                                    @if (item.sender?.email) { <a [href]="'mailto:' + item.sender?.email">{{ item.sender?.email }}</a> }
                                    @if (item.sender?.phone) { <a [href]="'tel:' + item.sender?.phone">{{ item.sender?.phone }}</a> }
                                </div>
                            }
                            @if (item.message) {
                                <p class="fb-message">{{ item.message }}</p>
                            }
                            @if (item.voiceUrl) {
                                <audio controls preload="none" [src]="item.voiceUrl"></audio>
                            }
                            <div class="fb-context text-muted">
                                @if (item.page?.path; as path) {
                                    <!-- A link only to a path on this site (isSitePath); anything else is plain text. -->
                                    @if (isSitePath(path)) {
                                        <span><i class="fa-solid fa-link" aria-hidden="true"></i> <a [href]="path" target="_blank" rel="noopener">{{ path }}</a></span>
                                    } @else {
                                        <span><i class="fa-solid fa-link" aria-hidden="true"></i> {{ path }}</span>
                                    }
                                }
                                <span><i class="fa-solid fa-mobile-screen" aria-hidden="true"></i> {{ device(item) }}</span>
                                @if (item.version?.text) {
                                    <span><i class="fa-solid fa-code-branch" aria-hidden="true"></i> {{ version(item) }}</span>
                                }
                            </div>
                            <div class="fb-actions">
                                @if (item.status === 'new') {
                                    <button mat-stroked-button (click)="mark(item, 'done')">
                                        <i class="fa-solid fa-check me-1" aria-hidden="true"></i>{{ 'admin.feedback.mark_done' | transloco }}
                                    </button>
                                } @else {
                                    <button mat-stroked-button (click)="mark(item, 'new')">{{ 'admin.feedback.mark_new' | transloco }}</button>
                                }
                                <button mat-button color="warn" (click)="remove(item)">{{ 'common.actions.delete' | transloco }}</button>
                            </div>
                        </div>
                    </article>
                }
            </div>

            @if (inbox.loading()) {
                <arc-loader kind="block" [count]="2"></arc-loader>
            } @else if (inbox.hasMore()) {
                <button mat-stroked-button (click)="load(true)">{{ 'admin.feedback.load_more' | transloco }}</button>
            }
        </div>
    `,
    styles: [`
        .fb-empty { text-align: center; padding: 3rem 1rem; color: var(--bs-secondary-color, #6c757d); }
        .fb-empty i { font-size: 2rem; margin-bottom: 0.75rem; }
        .fb-list { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem; }
        .fb-item {
            display: flex;
            gap: 1rem;
            padding: 1rem;
            border: 1px solid var(--bs-border-color, #dee2e6);
            border-radius: 12px;
            background: var(--bs-body-bg, #fff);
        }
        /* A handled item steps back with a grey card, not by fading: faded text fell under 4.5:1. */
        .fb-item.done { background: var(--bs-tertiary-bg, #f8f9fa); }
        .fb-shot { flex: 0 0 auto; }
        .fb-shot img { width: 120px; max-height: 200px; object-fit: cover; object-position: top; border-radius: 8px; border: 1px solid var(--bs-border-color, #dee2e6); }
        .fb-body { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 0.5rem; }
        .fb-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 0.5rem; }
        .fb-contact { display: flex; flex-wrap: wrap; gap: 0.75rem; font-size: 0.875rem; }
        .fb-message { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .fb-body audio { width: 100%; max-width: 360px; }
        .fb-context { display: flex; flex-wrap: wrap; gap: 1rem; font-size: 0.85rem; }
        .fb-context i { margin-right: 0.25rem; }
        .fb-actions { display: flex; gap: 0.5rem; }
        @media (max-width: 575px) {
            .fb-item { flex-direction: column; }
            .fb-shot img { width: 100%; max-height: 240px; }
        }
    `],
})
export default class FeedbackInboxPage implements OnInit {
    readonly inbox = inject(FeedbackAdminService);
    readonly isSitePath = isSitePath;
    private t = injectT();
    private confirmDialog = inject(ConfirmService);
    private notify = inject(NotifyService);

    readonly filter = signal<FeedbackFilter>('new');
    readonly saving = signal(false);
    /** The list did not load: the page says so with Retry, not "no feedback". */
    readonly loadError = signal(false);
    /** Whether the read that failed was a Load more, so Retry asks for the same page. */
    private retryMore = false;

    ngOnInit(): void {
        void this.inbox.loadSetting().catch((err) => console.error('Feedback setting:', err));
        void this.load();
    }

    setFilter(filter: FeedbackFilter): void {
        this.filter.set(filter);
        void this.load();
    }

    /** The first page for the filter, or the next one with `more`. */
    async load(more = false): Promise<void> {
        this.loadError.set(false);
        try {
            await this.inbox.load(this.filter(), more);
        } catch (err) {
            console.error('Feedback:', err);
            this.retryMore = more;
            // A first page that failed leaves nothing of the previous filter on screen.
            if (!more) {
                this.inbox.items.set([]);
                this.inbox.hasMore.set(false);
            }
            this.loadError.set(true);
        }
    }

    /** Retry what failed: the first page, or the next page after a failed Load more. */
    retry(): void {
        void this.load(this.retryMore);
    }

    async toggle(enabled: boolean): Promise<void> {
        this.saving.set(true);
        try {
            await this.inbox.setEnabled(enabled);
        } catch (err) {
            console.error('Turning the feedback button on or off failed:', err);
            this.notify.error('admin.feedback.toggle_failed');
        } finally {
            this.saving.set(false);
        }
    }

    async mark(item: FeedbackItem, status: 'new' | 'done'): Promise<void> {
        try {
            await this.inbox.setStatus(item, status);
        } catch (err) {
            console.error('Marking feedback failed:', err);
            this.notify.error('admin.feedback.status_failed');
        }
    }

    async remove(item: FeedbackItem): Promise<void> {
        const confirmed = await this.confirmDialog.ask({
            titleKey: 'common.dialog.delete',
            dialogMessage: this.t('admin.feedback.delete_confirm'),
            btnText: this.t('common.actions.delete'),
            panelType: 'warn',
        });
        if (!confirmed) return;
        try {
            await this.inbox.remove(item);
        } catch (err) {
            console.error('Delete failed:', err);
            this.notify.error('admin.feedback.delete_failed');
        }
    }

    /** "v1.2.0.25 android · 533b6d02": the build, then the commit it was made from (docs/app/version.html). */
    version(item: FeedbackItem): string {
        return [item.version?.text, item.version?.commit].filter(Boolean).join(' · ');
    }

    device(item: FeedbackItem): string {
        const d = item.device ?? {};
        const parts = [describeBrowser(d.userAgent), d.viewport, d.installed ? this.t('admin.feedback.installed_app') : ''];
        return parts.filter(Boolean).join(' · ');
    }
}
