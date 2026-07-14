import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, OnChanges, Output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { ToastService } from '../../../../../shared/services/toast.service';
import { DripService, DripCampaign, DripStep, TemplateOption } from '../drip.service';
import { IList } from '../../(audience)/audience.model';

export type DripDrawerMode = 'add' | 'edit';

/**
 * Right-side drawer content for the Drips page: create a campaign or edit an
 * existing one's name, enroll-existing flag and step sequence. The enrollment
 * list is fixed at creation (it's the trigger source), so it's read-only when
 * editing. Status transitions live on the list row, not here.
 */
@Component({
    selector: 'arc-drip-drawer',
    standalone: true,
    imports: [
        CommonModule, FormsModule, MatButtonModule, MatIconModule, MatInputModule,
        MatFormFieldModule, MatSelectModule, MatSlideToggleModule,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="side-panel">
        <div class="panel-header">
            <h5>{{ mode === 'edit' ? 'Edit campaign' : 'New campaign' }}</h5>
            <button class="close-btn" (click)="close.emit()"><i class="fas fa-times"></i></button>
        </div>

        <div class="flex-grow-1">
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>Campaign name</mat-label>
                <input matInput [(ngModel)]="name" />
            </mat-form-field>

            @if (mode === 'add') {
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>List</mat-label>
                <mat-select [(ngModel)]="listId">
                    @for (l of lists; track l.id) { <mat-option [value]="l.id">{{ l.name }}</mat-option> }
                </mat-select>
            </mat-form-field>
            } @else {
            <p class="small text-muted mb-3">List: <strong>{{ listName }}</strong> <span class="ms-1">(fixed after creation)</span></p>
            }

            <mat-slide-toggle class="mb-3" [(ngModel)]="enrollExisting" color="primary">
                Enroll existing members on activate
            </mat-slide-toggle>

            <!-- Steps -->
            <h6 class="text-uppercase text-muted mt-2 mb-2" style="font-size: 0.75rem;">Steps</h6>
            @for (s of steps(); track s.id; let i = $index) {
            <div class="d-flex gap-2 align-items-center mb-2">
                <span class="status-badge is-neutral">{{ i + 1 }}</span>
                <mat-form-field appearance="outline" class="flex-grow-1 mb-0">
                    <mat-label>Template</mat-label>
                    <mat-select [(ngModel)]="s.templateId">
                        @for (t of templates; track t.id) { <mat-option [value]="t.id">{{ t.label }}</mat-option> }
                    </mat-select>
                </mat-form-field>
                <mat-form-field appearance="outline" style="width: 110px;" class="mb-0">
                    <mat-label>Delay (h)</mat-label>
                    <input matInput type="number" [(ngModel)]="s.delayHours" />
                </mat-form-field>
                <button mat-icon-button color="warn" (click)="removeStep(i)"><mat-icon>delete</mat-icon></button>
            </div>
            } @empty {
            <p class="small text-muted">No steps yet — add the first email below.</p>
            }
            <button mat-stroked-button (click)="addStep()"><mat-icon>add</mat-icon> Add step</button>
        </div>

        <div class="panel-actions">
            <button mat-stroked-button (click)="close.emit()">Cancel</button>
            <button mat-flat-button color="primary" [disabled]="busy() || !name.trim()" (click)="submit()">
                <mat-icon>{{ mode === 'edit' ? 'save' : 'add' }}</mat-icon>
                {{ mode === 'edit' ? 'Save campaign' : 'Create campaign' }}
            </button>
        </div>
    </div>
    `,
})
export class DripDrawerComponent implements OnChanges {
    @Input() mode: DripDrawerMode = 'add';
    @Input() campaign: DripCampaign | null = null;
    @Input() lists: IList[] = [];
    @Input() templates: TemplateOption[] = [];
    @Output() close = new EventEmitter<void>();
    @Output() saved = new EventEmitter<void>();

    private service = inject(DripService);
    private toast = inject(ToastService);

    busy = signal(false);
    name = '';
    listId = '';
    listName = '';
    enrollExisting = false;
    steps = signal<DripStep[]>([]);

    ngOnChanges(): void {
        const c = this.campaign;
        this.name = c?.name ?? '';
        this.listId = c?.listId ?? '';
        this.listName = this.lists.find((l) => l.id === c?.listId)?.name || c?.listId || '';
        this.enrollExisting = c?.enrollExistingOnActivate ?? false;
        // clone steps so edits stay local until save
        this.steps.set((c?.steps || []).map((s) => ({ ...s })));
    }

    addStep(): void {
        this.steps.update((arr) => [...arr, { id: 'step_' + arr.length + '_' + this.name.length, templateId: '', delayHours: 24 }]);
    }

    removeStep(i: number): void {
        this.steps.update((arr) => arr.filter((_, idx) => idx !== i));
    }

    async submit(): Promise<void> {
        const name = this.name.trim();
        if (!name) return;
        const steps = this.steps();
        if (steps.some((s) => !s.templateId)) { this.toast.error('Every step needs a template'); return; }
        this.busy.set(true);
        try {
            if (this.mode === 'edit' && this.campaign) {
                await this.service.updateCampaign(this.campaign.id, { name, enrollExistingOnActivate: this.enrollExisting });
                await this.service.saveSteps(this.campaign.id, steps);
                this.toast.success('Campaign saved');
            } else {
                if (!this.listId) { this.toast.error('Pick a list'); this.busy.set(false); return; }
                const id = await this.service.createCampaign(name, this.listId, this.enrollExisting);
                if (steps.length) await this.service.saveSteps(id, steps);
                this.toast.success('Campaign created (draft)');
            }
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error(e);
            this.toast.error(this.mode === 'edit' ? 'Failed to save campaign' : 'Failed to create campaign');
        } finally {
            this.busy.set(false);
        }
    }
}
