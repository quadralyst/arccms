import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ISmtpConfig } from '../email-setting.model';
import { IEmailProviderComponent } from './email-provider-base';

@Component({
    selector: 'app-smtp-provider',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        MatCardModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatCheckboxModule,
        MatTooltipModule,
    ],
    template: `
        <mat-card class="mb-4" [formGroup]="formGroup">
            <mat-card-header>
                <mat-card-title>
                    <i class="fa-solid fa-server me-2"></i>
                    SMTP Configuration
                </mat-card-title>
            </mat-card-header>
            <mat-card-content class="pt-3">
                <div class="alert alert-light border small mb-3" style="padding: 0; overflow: hidden;">
                    <div style="display: flex; align-items: center; padding: 0.5rem 0.75rem; cursor: pointer; user-select: none;"
                         (click)="showInfoBox.set(!showInfoBox())">
                        <i class="fa-solid fa-circle-info text-primary me-1"></i>
                        <strong>Where do I find my SMTP settings?</strong>
                        <mat-icon style="margin-left: auto; font-size: 20px; width: 20px; height: 20px;">
                            {{ showInfoBox() ? 'expand_less' : 'expand_more' }}
                        </mat-icon>
                    </div>
                    @if (showInfoBox()) {
                    <div style="padding: 0 0.75rem 0.5rem;">
                        Check your email provider's help docs. Common settings:
                        <ul class="mb-0 mt-1">
                            <li>
                                <a href="https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-8361e398-8af4-4e97-b147-6c6c4ac95353" target="_blank" rel="noopener">
                                    Outlook / Microsoft 365
                                </a>
                                — Host: <code>smtp.office365.com</code>, Port: <code>587</code>
                            </li>
                            <li>
                                <a href="https://help.yahoo.com/kb/SLN4724.html" target="_blank" rel="noopener">
                                    Yahoo Mail
                                </a>
                                — Host: <code>smtp.mail.yahoo.com</code>, Port: <code>465</code> (SSL)
                            </li>
                            <li>
                                <a href="https://www.zoho.com/mail/help/zoho-smtp.html" target="_blank" rel="noopener">
                                    Zoho Mail
                                </a>
                                — Host: <code>smtp.zoho.com</code>, Port: <code>465</code> (SSL)
                            </li>
                        </ul>
                    </div>
                    }
                </div>
                <div class="row">
                    <div class="col-md-8">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>SMTP Host</mat-label>
                            <input matInput formControlName="host" placeholder="e.g. smtp.office365.com">
                            <mat-hint>The server address provided by your email host</mat-hint>
                        </mat-form-field>
                    </div>
                    <div class="col-md-4">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>Port</mat-label>
                            <input matInput type="number" formControlName="port" placeholder="587">
                            <mat-hint>587 (TLS) or 465 (SSL)</mat-hint>
                        </mat-form-field>
                    </div>
                </div>

                <div class="row mt-3">
                    <div class="col-12">
                        <mat-checkbox formControlName="secure" color="primary">
                            Use secure connection (TLS/SSL)
                        </mat-checkbox>
                    </div>
                </div>

                <div class="row mt-3">
                    <div class="col-md-6">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>Username</mat-label>
                            <input matInput formControlName="user" placeholder="your-email@example.com">
                            <mat-hint>Usually your full email address</mat-hint>
                        </mat-form-field>
                    </div>
                    <div class="col-md-6">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>Password</mat-label>
                            <input matInput [type]="showPassword() ? 'text' : 'password'" formControlName="password"
                                placeholder="••••••••">
                            <button mat-icon-button matSuffix type="button" (click)="showPassword.set(!showPassword())"
                                [matTooltip]="showPassword() ? 'Hide password' : 'Show password'">
                                <mat-icon>{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
                            </button>
                            <mat-hint>Your email password or app-specific password</mat-hint>
                        </mat-form-field>
                    </div>
                </div>
            </mat-card-content>
        </mat-card>
    `,
})
export class SmtpProviderComponent implements IEmailProviderComponent, OnInit {
    private fb = inject(FormBuilder);

    initialData = input<Partial<ISmtpConfig>>();
    componentReady = output<IEmailProviderComponent>();

    showPassword = signal(false);
    showInfoBox = signal(true);

    formGroup: FormGroup = this.fb.group({
        host: [''],
        port: [587, [Validators.min(1), Validators.max(65535)]],
        secure: [false],
        user: [''],
        password: [''],
    });

    ngOnInit(): void {
        const data = this.initialData();
        if (data) {
            this.formGroup.patchValue(data);
        }
        this.showInfoBox.set(!this.isConfigValid());
        this.componentReady.emit(this);
    }

    isConfigValid(): boolean {
        return !!this.formGroup.get('host')?.value
            && !!this.formGroup.get('user')?.value
            && !!this.formGroup.get('password')?.value;
    }

    getSenderEmailConstraint(): string | null {
        return null;
    }
}
