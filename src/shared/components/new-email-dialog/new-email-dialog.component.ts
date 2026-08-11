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
        MatDialogTitle, MatDialogContent, MatDialogActions,
    ],
    template: `
        <h2 mat-dialog-title>New email</h2>
        <mat-dialog-content>
            <form [formGroup]="form">
                <mat-form-field appearance="outline" class="w-100">
                    <mat-label>Title</mat-label>
                    <input matInput formControlName="title" placeholder="Welcome — day 1" cdkFocusInitial />
                    @if (form.controls.title.touched && form.controls.title.invalid) {
                    <mat-error>Give the email a title</mat-error>
                    }
                </mat-form-field>
                <mat-form-field appearance="outline" class="w-100">
                    <mat-label>Subject</mat-label>
                    <input matInput formControlName="subject" placeholder="Welcome aboard 👋" />
                </mat-form-field>
                <mat-form-field appearance="outline" class="w-100">
                    <mat-label>Category</mat-label>
                    <mat-select formControlName="category">
                        <mat-option value="marketing">Marketing</mat-option>
                        <mat-option value="transactional">Transactional</mat-option>
                    </mat-select>
                </mat-form-field>
                <p class="text-muted small mb-0">
                    Creates a starter email you can refine in the Email Composer.
                </p>
            </form>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-stroked-button (click)="cancel()">Cancel</button>
            <button mat-flat-button color="primary" (click)="confirm()">
                <mat-icon>add</mat-icon> Create email
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
