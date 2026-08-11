import { Component, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import {
    MAT_DIALOG_DATA,
    MatDialogActions,
    MatDialogContent,
    MatDialogRef,
    MatDialogTitle,
} from '@angular/material/dialog';

export interface TestSendDialogData {
    /** Subject shown for context (read-only). */
    subject?: string;
}

/**
 * Lightweight Material dialog that collects a recipient address for a test
 * send and returns it (or undefined on cancel). Deliberately backend-agnostic:
 * the caller keeps ownership of the actual `sendTestEmail` call, so swapping
 * this in for `window.prompt` doesn't change the send path.
 */
@Component({
    selector: 'arc-test-send-dialog',
    standalone: true,
    imports: [
        ReactiveFormsModule, MatButtonModule, MatIconModule,
        MatFormFieldModule, MatInputModule,
        MatDialogTitle, MatDialogContent, MatDialogActions,
    ],
    template: `
        <h2 mat-dialog-title>Send test email</h2>
        <mat-dialog-content>
            @if (data.subject) {
            <p class="text-muted mb-3 small">Subject: <strong>{{ data.subject }}</strong></p>
            }
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>Send to</mat-label>
                <input matInput type="email" [formControl]="email" placeholder="you@example.com"
                    (keyup.enter)="confirm()" cdkFocusInitial />
                @if (email.touched && email.invalid) {
                <mat-error>Enter a valid email address</mat-error>
                }
            </mat-form-field>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-stroked-button (click)="cancel()">Cancel</button>
            <button mat-flat-button color="primary" (click)="confirm()">
                <mat-icon>send</mat-icon> Send test
            </button>
        </mat-dialog-actions>
    `,
})
export class TestSendDialogComponent {
    readonly data = inject<TestSendDialogData>(MAT_DIALOG_DATA);
    private readonly dialogRef = inject(MatDialogRef<TestSendDialogComponent, string>);

    email = new FormControl('', { nonNullable: true, validators: [Validators.required, Validators.email] });

    confirm(): void {
        if (this.email.invalid) {
            this.email.markAsTouched();
            return;
        }
        this.dialogRef.close(this.email.value.trim());
    }

    cancel(): void {
        this.dialogRef.close(undefined);
    }
}
