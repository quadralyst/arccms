/**
 * Admin, Feedback: what people sent with the feedback button (docs/features/feedback.html),
 * newest first. The switch at the top turns the button on or off for everyone.
 */
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { TranslocoPipe } from '@jsverse/transloco';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { injectT } from '../../../core/i18n/inject-t';
import { describeBrowser, FeedbackAdminService, type FeedbackFilter, type FeedbackItem } from './feedback-admin.service';

@Component({
    selector: 'arc-feedback-inbox',
    standalone: true,
    imports: [DatePipe, MatButtonModule, MatButtonToggleModule, MatSlideToggleModule, TranslocoPipe, PageHeaderComponent],
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

            @if (!inbox.loading() && !inbox.items().length) {
                <div class="fb-empty">
                    <i class="fa-regular fa-comment-dots"></i>
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
                                <span class="text-muted">{{ item.createdAt | date: 'medium' }}</span>
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
                                @if (item.page?.path) {
                                    <span><i class="fa-solid fa-link"></i> <a [href]="item.page?.path" target="_blank" rel="noopener">{{ item.page?.path }}</a></span>
                                }
                                <span><i class="fa-solid fa-mobile-screen"></i> {{ device(item) }}</span>
                            </div>
                            <div class="fb-actions">
                                @if (item.status === 'new') {
                                    <button mat-stroked-button (click)="inbox.setStatus(item, 'done')">
                                        <i class="fa-solid fa-check me-1"></i>{{ 'admin.feedback.mark_done' | transloco }}
                                    </button>
                                } @else {
                                    <button mat-stroked-button (click)="inbox.setStatus(item, 'new')">{{ 'admin.feedback.mark_new' | transloco }}</button>
                                }
                                <button mat-button color="warn" (click)="remove(item)">{{ 'common.actions.delete' | transloco }}</button>
                            </div>
                        </div>
                    </article>
                }
            </div>

            @if (inbox.loading()) {
                <p class="text-muted">{{ 'common.state.loading' | transloco }}</p>
            } @else if (inbox.hasMore()) {
                <button mat-stroked-button (click)="inbox.load(filter(), true)">{{ 'admin.feedback.load_more' | transloco }}</button>
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
        .fb-item.done { opacity: 0.75; }
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
    private t = injectT();

    readonly filter = signal<FeedbackFilter>('new');
    readonly saving = signal(false);

    ngOnInit(): void {
        void this.inbox.loadSetting().catch((err) => console.error('Feedback setting:', err));
        void this.inbox.load(this.filter()).catch((err) => console.error('Feedback:', err));
    }

    setFilter(filter: FeedbackFilter): void {
        this.filter.set(filter);
        void this.inbox.load(filter).catch((err) => console.error('Feedback:', err));
    }

    async toggle(enabled: boolean): Promise<void> {
        this.saving.set(true);
        try {
            await this.inbox.setEnabled(enabled);
        } finally {
            this.saving.set(false);
        }
    }

    async remove(item: FeedbackItem): Promise<void> {
        if (!confirm(this.t('admin.feedback.delete_confirm'))) return;
        await this.inbox.remove(item);
    }

    device(item: FeedbackItem): string {
        const d = item.device ?? {};
        const parts = [describeBrowser(d.userAgent), d.viewport, d.installed ? this.t('admin.feedback.installed_app') : ''];
        return parts.filter(Boolean).join(' · ');
    }
}
