import { Component, inject } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import {
    MatDialogActions,
    MatDialogContent,
    MatDialogRef,
    MatDialogTitle,
} from '@angular/material/dialog';
import { TranslocoPipe } from '@jsverse/transloco';
import { NewEmailMeta } from '../../email-compiler/new-template';

/**
 * Collects the metadata for a brand-new email template (title, subject,
 * category) and returns a {@link NewEmailMeta} — or undefined on cancel. Used
 * where there's no inline metadata bar to fill in, e.g. the drip drawer's
 * inline "New email" action. The caller owns the actual Firestore write.
 */
@Component({
    selector: 'arc-new-email-dialog',
    standalone: true,
    imports: [
        ReactiveFormsModule, MatButtonModule, MatIconModule,
        MatFormFieldModule, MatInputModule, MatSelectModule,
        MatDialogTitle, MatDialogContent, MatDialogActions, TranslocoPipe,
    ],
    template: `
        <h2 mat-dialog-title>{{ 'common.new_email.title' | transloco }}</h2>
        <mat-dialog-content>
            <form [formGroup]="form">
                <mat-form-field appearance="outline" class="w-100">
                    <mat-label>{{ 'common.new_email.name' | transloco }}</mat-label>
                    <input matInput formControlName="title" [placeholder]="'common.new_email.name_placeholder' | transloco" cdkFocusInitial />
                    @if (form.controls.title.touched && form.controls.title.invalid) {
                    <mat-error>{{ 'common.new_email.name_required' | transloco }}</mat-error>
                    }
                </mat-form-field>
                <mat-form-field appearance="outline" class="w-100">
                    <mat-label>{{ 'common.new_email.subject' | transloco }}</mat-label>
                    <input matInput formControlName="subject" [placeholder]="'common.new_email.subject_placeholder' | transloco" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="w-100">
                    <mat-label>{{ 'common.new_email.category' | transloco }}</mat-label>
                    <mat-select formControlName="category">
                        <mat-option value="marketing">{{ 'common.new_email.marketing' | transloco }}</mat-option>
                        <mat-option value="transactional">{{ 'common.new_email.transactional' | transloco }}</mat-option>
                    </mat-select>
                </mat-form-field>
                <p class="text-muted small mb-0">
                    {{ 'common.new_email.note' | transloco }}
                </p>
            </form>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-stroked-button (click)="cancel()">{{ 'common.actions.cancel' | transloco }}</button>
            <button mat-flat-button color="primary" (click)="confirm()">
                <mat-icon aria-hidden="true">add</mat-icon> {{ 'common.new_email.create' | transloco }}
            </button>
        </mat-dialog-actions>
    `,
})
export class NewEmailDialogComponent {
    private readonly dialogRef = inject(MatDialogRef<NewEmailDialogComponent, NewEmailMeta>);

    form = new FormGroup({
        title: new FormControl('', { nonNullable: true, validators: [Validators.required] }),
        subject: new FormControl('', { nonNullable: true }),
        category: new FormControl<'transactional' | 'marketing'>('marketing', { nonNullable: true }),
    });

    confirm(): void {
        if (this.form.invalid) {
            this.form.markAllAsTouched();
            return;
        }
        const { title, subject, category } = this.form.getRawValue();
        this.dialogRef.close({ title: title.trim(), subject: subject.trim(), category });
    }

    cancel(): void {
        this.dialogRef.close(undefined);
    }
}
