import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, OnChanges, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { ToastService } from '../../../../../shared/services/toast.service';
import { AudienceService } from '../../(audience)/audience.service';
import { AppListCondition, IList } from '../../(audience)/audience.model';
import { Functions } from '@angular/fire/functions';
import { MatRadioModule } from '@angular/material/radio';
import { arcCallable } from '../../../../core/config/arc-functions';
import { AppListConditionsComponent } from '../(app-list-conditions)/app-list-conditions.component';

export type ListDrawerMode = 'add' | 'edit';

/**
 * Right-side drawer content for the Lists page: create a manual list or an App
 * users (live) list (CO6.5b, offered when a host app is connected), rename a
 * list, or change a live list's conditions. Owns its mutations via
 * AudienceService and emits `saved`/`close` for the host.
 */
@Component({
    selector: 'arc-list-drawer',
    standalone: true,
    imports: [CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule, MatFormFieldModule, MatRadioModule, AppListConditionsComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="side-panel">
        <div class="panel-header">
            <h5>{{ mode === 'edit' ? 'Edit list' : 'Create list' }}</h5>
            <button class="close-btn" (click)="close.emit()"><i class="fas fa-times"></i></button>
        </div>

        <div class="flex-grow-1">
            @if (mode === 'add' && appConnected()) {
                <mat-radio-group class="d-flex flex-column gap-1 mb-3" [(ngModel)]="kind" aria-label="List type">
                    <mat-radio-button value="manual">Contacts: people you add, import or collect with forms</mat-radio-button>
                    <mat-radio-button value="app">App users (live): people from your app who match conditions</mat-radio-button>
                </mat-radio-group>
            }
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>List name</mat-label>
                <input matInput [(ngModel)]="name" (keyup.enter)="submit()" placeholder="e.g. Newsletter" />
            </mat-form-field>
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>Description (optional)</mat-label>
                <textarea matInput rows="3" [(ngModel)]="description"></textarea>
            </mat-form-field>
            @if (kind === 'app') {
                <h6 class="mb-1">Who is in this list</h6>
                <arc-app-list-conditions [conditions]="conditions" (conditionsChange)="conditions = $event" />
            }
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
    private functions = inject(Functions);

    busy = signal(false);
    /** Whether a host app is connected, so App users (live) lists can be made. */
    appConnected = signal(false);
    name = '';
    description = '';
    kind: 'manual' | 'app' = 'manual';
    conditions: AppListCondition[] = [];

    constructor() {
        arcCallable<unknown, { location: { configured: boolean } }>(this.functions, 'appAudienceStatus')({})
            .then((res) => this.appConnected.set(!!res.data.location.configured))
            .catch(() => this.appConnected.set(false));
    }

    ngOnChanges(): void {
        this.name = this.list?.name ?? '';
        this.description = this.list?.description ?? '';
        this.kind = this.list?.type === 'app' ? 'app' : 'manual';
        this.conditions = this.list?.conditions ?? [];
    }

    async submit(): Promise<void> {
        const name = this.name.trim();
        if (!name) return;
        this.busy.set(true);
        try {
            const live = this.kind === 'app';
            if (this.mode === 'edit' && this.list) {
                await this.audience.updateList(this.list.id, {
                    name, description: this.description.trim(), ...(live ? { conditions: this.conditions } : {}),
                });
                this.toast.success('List updated');
            } else {
                if (live) await this.audience.createList(name, this.description.trim(), this.conditions);
                else await this.audience.createList(name, this.description.trim());
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
