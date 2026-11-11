import { Component, DestroyRef, inject, input, OnInit, output, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import { IGmailConfig } from '../email-setting.model';
import { IEmailProviderComponent } from './email-provider-base';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { APP_BRAND, ARC_CMS_NAME } from '../../../../../core/brand/site-brand';
import { sentenceParts } from '../../../../../core/i18n/sentence-parts';
import type { TranslationKey } from '../../../../../core/i18n/translation-keys';

@Component({
    selector: 'app-gmail-provider',
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
                    <i class="fa-solid fa-envelope me-2" aria-hidden="true"></i>
                    {{ 'admin.settings.email.gmail_title' | transloco }}
                </mat-card-title>
            </mat-card-header>
            <mat-card-content class="pt-3">
                <div class="alert alert-light border small mb-3" style="padding: 0; overflow: hidden;">
                    <button type="button" class="info-toggle" (click)="showInfoBox.set(!showInfoBox())"
                        [attr.aria-expanded]="showInfoBox()" aria-controls="gmail-help">
                        <i class="fa-solid fa-circle-info text-primary me-1" aria-hidden="true"></i>
                        <strong>{{ 'admin.onboarding.email.gmail_help_title' | transloco }}</strong>
                        <mat-icon aria-hidden="true" style="margin-left: auto; font-size: 20px; width: 20px; height: 20px;">
                            {{ showInfoBox() ? 'expand_less' : 'expand_more' }}
                        </mat-icon>
                    </button>
                    @if (showInfoBox()) {
                    <div id="gmail-help" style="padding: 0 0.75rem 0.5rem;">
                        <ol class="mb-0 mt-1">
                            <li>
                                @let security = parts('admin.onboarding.email.gmail_step_security');
                                {{ security[0] }}<a href="https://myaccount.google.com/security" target="_blank" rel="noopener">{{ 'admin.onboarding.email.gmail_step_security_link' | transloco }}</a>{{ security[1] }}
                            </li>
                            <li>
                                @let twoStep = parts('admin.onboarding.email.gmail_step_two_step');
                                {{ twoStep[0] }}<a href="https://myaccount.google.com/signinoptions/two-step-verification" target="_blank" rel="noopener">{{ 'admin.onboarding.email.gmail_step_two_step_link' | transloco }}</a>{{ twoStep[1] }}
                            </li>
                            <li>
                                @let create = parts('admin.onboarding.email.gmail_step_create', { name: productName });
                                {{ create[0] }}<a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener"><strong>{{ 'admin.onboarding.email.gmail_step_create_link' | transloco }}</strong></a>{{ create[1] }}
                            </li>
                            <li>{{ 'admin.onboarding.email.gmail_step_copy' | transloco }}</li>
                        </ol>
                        <span class="gmail-limit">
                            <i class="fa-solid fa-circle-check text-success me-1" aria-hidden="true"></i>
                            {{ 'admin.settings.email.gmail_limit' | transloco }}
                        </span>
                    </div>
                    }
                </div>

                @if (formGroup.get('user')?.value) {
                <div class="alert alert-warning border small mb-3">
                    <i class="fa-solid fa-triangle-exclamation me-1" aria-hidden="true"></i>
                    @let locked = parts('admin.settings.email.gmail_sender_note');
                    {{ locked[0] }}<code>{{ formGroup.get('user')?.value }}</code>{{ locked[1] }}
                </div>
                }

                <div class="row mt-3">
                    <div class="col-md-6">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>{{ 'admin.onboarding.email.gmail_address' | transloco }}</mat-label>
                            <input matInput formControlName="user" placeholder="you@gmail.com" autocomplete="off">
                            <mat-hint>{{ 'admin.onboarding.email.gmail_address_hint' | transloco }}</mat-hint>
                        </mat-form-field>
                    </div>
                    <div class="col-md-6">
                        <mat-form-field appearance="outline" class="w-100">
                            <mat-label>{{ 'admin.onboarding.email.app_password' | transloco }}</mat-label>
                            <input matInput [type]="showPassword() ? 'text' : 'password'" formControlName="password"
                                placeholder="xxxx xxxx xxxx xxxx" autocomplete="off">
                            <button mat-icon-button matSuffix type="button" (click)="showPassword.set(!showPassword())"
                                [attr.aria-label]="'admin.onboarding.show_password' | transloco"
                                [attr.aria-pressed]="showPassword()"
                                [matTooltip]="'admin.onboarding.show_password' | transloco">
                                <mat-icon aria-hidden="true">{{ showPassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
                            </button>
                            <mat-hint>
                                @let appPassword = parts('admin.onboarding.email.app_password_hint');
                                {{ appPassword[0] }}<a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">{{ 'admin.onboarding.email.app_password_link' | transloco }}</a>{{ appPassword[1] }}
                            </mat-hint>
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
        .gmail-limit {
            color: #495057;
        }
    `],
})
export class GmailProviderComponent implements IEmailProviderComponent, OnInit {
    private fb = inject(FormBuilder);
    private destroyRef = inject(DestroyRef);

    initialData = input<Partial<IGmailConfig>>();
    componentReady = output<IEmailProviderComponent>();
    userChanged = output<string>();

    private transloco = inject(TranslocoService);
    /** The name the help asks to give the app password. */
    readonly productName = APP_BRAND.name || ARC_CMS_NAME;

    showPassword = signal(false);
    showInfoBox = signal(true);

    formGroup: FormGroup = this.fb.group({
        user: ['', [Validators.email]],
        password: [''],
    });

    ngOnInit(): void {
        const data = this.initialData();
        if (data) {
            this.formGroup.patchValue(data);
        }
        this.showInfoBox.set(!this.isConfigValid());
        this.componentReady.emit(this);

        // Emit initial value if present
        const initialUser = this.formGroup.get('user')?.value;
        if (initialUser) {
            this.userChanged.emit(initialUser);
        }

        // Emit on every user field change so parent can sync senderEmail
        this.formGroup.get('user')!.valueChanges
            .pipe(takeUntilDestroyed(this.destroyRef))
            .subscribe(value => {
                this.userChanged.emit(value || '');
            });
    }

    isConfigValid(): boolean {
        return !!this.formGroup.get('user')?.value
            && !!this.formGroup.get('password')?.value;
    }

    /** A sentence split around its value, for the template to link or style the value. */
    parts(key: TranslationKey, params: Record<string, unknown> = {}): [string, string] {
        return sentenceParts((k, p) => this.transloco.translate(k, p), key, params);
    }

    getSenderEmailConstraint(): string | null {
        return this.formGroup.get('user')?.value || null;
    }
}
