import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import { injectT } from '../../../core/i18n/inject-t';
import { wordDiff, type Change, type WordPart } from '../../../core/editing/compare';
import type { EditingHold } from '../../../core/editing/hold';
import { LoaderComponent } from '../../../../shared/components/loader/loader.component';

/** A card someone changed on the page under review (VE-D81). */
export interface ReviewCard {
    type: string;
    id: string;
    name: string;
    take: boolean;
}

export interface ReviewData {
    /** What is being reviewed: the entry's title, or the page's name. */
    title: string;
    /** Someone else's work, or null for this person's own. */
    hold: EditingHold | null;
    /** Never published: everything is new. */
    isNew: boolean;
    /** Reads what differs from what is live. */
    load: () => Promise<Change[]>;
    /** A change's name, such as "Title" or "Hero heading", and a language's. */
    label: (change: Change) => string;
    language: (code: string) => string;
    /** What an empty value means here, such as the file's own text. */
    emptyText: string;
    /** Puts one change back (this person's own work only). */
    putBack?: (change: Change) => Promise<void>;
    /** Cards changed on the page by the person under review. */
    cards?: ReviewCard[];
    /** Whether Discard is offered: something is published to go back to. */
    canDiscard?: boolean;
}

export type ReviewAnswer =
    /** `seen`: the changes as they were listed. */
    | { action: 'publish' | 'takeover' | 'discard'; seen: Change[] }
    | { action: 'show'; change: Change };

/**
 * Review changes (specs/visual-editing-spec.md, VE-D80): what differs from what
 * visitors see, the old words and the new. On someone else's work it offers
 * Publish these and Take over; on your own, Put back for each and Discard.
 */
@Component({
    selector: 'arc-review-changes-dialog',
    standalone: true,
    imports: [LoaderComponent, MatDialogModule, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <h2 mat-dialog-title>{{ (data.hold ? 'admin.hold.review_theirs' : 'admin.hold.review_mine') | transloco: { name: data.hold?.name || '?', title: data.title } }}</h2>
    <mat-dialog-content>
        @if (putBackFailed()) {
            <p class="text-danger" role="alert">{{ 'admin.hold.put_back_failed' | transloco }}</p>
        }
        @if (error()) {
            <p class="text-danger" role="alert">{{ 'admin.hold.not_read' | transloco }}</p>
        } @else if (changes() === null) {
            <arc-loader kind="rows" [label]="'admin.hold.reading' | transloco"></arc-loader>
        } @else {
            @if (data.isNew) { <p class="text-muted small">{{ 'admin.hold.is_new' | transloco }}</p> }
            @if (!changes()!.length && !cards().length) { <p>{{ 'admin.hold.nothing' | transloco }}</p> }
            @for (change of changes(); track change.id) {
            <section class="change" data-testid="review-change">
                <header class="change-head">
                    <b>{{ data.label(change) }}</b>
                    @if (change.lang) { <span class="badge text-bg-light">{{ data.language(change.lang) }}</span> }
                    <span class="change-spacer"></span>
                    <button type="button" class="btn btn-link btn-sm p-0" (click)="show(change)">{{ 'admin.hold.show' | transloco }}</button>
                    @if (data.putBack) {
                    <button type="button" class="btn btn-outline-secondary btn-sm" (click)="putBack(change)" [disabled]="busy()" data-testid="put-back">{{ 'admin.hold.put_back' | transloco }}</button>
                    }
                </header>
                @if (change.kind === 'picture') {
                <div class="pictures">
                    @for (side of [change.before, change.after]; track $index) {
                    <figure>
                        <figcaption>{{ ($index ? 'admin.hold.now' : 'admin.hold.live') | transloco }}</figcaption>
                        @if (picture(side); as src) { <img [src]="src" alt=""> } @else { <span class="text-muted small">{{ side || data.emptyText }}</span> }
                    </figure>
                    }
                </div>
                } @else {
                @if (change.rows; as rows) {
                <p class="small text-muted mb-1">{{ 'admin.hold.rows' | transloco: rows }}</p>
                }
                @if (change.sameWords) {
                <p class="small text-muted mb-1">{{ 'admin.hold.same_words' | transloco }}</p>
                }
                <p class="words">
                    @for (part of parts(change); track $index) {
                        @switch (part.kind) {
                            @case ('removed') { <del [attr.aria-label]="('admin.hold.removed' | transloco) + ' ' + part.text">{{ part.text }}</del> }
                            @case ('added') { <ins [attr.aria-label]="('admin.hold.added' | transloco) + ' ' + part.text">{{ part.text }}</ins> }
                            @default { <span>{{ part.text }}</span> }
                        }
                    } @empty { <span class="text-muted">{{ data.emptyText }}</span> }
                </p>
                @if (!change.after) { <p class="small text-muted mb-0">{{ 'admin.hold.now_empty' | transloco: { text: data.emptyText } }}</p> }
                }
            </section>
            }
            @if (cards().length) {
            <section class="change" data-testid="review-cards">
                <b>{{ 'admin.hold.cards' | transloco }}</b>
                <p class="small text-muted mb-1">{{ 'admin.hold.cards_hint' | transloco }}</p>
                @for (card of cards(); track card.type + '/' + card.id) {
                <label class="d-block"><input type="checkbox" class="form-check-input me-2" [checked]="card.take" (change)="card.take = $any($event.target).checked"> {{ card.name }}</label>
                }
            </section>
            }
        }
    </mat-dialog-content>
    <mat-dialog-actions class="review-actions">
        @if (data.hold) {
        <button type="button" class="btn btn-outline-secondary" (click)="answer('takeover')" [disabled]="changes() === null" data-testid="review-takeover">{{ 'admin.hold.take_over' | transloco }}</button>
        <span class="change-spacer"></span>
        <button type="button" class="btn btn-link" (click)="ref.close()">{{ 'common.actions.close' | transloco }}</button>
        <button type="button" class="btn btn-primary" (click)="answer('publish')" [disabled]="!changes()?.length && !cards().length" data-testid="review-publish">{{ 'admin.hold.publish_these' | transloco }}</button>
        } @else {
        @if (data.canDiscard) {
        <button type="button" class="btn btn-outline-danger" (click)="answer('discard')" [disabled]="busy() || !changes()?.length" data-testid="review-discard">{{ 'admin.hold.discard' | transloco }}</button>
        }
        <span class="change-spacer"></span>
        <button type="button" class="btn btn-link" (click)="ref.close()">{{ 'common.actions.close' | transloco }}</button>
        <button type="button" class="btn btn-primary" (click)="answer('publish')" [disabled]="busy() || (!changes()?.length && !cards().length)" data-testid="review-publish">{{ 'admin.contents.editor.publish' | transloco }}</button>
        }
    </mat-dialog-actions>`,
    styles: [`
        .change { padding: 10px 0; border-top: 1px solid var(--bs-border-color, #dee2e6); }
        .change:first-of-type { border-top: 0; }
        .change-head { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
        .change-spacer { flex: 1 1 auto; }
        .words { white-space: pre-wrap; overflow-wrap: anywhere; max-height: 260px; overflow-y: auto; margin: 0; font-size: .92rem; }
        del { background: #fde2e1; color: #7a1c16; text-decoration: line-through; }
        ins { background: #d8f3df; color: #14532d; text-decoration: none; }
        .pictures { display: flex; gap: 16px; flex-wrap: wrap; }
        .pictures figure { margin: 0; max-width: 45%; }
        .pictures figcaption { font-size: .75rem; color: var(--bs-secondary-color, #6c757d); }
        .pictures img { max-width: 100%; max-height: 140px; border-radius: 6px; display: block; }
        .review-actions { display: flex; gap: 8px; }
    `],
})
export class ReviewChangesDialogComponent {
    private t = injectT();
    readonly data = inject<ReviewData>(MAT_DIALOG_DATA);
    readonly ref = inject<MatDialogRef<ReviewChangesDialogComponent, ReviewAnswer>>(MatDialogRef);
    readonly changes = signal<Change[] | null>(null);
    readonly cards = signal<ReviewCard[]>(this.data.cards ?? []);
    readonly error = signal(false);
    readonly busy = signal(false);
    readonly putBackFailed = signal(false);
    private diffs = new Map<string, WordPart[]>();

    constructor() {
        void this.read();
    }

    private async read(): Promise<void> {
        try {
            this.diffs.clear();
            this.changes.set(await this.data.load());
        } catch (error) {
            console.error('[Review] Could not read the changes:', error);
            this.error.set(true);
        }
    }

    parts(change: Change): WordPart[] {
        let parts = this.diffs.get(change.id);
        if (!parts) this.diffs.set(change.id, (parts = wordDiff(this.said(change.before), this.said(change.after))));
        return parts;
    }

    /** A yes or no as words. */
    private said(value: string): string {
        if (value !== 'true' && value !== 'false') return value;
        return this.t(value === 'true' ? 'admin.hold.yes' : 'admin.hold.no');
    }

    /** A picture's address that may be drawn: stored values are not trusted. */
    picture(value: string): string {
        return /^(https?:\/\/|\/(?!\/))/i.test(value) ? value : '';
    }

    show(change: Change): void {
        this.ref.close({ action: 'show', change });
    }

    async putBack(change: Change): Promise<void> {
        this.busy.set(true);
        this.putBackFailed.set(false);
        try {
            await this.data.putBack!(change);
            await this.read();
        } catch (error) {
            console.error('[Review] Could not put a change back:', error);
            this.putBackFailed.set(true);
        } finally {
            this.busy.set(false);
        }
    }

    answer(action: 'publish' | 'takeover' | 'discard'): void {
        this.ref.close({ action, seen: this.changes() ?? [] });
    }
}
