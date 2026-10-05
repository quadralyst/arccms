/**
 * Admin, Messages: what people sent with the site's contact form
 * (specs/site-sections-spec.md, SS5), newest first, in three tabs: New, Done and
 * Possible spam. Reply opens the admin's own email client; Arc CMS sends nothing.
 */
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { TranslocoPipe } from '@jsverse/transloco';
import { PageHeaderComponent } from '../../../../shared/components/page-header/page-header.component';
import { injectT } from '../../../core/i18n/inject-t';
import { MessagesAdminService, replyLink, type ContactMessageItem, type MessageStatus } from './messages-admin.service';

@Component({
    selector: 'arc-messages-inbox',
    standalone: true,
    imports: [DatePipe, MatButtonModule, MatButtonToggleModule, TranslocoPipe, PageHeaderComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { ngSkipHydration: 'true' },
    template: `
        <div class="content-area">
            <arc-page-header [title]="'admin.messages.title' | transloco" [subtitle]="'admin.messages.subtitle' | transloco"></arc-page-header>

            <mat-button-toggle-group class="mb-3" [value]="status()" (change)="setStatus($event.value)"
                [attr.aria-label]="'admin.messages.filter' | transloco">
                <mat-button-toggle value="new">{{ 'admin.messages.tab_new' | transloco }}</mat-button-toggle>
                <mat-button-toggle value="done">{{ 'admin.messages.tab_done' | transloco }}</mat-button-toggle>
                <mat-button-toggle value="spam">{{ 'admin.messages.tab_spam' | transloco }}</mat-button-toggle>
            </mat-button-toggle-group>

            @if (status() === 'spam') {
                <p class="text-muted small">{{ 'admin.messages.spam_hint' | transloco }}</p>
            }

            @if (!inbox.loading() && !inbox.items().length) {
                <div class="msg-empty" data-testid="messages-empty">
                    <i class="fa-regular fa-envelope"></i>
                    <p>{{ (status() === 'new' ? 'admin.messages.empty_new' : 'admin.messages.empty') | transloco }}</p>
                    @if (status() === 'new') {
                        <p class="text-muted">{{ 'admin.messages.empty_hint' | transloco }}</p>
                    }
                </div>
            }

            <div class="msg-list">
                @for (item of inbox.items(); track item.id) {
                    <article class="msg-item" data-testid="message">
                        <div class="msg-meta">
                            <strong>{{ item.name || item.email }}</strong>
                            @if (item.name) { <a class="text-muted" [href]="'mailto:' + item.email">{{ item.email }}</a> }
                            @if (item.phone) { <a class="text-muted" [href]="'tel:' + item.phone">{{ item.phone }}</a> }
                            <span class="text-muted ms-auto">{{ item.createdAt | date: 'medium' }}</span>
                        </div>
                        @if (item.subject) { <h3 class="msg-subject">{{ item.subject }}</h3> }
                        <p class="msg-text">{{ item.message }}</p>
                        @if (item.page) {
                            <div class="msg-page text-muted">
                                <i class="fa-solid fa-link"></i> {{ 'admin.messages.sent_from' | transloco }}
                                <a [href]="item.page" target="_blank" rel="noopener">{{ item.page }}</a>
                            </div>
                        }
                        <div class="msg-actions">
                            <a mat-flat-button color="primary" [href]="reply(item)" data-testid="reply">
                                <i class="fa-solid fa-reply me-1"></i>{{ 'admin.messages.reply' | transloco }}
                            </a>
                            @switch (item.status) {
                                @case ('new') {
                                    <button mat-stroked-button (click)="move(item, 'done')">
                                        <i class="fa-solid fa-check me-1"></i>{{ 'admin.messages.mark_done' | transloco }}
                                    </button>
                                }
                                @case ('done') {
                                    <button mat-stroked-button (click)="move(item, 'new')">{{ 'admin.messages.mark_new' | transloco }}</button>
                                }
                                @case ('spam') {
                                    <button mat-stroked-button (click)="move(item, 'new')">{{ 'admin.messages.not_spam' | transloco }}</button>
                                }
                            }
                            <button mat-button color="warn" (click)="remove(item)">{{ 'common.actions.delete' | transloco }}</button>
                        </div>
                    </article>
                }
            </div>

            @if (inbox.loading()) {
                <p class="text-muted">{{ 'common.state.loading' | transloco }}</p>
            } @else if (inbox.hasMore()) {
                <button mat-stroked-button (click)="inbox.load(status(), true)">{{ 'admin.messages.load_more' | transloco }}</button>
            }
        </div>
    `,
    styles: [`
        .msg-empty { text-align: center; padding: 3rem 1rem; color: var(--bs-secondary-color, #6c757d); }
        .msg-empty i { font-size: 2rem; margin-bottom: 0.75rem; }
        .msg-list { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1rem; }
        .msg-item {
            display: flex;
            flex-direction: column;
            gap: 0.5rem;
            padding: 1rem;
            border: 1px solid var(--bs-border-color, #dee2e6);
            border-radius: 12px;
            background: var(--bs-body-bg, #fff);
        }
        .msg-meta { display: flex; flex-wrap: wrap; align-items: baseline; gap: 0.25rem 0.75rem; }
        .msg-meta a { font-size: 0.875rem; }
        .msg-subject { font-size: 1rem; font-weight: 600; margin: 0; }
        .msg-text { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
        .msg-page { font-size: 0.85rem; }
        .msg-page i { margin-right: 0.25rem; }
        .msg-actions { display: flex; flex-wrap: wrap; gap: 0.5rem; }
    `],
})
export default class MessagesInboxPage implements OnInit {
    readonly inbox = inject(MessagesAdminService);
    private t = injectT();

    readonly status = signal<MessageStatus>('new');

    ngOnInit(): void {
        void this.inbox.load(this.status()).catch((err) => console.error('Messages:', err));
    }

    setStatus(status: MessageStatus): void {
        this.status.set(status);
        void this.inbox.load(status).catch((err) => console.error('Messages:', err));
    }

    reply(item: ContactMessageItem): string {
        return replyLink(item);
    }

    async move(item: ContactMessageItem, status: MessageStatus): Promise<void> {
        await this.inbox.setStatus(item, status);
    }

    async remove(item: ContactMessageItem): Promise<void> {
        if (!confirm(this.t('admin.messages.delete_confirm'))) return;
        await this.inbox.remove(item);
    }
}
