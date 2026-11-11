import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, OnChanges, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { TranslocoPipe } from '@jsverse/transloco';
import { NotifyService } from '../../../../../shared/services/notify.service';
import { AudienceService } from '../../(audience)/audience.service';
import { ITag, tagIdFromLabel } from '../../(audience)/audience.model';

export type TagDrawerMode = 'add' | 'edit';

/** Swatches offered for a tag colour; admins may still type any hex. */
const TAG_COLORS = ['#6b7280', '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899'];
/** The swatches' names, read out by a screen reader (admin.audience.tags.color_*). */
const TAG_COLOR_NAMES = ['grey', 'red', 'amber', 'green', 'blue', 'purple', 'pink'];

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
    imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule, MatFormFieldModule, TranslocoPipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="side-panel">
        <div class="panel-header">
            <h5>{{ (mode === 'edit' ? 'admin.audience.tags.edit' : 'admin.audience.tags.create') | transloco }}</h5>
            <button type="button" class="close-btn" (click)="close.emit()" [attr.aria-label]="'common.actions.close' | transloco"><i class="fas fa-times" aria-hidden="true"></i></button>
        </div>

        <div class="flex-grow-1">
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>{{ 'admin.audience.fields.label' | transloco }}</mat-label>
                <input matInput [(ngModel)]="label" (keyup.enter)="submit()" [placeholder]="'admin.audience.tags.label_placeholder' | transloco" />
                @if (mode === 'add' && slug()) {
                    <mat-hint>{{ 'admin.audience.tags.id_hint' | transloco: { id: slug() } }}</mat-hint>
                }
                @if (mode === 'add' && label.trim() && !slug()) {
                    <mat-hint class="text-danger">{{ 'admin.audience.fields.label_invalid' | transloco }}</mat-hint>
                }
            </mat-form-field>

            <span class="form-label small text-muted mt-3 d-block" id="tag-colour-label">{{ 'admin.audience.tags.colour' | transloco }}</span>
            <div class="d-flex gap-2 flex-wrap mb-3" role="group" aria-labelledby="tag-colour-label">
                @for (c of colors; track c; let i = $index) {
                    <button type="button" class="tag-swatch" [class.is-selected]="color === c"
                        [style.background]="c" [attr.aria-label]="('admin.audience.tags.color_' + colorNames[i]) | transloco"
                        [attr.aria-pressed]="color === c" (click)="color = c"></button>
                }
            </div>

            <div class="d-flex align-items-center gap-2">
                <span class="small text-muted">{{ 'admin.audience.tags.preview' | transloco }}</span>
                <span class="tag-chip" [style.background]="color">{{ label.trim() || ('admin.audience.tags.tag' | transloco) }}</span>
            </div>
        </div>

        <div class="panel-actions">
            <button mat-stroked-button (click)="close.emit()">{{ 'common.actions.cancel' | transloco }}</button>
            <button mat-flat-button color="primary" [disabled]="busy() || !slug()" (click)="submit()">
                <mat-icon>{{ mode === 'edit' ? 'save' : 'add' }}</mat-icon>
                {{ (mode === 'edit' ? 'common.actions.save' : 'admin.audience.tags.create') | transloco }}
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
    private notify = inject(NotifyService);

    readonly colors = TAG_COLORS;
    readonly colorNames = TAG_COLOR_NAMES;
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
                this.notify.success('admin.audience.tags.updated');
            } else {
                await this.audience.createTag(label, this.color);
                this.notify.success('admin.audience.tags.created');
            }
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error('Saving the tag failed', e);
            this.notify.error(this.mode === 'edit' ? 'admin.audience.tags.update_failed' : 'admin.audience.tags.create_failed');
        } finally {
            this.busy.set(false);
        }
    }
}
