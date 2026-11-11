import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, EventEmitter, inject, Input, OnChanges, Output, signal, SimpleChanges } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { TranslocoPipe } from '@jsverse/transloco';
import { injectT } from '../../../../core/i18n/inject-t';
import { ToastService } from '../../../../../shared/services/toast.service';
import { NewEmailDialogComponent } from '../../../../../shared/components/new-email-dialog/new-email-dialog.component';
import { NewEmailMeta } from '../../../../../shared/email-compiler/new-template';
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
        MatFormFieldModule, MatSelectModule, MatSlideToggleModule, MatTooltipModule,
        MatDialogModule, TranslocoPipe,
    ],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
    <div class="side-panel">
        <div class="panel-header">
            <h5>{{ (mode === 'edit' ? 'admin.drips.edit_title' : 'admin.drips.new_title') | transloco }}</h5>
            <button type="button" class="close-btn" (click)="close.emit()" [attr.aria-label]="'common.actions.close' | transloco">
                <i class="fas fa-times" aria-hidden="true"></i>
            </button>
        </div>

        <div class="flex-grow-1">
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>{{ 'admin.drips.name' | transloco }}</mat-label>
                <input matInput [(ngModel)]="name" />
            </mat-form-field>

            @if (mode === 'add') {
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>{{ 'admin.drips.col_list' | transloco }}</mat-label>
                <mat-select [(ngModel)]="listId">
                    @for (l of lists; track l.id) { <mat-option [value]="l.id">{{ l.name }}</mat-option> }
                </mat-select>
            </mat-form-field>
            } @else {
            <p class="small text-muted mb-3">{{ 'admin.drips.list_label' | transloco }} <strong>{{ listName }}</strong> <span class="ms-1">{{ 'admin.drips.list_fixed' | transloco }}</span></p>
            }

            <mat-slide-toggle class="mb-3" [(ngModel)]="enrollExisting" color="primary">
                {{ 'admin.drips.enroll_existing' | transloco }}
            </mat-slide-toggle>

            <!-- Steps -->
            <h6 class="text-uppercase text-muted mt-2 mb-2" style="font-size: 0.75rem;">{{ 'admin.drips.col_steps' | transloco }}</h6>
            @for (s of steps(); track s.id; let i = $index) {
            <div class="d-flex flex-wrap gap-2 align-items-center mb-2">
                <span class="status-badge is-neutral">{{ i + 1 }}</span>
                <mat-form-field appearance="outline" class="flex-grow-1 mb-0" style="min-width: 150px;">
                    <mat-label>{{ 'admin.drips.template' | transloco }}</mat-label>
                    <mat-select [(ngModel)]="s.templateId">
                        @for (t of templates; track t.id) { <mat-option [value]="t.id">{{ t.label }}</mat-option> }
                    </mat-select>
                </mat-form-field>
                <button mat-icon-button type="button" color="primary" [disabled]="busy()"
                    [matTooltip]="'admin.drips.new_email_for_step' | transloco"
                    [attr.aria-label]="'admin.drips.new_email_for_step' | transloco" (click)="newEmailForStep(i)">
                    <mat-icon aria-hidden="true">note_add</mat-icon>
                </button>
                <mat-form-field appearance="outline" style="width: 110px;" class="mb-0">
                    <mat-label>{{ 'admin.drips.delay_hours' | transloco }}</mat-label>
                    <input matInput type="number" [(ngModel)]="s.delayHours" />
                </mat-form-field>
                <button mat-icon-button type="button" color="warn" (click)="removeStep(i)"
                    [attr.aria-label]="'admin.drips.delete_step' | transloco: { number: i + 1 }">
                    <mat-icon aria-hidden="true">delete</mat-icon>
                </button>
            </div>
            } @empty {
            <p class="small text-muted">{{ 'admin.drips.no_steps' | transloco }}</p>
            }
            <button mat-stroked-button type="button" (click)="addStep()"><mat-icon aria-hidden="true">add</mat-icon> {{ 'admin.drips.add_step' | transloco }}</button>
            <p class="small text-muted mt-2 mb-0">{{ 'admin.drips.step_hint' | transloco }}</p>
        </div>

        <div class="panel-actions">
            <button mat-stroked-button type="button" (click)="close.emit()">{{ 'common.actions.cancel' | transloco }}</button>
            <button mat-flat-button type="button" color="primary" [disabled]="busy() || !name.trim()" (click)="submit()">
                <mat-icon aria-hidden="true">{{ mode === 'edit' ? 'save' : 'add' }}</mat-icon>
                {{ (mode === 'edit' ? 'admin.drips.save' : 'admin.drips.create') | transloco }}
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
    private dialog = inject(MatDialog);
    private readonly t = injectT();

    busy = signal(false);
    name = '';
    listId = '';
    listName = '';
    enrollExisting = false;
    steps = signal<DripStep[]>([]);

    ngOnChanges(changes: SimpleChanges): void {
        // Re-seed local form state only when the campaign being edited changes:
        // NOT on every input change. The realtime `templates` input updates when
        // an inline "New email" is created, and a blanket reset here would wipe
        // unsaved step edits (including the freshly created step's template).
        if (changes['campaign']) {
            const c = this.campaign;
            this.name = c?.name ?? '';
            this.listId = c?.listId ?? '';
            this.enrollExisting = c?.enrollExistingOnActivate ?? false;
            // clone steps so edits stay local until save
            this.steps.set((c?.steps || []).map((s) => ({ ...s })));
        }
        if (changes['campaign'] || changes['lists']) {
            const c = this.campaign;
            this.listName = this.lists.find((l) => l.id === c?.listId)?.name || c?.listId || '';
        }
    }

    addStep(): void {
        this.steps.update((arr) => [...arr, { id: 'step_' + arr.length + '_' + this.name.length, templateId: '', delayHours: 24 }]);
    }

    /**
     * Create a new email inline and link it to the given step, so an admin can
     * author a step's email without leaving the campaign. The realtime templates
     * list picks up the new doc; we set the step's templateId to it immediately.
     */
    async newEmailForStep(index: number): Promise<void> {
        const meta = (await firstValueFrom(
            this.dialog.open(NewEmailDialogComponent, { width: '460px' }).afterClosed(),
        )) as NewEmailMeta | undefined;
        if (!meta) return;
        this.busy.set(true);
        try {
            const id = await this.service.createTemplate(meta);
            this.steps.update((arr) => arr.map((s, i) => (i === index ? { ...s, templateId: id } : s)));
            this.toast.success(this.t('admin.drips.email_created'));
        } catch (e) {
            console.error(e);
            this.toast.error(this.t('admin.drips.email_create_failed'));
        } finally {
            this.busy.set(false);
        }
    }

    removeStep(i: number): void {
        this.steps.update((arr) => arr.filter((_, idx) => idx !== i));
    }

    async submit(): Promise<void> {
        const name = this.name.trim();
        if (!name) return;
        const steps = this.steps();
        if (steps.some((s) => !s.templateId)) { this.toast.error(this.t('admin.drips.step_needs_template')); return; }
        this.busy.set(true);
        try {
            if (this.mode === 'edit' && this.campaign) {
                await this.service.updateCampaign(this.campaign.id, { name, enrollExistingOnActivate: this.enrollExisting });
                await this.service.saveSteps(this.campaign.id, steps);
                this.toast.success(this.t('admin.drips.saved'));
            } else {
                if (!this.listId) { this.toast.error(this.t('admin.drips.pick_list')); this.busy.set(false); return; }
                const id = await this.service.createCampaign(name, this.listId, this.enrollExisting);
                if (steps.length) await this.service.saveSteps(id, steps);
                this.toast.success(this.t('admin.drips.created'));
            }
            this.saved.emit();
            this.close.emit();
        } catch (e) {
            console.error(e);
            this.toast.error(this.t(this.mode === 'edit' ? 'admin.drips.save_failed' : 'admin.drips.create_failed'));
        } finally {
            this.busy.set(false);
        }
    }
}
