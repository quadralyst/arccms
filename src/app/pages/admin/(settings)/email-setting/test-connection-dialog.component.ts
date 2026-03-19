import { CommonModule } from '@angular/common';
import { Component, inject, model } from '@angular/core';
import { Auth } from '@angular/fire/auth';
import { FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import {
    MatDialogActions,
    MatDialogClose,
    MatDialogContent,
    MatDialogRef,
    MatDialogTitle,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

@Component({
    selector: 'app-test-connection-dialog',
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        MatDialogTitle,
        MatDialogContent,
        MatDialogActions,
        MatDialogClose,
        MatButtonModule,
        MatFormFieldModule,
        MatInputModule,
        MatIconModule,
    ],
    template: `
        <h2 mat-dialog-title>Test Email Connection</h2>
        <mat-dialog-content>
            <p class="mb-3 text-muted">
                Enter an email address to receive a test email. This verifies that your SMTP configuration is correct and can send emails.
            </p>
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>To Email</mat-label>
                <input matInput type="email" [formControl]="emailControl" placeholder="name@example.com">
                @if (emailControl.hasError('required')) {
                    <mat-error>Email is required</mat-error>
                }
                @if (emailControl.hasError('email')) {
                    <mat-error>Please enter a valid email</mat-error>
                }
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-100">
                <mat-label>Subject</mat-label>
                <input matInput [formControl]="subjectControl" placeholder="SMTP Test">
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-100">
                <mat-label>Message</mat-label>
                <textarea matInput [formControl]="messageControl" rows="4" placeholder="Enter test message"></textarea>
            </mat-form-field>

            <div class="alert alert-info d-flex align-items-center mb-0 mt-2">
                <i class="fa-solid fa-circle-info me-2 fs-5"></i>
                <div class="small">
                    Please check your <strong>Inbox</strong> and <strong>Spam/Junk</strong> folder after sending. 
                    If you don't receive it, check your SMTP settings.
                </div>
            </div>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-button mat-dialog-close>Cancel</button>
            <button mat-flat-button color="primary" 
                [disabled]="emailControl.invalid"
                (click)="onSend()">
                <mat-icon class="me-2">send</mat-icon>
                Send Test Email
            </button>
        </mat-dialog-actions>
    `,
    styles: [`
        mat-dialog-content {
            min-width: 400px;
            max-width: 500px;
        }
        .alert-info {
            background-color: #cff4fc;
            border-color: #b6effb;
            color: #055160;
            padding: 12px;
            border-radius: 6px;
        }
    `]
})
export class TestConnectionDialogComponent {
    private dialogRef = inject(MatDialogRef<TestConnectionDialogComponent>);
    private auth = inject(Auth);

    emailControl = new FormControl('', [Validators.required, Validators.email]);
    subjectControl = new FormControl('It works! 🎉 - Arc CMS Connection Test');
    messageControl = new FormControl(`Hey there! 🎉

Woohoo! If you're reading this, your email configuration is working like a charm!

One quick heads-up — your settings are NOT saved yet! Don't forget to click the "Save Settings" button back in Arc CMS to lock them in.

Happy emailing! ✉️
Arc CMS`);

    constructor() {
        // Pre-populate with current user's email if available
        const currentUserEmail = this.auth.currentUser?.email;
        if (currentUserEmail) {
            this.emailControl.setValue(currentUserEmail);
        }
    }

    onSend(): void {
        if (this.emailControl.valid) {
            this.dialogRef.close({
                testEmail: this.emailControl.value,
                subject: this.subjectControl.value,
                message: this.messageControl.value
            });
        }
    }
}
