import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { TranslocoPipe } from '@jsverse/transloco';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { EntryOrderService, OrderedEntry } from './entry-order.service';

export interface ArrangeEntriesData {
    slug: string;
    /** The type's plural name, for the title. */
    typeName: string;
}

/** Above this many entries, say that the list page shows only the first 100. */
export const ARRANGE_WARN_ABOVE = 200;

/**
 * Puts a content type's entries in its own order (specs/site-sections-spec.md,
 * SS2): drag a row, or move it with its arrows, then Save. Closes with true
 * when the order was saved.
 */
@Component({
    selector: 'arc-arrange-entries-dialog',
    standalone: true,
    imports: [MatDialogModule, MatButtonModule, MatIconModule, CdkDropList, CdkDrag, CdkDragHandle, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <h2 mat-dialog-title>{{ 'admin.contents.arrange.title' | transloco: { type: data.typeName } }}</h2>
    <mat-dialog-content>
        <p class="text-muted small mb-3">{{ 'admin.contents.arrange.hint' | transloco }}</p>
        @if (loading()) {
            <div class="d-flex align-items-center gap-2 py-3">
                <span class="spinner-border spinner-border-sm" role="status"></span>
                <span>{{ 'admin.contents.arrange.loading' | transloco }}</span>
            </div>
        } @else if (!entries().length) {
            <p class="py-3 mb-0">{{ 'admin.contents.arrange.empty' | transloco }}</p>
        } @else {
            @if (entries().length > warnAbove) {
                <div class="alert alert-warning small py-2" data-testid="arrange-warning">{{ 'admin.contents.arrange.too_many' | transloco }}</div>
            }
            <ol class="arrange-list" cdkDropList (cdkDropListDropped)="drop($event)" data-testid="arrange-list">
                @for (entry of entries(); track entry.id; let i = $index; let last = $last) {
                <li class="arrange-row" cdkDrag cdkDragLockAxis="y">
                    <span class="arrange-handle" cdkDragHandle [attr.aria-label]="'admin.contents.arrange.drag' | transloco">
                        <mat-icon>drag_indicator</mat-icon>
                    </span>
                    <span class="arrange-position">{{ i + 1 }}</span>
                    <span class="arrange-title">{{ entry.title || ('admin.contents.arrange.untitled' | transloco) }}</span>
                    @if (!entry.published) {
                        <span class="badge text-bg-light arrange-draft">{{ 'admin.contents.arrange.draft' | transloco }}</span>
                    }
                    <button mat-icon-button type="button" [disabled]="i === 0" (click)="move(i, -1)"
                        [attr.aria-label]="'admin.contents.arrange.move_up' | transloco: { title: entry.title }">
                        <mat-icon>arrow_upward</mat-icon>
                    </button>
                    <button mat-icon-button type="button" [disabled]="last" (click)="move(i, 1)"
                        [attr.aria-label]="'admin.contents.arrange.move_down' | transloco: { title: entry.title }">
                        <mat-icon>arrow_downward</mat-icon>
                    </button>
                </li>
                }
            </ol>
        }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
        <button mat-button type="button" (click)="dialogRef.close(false)" [disabled]="saving()">{{ 'common.actions.cancel' | transloco }}</button>
        <button mat-raised-button color="primary" type="button" (click)="save()"
            [disabled]="saving() || loading() || !changed()" data-testid="arrange-save">
            {{ (saving() ? 'admin.contents.arrange.saving' : 'common.actions.save') | transloco }}
        </button>
    </mat-dialog-actions>
    `,
    styles: [`
        .arrange-list { list-style: none; margin: 0; padding: 0; max-height: 60vh; overflow-y: auto; }
        .arrange-row {
            display: flex; align-items: center; gap: 0.5rem; padding: 0.25rem 0.5rem;
            border: 1px solid var(--bs-border-color, #dee2e6); border-radius: 6px; margin-bottom: 0.375rem;
            background: var(--bs-body-bg, #fff);
        }
        .arrange-handle { cursor: grab; color: #6c757d; display: inline-flex; }
        .arrange-position { width: 2rem; text-align: right; color: #6c757d; font-variant-numeric: tabular-nums; }
        .arrange-title { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .cdk-drag-preview { box-shadow: 0 6px 20px rgba(0, 0, 0, 0.15); }
        .cdk-drag-placeholder { opacity: 0.3; }
        .cdk-drop-list-dragging .arrange-row:not(.cdk-drag-placeholder) { transition: transform 200ms ease; }
    `],
})
export class ArrangeEntriesDialogComponent {
    readonly data = inject<ArrangeEntriesData>(MAT_DIALOG_DATA);
    readonly dialogRef = inject(MatDialogRef<ArrangeEntriesDialogComponent, boolean>);
    private entryOrder = inject(EntryOrderService);
    private notify = inject(NotifyService);

    readonly warnAbove = ARRANGE_WARN_ABOVE;
    readonly entries = signal<OrderedEntry[]>([]);
    readonly loading = signal(true);
    readonly saving = signal(false);
    readonly changed = signal(false);

    constructor() {
        void this.load();
    }

    private async load(): Promise<void> {
        try {
            this.entries.set(await this.entryOrder.load(this.data.slug));
        } catch (error) {
            console.error('Could not load entries to arrange:', error);
            this.notify.error('admin.contents.arrange.load_failed');
        } finally {
            this.loading.set(false);
        }
    }

    drop(event: CdkDragDrop<OrderedEntry[]>): void {
        if (event.previousIndex === event.currentIndex) return;
        const next = [...this.entries()];
        moveItemInArray(next, event.previousIndex, event.currentIndex);
        this.entries.set(next);
        this.changed.set(true);
    }

    /** Moves the entry at `index` one place up (-1) or down (1). */
    move(index: number, by: -1 | 1): void {
        const to = index + by;
        if (to < 0 || to >= this.entries().length) return;
        const next = [...this.entries()];
        moveItemInArray(next, index, to);
        this.entries.set(next);
        this.changed.set(true);
    }

    async save(): Promise<void> {
        this.saving.set(true);
        try {
            await this.entryOrder.save(this.data.slug, this.entries().map((entry) => entry.id));
            this.notify.success('admin.contents.arrange.saved');
            this.dialogRef.close(true);
        } catch (error) {
            console.error('Could not save the order:', error);
            this.notify.error('admin.contents.arrange.save_failed');
            this.saving.set(false);
        }
    }
}
