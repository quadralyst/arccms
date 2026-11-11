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
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { sentenceParts } from '../../../../../core/i18n/sentence-parts';
import type { TranslationKey } from '../../../../../core/i18n/translation-keys';

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
        TranslocoPipe,
    ],
    // The provider help shares its words with onboarding's email step (admin.onboarding.email.*).
    template: `
        <mat-card class="mb-4" [formGroup]="formGroup">
            <mat-card-header>
                <mat-card-title>
                    <i class="fa-solid fa-paper-plane me-2" aria-hidden="true"></i>
                    {{ 'admin.settings.email.resend_title' | transloco }}
                </mat-card-title>
            </mat-card-header>
            <mat-card-content class="pt-3">
                <div class="alert alert-light border small mb-3" style="padding: 0; overflow: hidden;">
                    <button type="button" class="info-toggle" (click)="showInfoBox.set(!showInfoBox())"
                        [attr.aria-expanded]="showInfoBox()" aria-controls="resend-help">
                        <i class="fa-solid fa-circle-info text-primary me-1" aria-hidden="true"></i>
                        <strong>{{ 'admin.onboarding.email.resend_help_title' | transloco }}</strong>
                        <mat-icon aria-hidden="true" style="margin-left: auto; font-size: 20px; width: 20px; height: 20px;">
                            {{ showInfoBox() ? 'expand_less' : 'expand_more' }}
                        </mat-icon>
                    </button>
                    @if (showInfoBox()) {
                    <div id="resend-help" style="padding: 0 0.75rem 0.5rem;">
                        <ol class="mb-0 mt-1">
                            <li>
                                @let account = parts('admin.onboarding.email.resend_step_account');
                                {{ account[0] }}<a href="https://resend.com/signup" target="_blank" rel="noopener">{{ 'admin.onboarding.email.resend_step_account_link' | transloco }}</a>{{ account[1] }}
                            </li>
                            <li>
                                @let keys = parts('admin.onboarding.email.resend_step_keys');
                                {{ keys[0] }}<a href="https://resend.com/api-keys" target="_blank" rel="noopener"><strong>{{ 'admin.onboarding.email.resend_step_keys_link' | transloco }}</strong></a>{{ keys[1] }}
                            </li>
                            <li>{{ 'admin.onboarding.email.resend_step_create' | transloco }}</li>
                        </ol>
                        <span class="provider-note">
                            <i class="fa-solid fa-circle-check text-success me-1" aria-hidden="true"></i>
                            @let tip = parts('admin.onboarding.email.resend_tip');
                            {{ 'admin.onboarding.email.providers.resend.free_tier' | transloco }}. {{ tip[0] }}<a href="https://resend.com/domains" target="_blank" rel="noopener">{{ 'admin.onboarding.email.resend_tip_link' | transloco }}</a>{{ tip[1] }}
                        </span>
                    </div>
                    }
                </div>
                <mat-form-field appearance="outline" class="w-100">
                    <mat-label>{{ 'admin.onboarding.email.api_key' | transloco }}</mat-label>
                    <input matInput [type]="showApiKey() ? 'text' : 'password'" formControlName="apiKey"
                        placeholder="re_xxxxxxxx..." autocomplete="off">
                    <button mat-icon-button matSuffix type="button" (click)="showApiKey.set(!showApiKey())"
                        [attr.aria-label]="'admin.settings.email.show_key' | transloco"
                        [attr.aria-pressed]="showApiKey()"
                        [matTooltip]="'admin.settings.email.show_key' | transloco">
                        <mat-icon aria-hidden="true">{{ showApiKey() ? 'visibility_off' : 'visibility' }}</mat-icon>
                    </button>
                    <mat-hint>
                        @let keyHint = parts('admin.onboarding.email.api_key_hint');
                        {{ keyHint[0] }}<a href="https://resend.com/api-keys" target="_blank" rel="noopener">resend.com/api-keys</a>{{ keyHint[1] }}
                    </mat-hint>
                </mat-form-field>
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
        .provider-note {
            color: #495057;
        }
    `],
})
export class ResendProviderComponent implements IEmailProviderComponent, OnInit {
    private fb = inject(FormBuilder);

    initialData = input<Partial<IResendConfig>>();
    componentReady = output<IEmailProviderComponent>();

    private transloco = inject(TranslocoService);

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

    /** A sentence split around its value, for the template to link the value. */
    parts(key: TranslationKey, params: Record<string, unknown> = {}): [string, string] {
        return sentenceParts((k, p) => this.transloco.translate(k, p), key, params);
    }
}
