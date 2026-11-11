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
import { TranslocoPipe } from '@jsverse/transloco';

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
        TranslocoPipe,
    ],
    // The provider help shares its words with onboarding's email step (admin.onboarding.email.*).
    template: `
        <mat-card class="mb-4" [formGroup]="formGroup">
            <mat-card-header>
                <mat-card-title>
                    <i class="fa-solid fa-server me-2" aria-hidden="true"></i>
                    {{ 'admin.settings.email.smtp_title' | transloco }}
                </mat-card-title>
            </mat-card-header>
            <mat-card-content class="pt-3">
                <div class="alert alert-light border small mb-3" style="padding: 0; overflow: hidden;">
                    <button type="button" class="info-toggle" (click)="showInfoBox.set(!showInfoBox())"
                        [attr.aria-expanded]="showInfoBox()" aria-controls="smtp-help">
                        <i class="fa-solid fa-circle-info text-primary me-1" aria-hidden="true"></i>
                        <strong>{{ 'admin.onboarding.email.smtp_help_title' | transloco }}</strong>
                        <mat-icon aria-hidden="true" style="margin-left: auto; font-size: 20px; width: 20px; height: 20px;">
                            {{ showInfoBox() ? 'expand_less' : 'expand_more' }}
                        </mat-icon>
                    </button>
                    @if (showInfoBox()) {
                    <div id="smtp-help" style="padding: 0 0.75rem 0.5rem;">
                        {{ 'admin.onboarding.email.smtp_help_text' | transloco }}
                        <ul class="mb-0 mt-1">
                            <li>
                                <a href="https://support.microsoft.com/en-us/office/pop-imap-and-smtp-settings-8361e398-8af4-4e97-b147-6c6c4ac95353" target="_blank" rel="noopener">Outlook / Microsoft 365</a>:
                                {{ 'admin.onboarding.email.host_word' | transloco }} <code>smtp.office365.com</code>, {{ 'admin.onboarding.email.port_word' | transloco }} <code>587</code>
                            </li>
                            <li>
                                <a href="https://help.yahoo.com/kb/SLN4724.html" target="_blank" rel="noopener">Yahoo Mail</a>:
                                {{ 'admin.onboarding.email.host_word' | transloco }} <code>smtp.mail.yahoo.com</code>, {{ 'admin.onboarding.email.port_word' | transloco }} <code>465</code> (SSL)
                            </li>
                            <li>
                                <a href="https://www.zoho.com/mail/help/zoho-smtp.html" target="_blank" rel="noopener">Zoho Mail</a>:
                                {{ 'admin.onboarding.email.host_word' | transloco }} <code>smtp.zoho.com</code>, {{ 'admin.onboarding.email.port_word' | transloco }} <code>465</code> (SSL)
                            </li>
                        </ul>
                    </div>
                    }
                </div>
                <div class="row">
                    <div class="col-md-8">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>{{ 'admin.onboarding.email.smtp_host' | transloco }}</mat-label>
                            <input matInput formControlName="host" [placeholder]="'admin.onboarding.email.smtp_host_placeholder' | transloco">
                            <mat-hint>{{ 'admin.onboarding.email.smtp_host_hint' | transloco }}</mat-hint>
                        </mat-form-field>
                    </div>
                    <div class="col-md-4">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>{{ 'admin.onboarding.email.port' | transloco }}</mat-label>
                            <input matInput type="number" formControlName="port" placeholder="587">
                            <mat-hint>{{ 'admin.onboarding.email.port_hint' | transloco }}</mat-hint>
                        </mat-form-field>
                    </div>
                </div>

                <div class="row mt-3">
                    <div class="col-12">
                        <mat-checkbox formControlName="secure" color="primary">
                            {{ 'admin.settings.email.secure' | transloco }}
                        </mat-checkbox>
                    </div>
                </div>

                <div class="row mt-3">
                    <div class="col-md-6">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>{{ 'admin.onboarding.email.username' | transloco }}</mat-label>
                            <input matInput formControlName="user" placeholder="your-email@example.com" autocomplete="off">
                            <mat-hint>{{ 'admin.onboarding.email.username_hint' | transloco }}</mat-hint>
                        </mat-form-field>
                    </div>
                    <div class="col-md-6">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>{{ 'admin.onboarding.email.password' | transloco }}</mat-label>
                            <input matInput [type]="showPassword() ? 'text' : 'password'" formControlName="password"
                                placeholder="••••••••" autocomplete="off">
                            <button mat-icon-button matSuffix type="button" (click)="showPassword.set(!showPassword())"
                                [attr.aria-label]="'admin.onboarding.show_password' | transloco"
                                [attr.aria-pressed]="showPassword()"
                                [matTooltip]="'admin.onboarding.show_password' | transloco">
                                <mat-icon aria-hidden="true">{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
                            </button>
                            <mat-hint>{{ 'admin.onboarding.email.password_hint' | transloco }}</mat-hint>
                        </mat-form-field>
                    </div>
                </div>
            </mat-card-content>
        </mat-card>
    `,
    styles: [`
        .info-toggle {
            display: flex;
            align-items: center;
            width: 100%;
            padding: 0.5rem 0.75rem;
            border: 0;
            background: transparent;
            color: inherit;
            font: inherit;
            text-align: left;
            cursor: pointer;
        }
    `],
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
