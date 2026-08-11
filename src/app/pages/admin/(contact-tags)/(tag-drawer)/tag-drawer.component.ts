import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, OnChanges, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ToastService } from '../../../../../shared/services/toast.service';
import { AudienceService } from '../../(audience)/audience.service';
import { ITag, tagIdFromLabel } from '../../(audience)/audience.model';

export type TagDrawerMode = 'add' | 'edit';

/** Swatches offered for a tag colour; admins may still type any hex. */
const TAG_COLORS = ['#6b7280', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];

/**
 * Right-side drawer for the Tags page: create or edit a global audience tag.
 *
 * A tag's id is a slug of its label, so renaming keeps the id (assignments
 * survive) and creating a label that slugs to an existing tag edits that tag
 * rather than making a second one.
 */
@Component({
    selector: 'arc-tag-drawer',
    standalone: true,
    imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule, MatFormFieldModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="side-panel">
        <div class="panel-header">
            <h5>{{ mode === 'edit' ? 'Edit tag' : 'Create tag' }}</h5>
            <button class="close-btn" (click)="close.emit()"><i class="fas fa-times"></i></button>
        </div>

        <div class="flex-grow-1">
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>Label</mat-label>
                <input matInput [(ngModel)]="label" (keyup.enter)="submit()" placeholder="e.g. VIP" />
                @if (mode === 'add' && slug()) {
                    <mat-hint>id: {{ slug() }}</mat-hint>
                }
                @if (mode === 'add' && label.trim() && !slug()) {
                    <mat-hint class="text-danger">Needs at least one letter or number</mat-hint>
                }
            </mat-form-field>

            <label class="form-label small text-muted mt-3 d-block">Colour</label>
            <div class="d-flex gap-2 flex-wrap mb-3">
                @for (c of colors; track c) {
                    <button type="button" class="tag-swatch" [class.is-selected]="color === c"
                        [style.background]="c" [attr.aria-label]="c" (click)="color = c"></button>
                }
            </div>

            <div class="d-flex align-items-center gap-2">
                <span class="small text-muted">Preview:</span>
                <span class="tag-chip" [style.background]="color">{{ label.trim() || 'Tag' }}</span>
            </div>
        </div>

        <div class="panel-actions">
            <button mat-stroked-button (click)="close.emit()">Cancel</button>
            <button mat-flat-button color="primary" [disabled]="busy() || !slug()" (click)="submit()">
                <mat-icon>{{ mode === 'edit' ? 'save' : 'add' }}</mat-icon>
                {{ mode === 'edit' ? 'Save' : 'Create tag' }}
            </button>
        </div>
    </div>
    `,
    styles: [`
        .tag-swatch {
            width: 28px; height: 28px; border-radius: 50%; border: 2px solid transparent;
            cursor: pointer; padding: 0;
        }
        .tag-swatch.is-selected { border-color: #111827; box-shadow: 0 0 0 2px #fff inset; }
        .tag-chip {
            display: inline-block; padding: 2px 10px; border-radius: 999px;
            color: #fff; font-size: 12px; font-weight: 600;
        }
    `],
})
export class TagDrawerComponent implements OnChanges {
    @Input() mode: TagDrawerMode = 'add';
    @Input() tag: ITag | null = null;
    @Output() close = new EventEmitter<void>();
    @Output() saved = new EventEmitter<void>();

    private audience = inject(AudienceService);
    private toast = inject(ToastService);

    readonly colors = TAG_COLORS;
    busy = signal(false);
    label = '';
    color = TAG_COLORS[0];

    /** Shown while adding so admins can see the id their label produces. */
    slug(): string {
        return tagIdFromLabel(this.label);
    }

    ngOnChanges(): void {
        this.label = this.tag?.label ?? '';
        this.color = this.tag?.color ?? TAG_COLORS[0];
    }

    async submit(): Promise<void> {
        const label = this.label.trim();
        if (!tagIdFromLabel(label)) return;
        this.busy.set(true);
        try {
            if (this.mode === 'edit' && this.tag) {
                await this.audience.updateTag(this.tag.id, { label, color: this.color });
                this.toast.success('Tag updated');
            } else {
                await this.audience.createTag(label, this.color);
                this.toast.success('Tag created');
            }
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error(e);
            this.toast.error(this.mode === 'edit' ? 'Failed to update tag' : 'Failed to create tag');
        } finally {
            this.busy.set(false);
        }
    }
}
