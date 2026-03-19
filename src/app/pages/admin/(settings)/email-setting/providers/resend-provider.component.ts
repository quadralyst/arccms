import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IResendConfig } from '../email-setting.model';
import { IEmailProviderComponent } from './email-provider-base';

@Component({
    selector: 'app-resend-provider',
    standalone: true,
    imports: [
        ReactiveFormsModule,
        MatCardModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatTooltipModule,
    ],
    template: `
        <mat-card class="mb-4" [formGroup]="formGroup">
            <mat-card-header>
                <mat-card-title>
                    <i class="fa-solid fa-paper-plane me-2"></i>
                    Resend Configuration
                </mat-card-title>
            </mat-card-header>
            <mat-card-content class="pt-3">
                <div class="alert alert-light border small mb-3" style="padding: 0; overflow: hidden;">
                    <div style="display: flex; align-items: center; padding: 0.5rem 0.75rem; cursor: pointer; user-select: none;"
                         (click)="showInfoBox.set(!showInfoBox())">
                        <i class="fa-solid fa-circle-info text-primary me-1"></i>
                        <strong>How to get your Resend API Key:</strong>
                        <mat-icon style="margin-left: auto; font-size: 20px; width: 20px; height: 20px;">
                            {{ showInfoBox() ? 'expand_less' : 'expand_more' }}
                        </mat-icon>
                    </div>
                    @if (showInfoBox()) {
                    <div style="padding: 0 0.75rem 0.5rem;">
                        <ol class="mb-0 mt-1">
                            <li>
                                <a href="https://resend.com/signup" target="_blank" rel="noopener">Create a free Resend account</a>
                                (if you don't have one)
                            </li>
                            <li>
                                Go to
                                <a href="https://resend.com/api-keys" target="_blank" rel="noopener"><strong>API Keys</strong></a>
                                in your Resend dashboard
                            </li>
                            <li>Click <strong>Create API Key</strong>, give it a name, and copy the key</li>
                        </ol>
                        <span class="text-muted">
                            <i class="fa-solid fa-circle-check text-success me-1"></i>
                            Free plan: 100 emails/day, 3,000/month. Works right away with <code>onboarding&#64;resend.dev</code>.
                            To send from your own domain,
                            <a href="https://resend.com/domains" target="_blank" rel="noopener">add &amp; verify it here</a>.
                        </span>
                    </div>
                    }
                </div>
                <mat-form-field appearance="outline" class="w-100">
                    <mat-label>API Key</mat-label>
                    <input matInput [type]="showApiKey() ? 'text' : 'password'" formControlName="apiKey"
                        placeholder="re_xxxxxxxx...">
                    <button mat-icon-button matSuffix type="button" (click)="showApiKey.set(!showApiKey())"
                        [matTooltip]="showApiKey() ? 'Hide API key' : 'Show API key'">
                        <mat-icon>{{ showApiKey() ? 'visibility_off' : 'visibility' }}</mat-icon>
                    </button>
                    <mat-hint>
                        Starts with <code>re_</code> — get it from
                        <a href="https://resend.com/api-keys" target="_blank" rel="noopener">resend.com/api-keys</a>
                    </mat-hint>
                </mat-form-field>
            </mat-card-content>
        </mat-card>
    `,
})
export class ResendProviderComponent implements IEmailProviderComponent, OnInit {
    private fb = inject(FormBuilder);

    initialData = input<Partial<IResendConfig>>();
    componentReady = output<IEmailProviderComponent>();

    showApiKey = signal(false);
    showInfoBox = signal(true);

    formGroup: FormGroup = this.fb.group({
        apiKey: [''],
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
        return !!this.formGroup.get('apiKey')?.value;
    }

    getSenderEmailConstraint(): string | null {
        return null;
    }
}
