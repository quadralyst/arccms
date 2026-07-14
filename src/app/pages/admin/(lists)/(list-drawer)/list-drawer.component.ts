import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, OnChanges, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ToastService } from '../../../../../shared/services/toast.service';
import { AudienceService } from '../../(audience)/audience.service';
import { IList } from '../../(audience)/audience.model';

export type ListDrawerMode = 'add' | 'edit';

/**
 * Right-side drawer content for the Lists page: create a manual list or rename
 * an existing one. Owns its mutations via AudienceService and emits
 * `saved`/`close` for the host.
 */
@Component({
    selector: 'arc-list-drawer',
    standalone: true,
    imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule, MatFormFieldModule],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="side-panel">
        <div class="panel-header">
            <h5>{{ mode === 'edit' ? 'Edit list' : 'Create list' }}</h5>
            <button class="close-btn" (click)="close.emit()"><i class="fas fa-times"></i></button>
        </div>

        <div class="flex-grow-1">
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>List name</mat-label>
                <input matInput [(ngModel)]="name" (keyup.enter)="submit()" placeholder="e.g. Newsletter" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>Description (optional)</mat-label>
                <textarea matInput rows="3" [(ngModel)]="description"></textarea>
            </mat-form-field>
        </div>

        <div class="panel-actions">
            <button mat-stroked-button (click)="close.emit()">Cancel</button>
            <button mat-flat-button color="primary" [disabled]="busy() || !name.trim()" (click)="submit()">
                <mat-icon>{{ mode === 'edit' ? 'save' : 'add' }}</mat-icon>
                {{ mode === 'edit' ? 'Save' : 'Create list' }}
            </button>
        </div>
    </div>
    `,
})
export class ListDrawerComponent implements OnChanges {
    @Input() mode: ListDrawerMode = 'add';
    @Input() list: IList | null = null;
    @Output() close = new EventEmitter<void>();
    @Output() saved = new EventEmitter<void>();

    private audience = inject(AudienceService);
    private toast = inject(ToastService);

    busy = signal(false);
    name = '';
    description = '';

    ngOnChanges(): void {
        this.name = this.list?.name ?? '';
        this.description = this.list?.description ?? '';
    }

    async submit(): Promise<void> {
        const name = this.name.trim();
        if (!name) return;
        this.busy.set(true);
        try {
            if (this.mode === 'edit' && this.list) {
                await this.audience.updateList(this.list.id, { name, description: this.description.trim() });
                this.toast.success('List updated');
            } else {
                await this.audience.createList(name, this.description.trim());
                this.toast.success('List created');
            }
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error(e);
            this.toast.error(this.mode === 'edit' ? 'Failed to update list' : 'Failed to create list');
        } finally {
            this.busy.set(false);
        }
    }
}
