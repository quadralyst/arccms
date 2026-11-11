import { CommonModule } from '@angular/common';
import { Component, inject, model } from '@angular/core';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { APP_BRAND, ARC_CMS_NAME } from '../../../../core/brand/site-brand';
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
        MatIconModule, TranslocoPipe],
    template: `
        <h2 mat-dialog-title>{{ 'admin.settings.test_connection.title' | transloco }}</h2>
        <mat-dialog-content>
            <p class="mb-3 intro">
                {{ 'admin.settings.test_connection.intro' | transloco }}
            </p>
            <mat-form-field appearance="outline" class="w-100">
                <mat-label>{{ 'admin.settings.test_connection.to' | transloco }}</mat-label>
                <input matInput type="email" [formControl]="emailControl" placeholder="name@example.com">
                @if (emailControl.hasError('required')) {
                    <mat-error>{{ 'admin.settings.test_connection.email_required' | transloco }}</mat-error>
                }
                @if (emailControl.hasError('email')) {
                    <mat-error>{{ 'admin.settings.test_connection.email_invalid' | transloco }}</mat-error>
                }
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-100">
                <mat-label>{{ 'admin.settings.test_connection.subject' | transloco }}</mat-label>
                <input matInput [formControl]="subjectControl" [placeholder]="'admin.settings.test_connection.subject_placeholder' | transloco">
            </mat-form-field>

            <mat-form-field appearance="outline" class="w-100">
                <mat-label>{{ 'admin.settings.test_connection.message' | transloco }}</mat-label>
                <textarea matInput [formControl]="messageControl" rows="4" [placeholder]="'admin.settings.test_connection.message_placeholder' | transloco"></textarea>
            </mat-form-field>

            <div class="alert alert-info d-flex align-items-center mb-0 mt-2">
                <i class="fa-solid fa-circle-info me-2 fs-5" aria-hidden="true"></i>
                <div class="small">
                    <span [innerHTML]="'admin.settings.test_connection.check_folders' | transloco"></span>
                </div>
            </div>
        </mat-dialog-content>
        <mat-dialog-actions align="end">
            <button mat-button mat-dialog-close>{{ 'common.actions.cancel' | transloco }}</button>
            <button mat-flat-button color="primary" 
                [disabled]="emailControl.invalid"
                (click)="onSend()">
                <mat-icon class="me-2" aria-hidden="true">send</mat-icon>
                {{ 'admin.settings.test_connection.send' | transloco }}
            </button>
        </mat-dialog-actions>
    `,
    styles: [`
        mat-dialog-content {
            min-width: min(400px, 100%);
            max-width: 500px;
        }
        .intro {
            color: #495057;
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

    private transloco = inject(TranslocoService);
    /** The name the test email signs with. */
    private readonly productName = APP_BRAND.name || ARC_CMS_NAME;

    emailControl = new FormControl('', [Validators.required, Validators.email]);
    // A ready test email, in the admin's language; they can change either before sending.
    subjectControl = new FormControl(this.transloco.translate('admin.settings.test_connection.default_subject', { name: this.productName }));
    messageControl = new FormControl(this.transloco.translate('admin.settings.test_connection.default_message', { name: this.productName }));

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
