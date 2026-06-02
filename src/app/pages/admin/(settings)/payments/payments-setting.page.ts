import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, inject, OnInit, signal } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSelectModule } from '@angular/material/select';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatTooltipModule } from '@angular/material/tooltip';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { roleGuard } from '../../../../guards/role.guard';
import { PaymentSettingsService, PAYMENT_EMAIL_DEFINITIONS } from './payment-settings.service';
import { MASKED_VALUE } from './payment-settings.model';
import { IEmailTemplate } from '../../(waitlists)/email-template.model';

export const routeMeta: RouteMeta = {
    title: 'Payments Settings | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

@Component({
    standalone: true,
    imports: [
        CommonModule,
        ReactiveFormsModule,
        FormsModule,
        MatCardModule,
        MatFormFieldModule,
        MatInputModule,
        MatButtonModule,
        MatIconModule,
        MatProgressSpinnerModule,
        MatSlideToggleModule,
        MatSelectModule,
        MatExpansionModule,
        MatTooltipModule,
    ],
    template: `
        <div class="payments-settings">
            <h3 class="settings-title">Payments</h3>
            <p class="text-muted mb-4">Configure Dodo Payments and the emails sent on payment events.</p>

            @if (isLoading()) {
                <div class="d-flex justify-content-center py-5"><mat-spinner diameter="40"></mat-spinner></div>
            } @else {
                <!-- ═══════════ Connection ═══════════ -->
                <mat-card class="mb-4 integration-card">
                    <mat-card-header>
                        <mat-card-title><i class="fa-solid fa-credit-card me-2"></i>Dodo Payments</mat-card-title>
                        <mat-card-subtitle>API keys and webhook secret are stored server-side and never returned to the browser.</mat-card-subtitle>
                    </mat-card-header>
                    <mat-card-content class="pt-3">
                        <form [formGroup]="form" (ngSubmit)="save()">
                            <div class="mb-3">
                                <mat-slide-toggle formControlName="enabled" color="primary">Enable Dodo Payments</mat-slide-toggle>
                            </div>

                            <div class="row">
                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Mode</mat-label>
                                        <mat-select formControlName="mode">
                                            <mat-option value="test">Test</mat-option>
                                            <mat-option value="live">Live</mat-option>
                                        </mat-select>
                                    </mat-form-field>
                                </div>
                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Brand / Business ID (optional)</mat-label>
                                        <input matInput formControlName="brandId" autocomplete="off" />
                                    </mat-form-field>
                                </div>
                            </div>

                            <div class="row">
                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Test API Key</mat-label>
                                        <input matInput formControlName="testApiKey" type="password" autocomplete="off" placeholder="dodo_test_..." />
                                    </mat-form-field>
                                </div>
                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Live API Key</mat-label>
                                        <input matInput formControlName="liveApiKey" type="password" autocomplete="off" placeholder="dodo_live_..." />
                                    </mat-form-field>
                                </div>
                            </div>

                            <div class="row">
                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Webhook Signing Secret</mat-label>
                                        <input matInput formControlName="webhookSecret" type="password" autocomplete="off" placeholder="whsec_..." />
                                    </mat-form-field>
                                </div>
                            </div>

                            <div class="row">
                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Success / Return URL</mat-label>
                                        <input matInput formControlName="successUrl" autocomplete="off" placeholder="https://your-site.com/checkout/success" />
                                    </mat-form-field>
                                </div>
                                <div class="col-md-6">
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Cancel URL</mat-label>
                                        <input matInput formControlName="cancelUrl" autocomplete="off" placeholder="https://your-site.com/pricing" />
                                    </mat-form-field>
                                </div>
                            </div>

                            <div class="webhook-hint">
                                <i class="fa-solid fa-circle-info me-1"></i>
                                Configure this endpoint in your Dodo dashboard as the webhook URL — the deployed
                                <code>dodoWebhook</code> Cloud Function (find its URL in the Firebase Console → Functions).
                                Then paste the webhook's signing secret above.
                            </div>

                            <div class="d-flex justify-content-end gap-2 mt-3">
                                <button mat-stroked-button type="button" (click)="testConnection()" [disabled]="isTesting()">
                                    @if (isTesting()) { <mat-spinner diameter="18" class="me-2"></mat-spinner> Testing… }
                                    @else { <i class="fa-solid fa-plug me-2"></i> Test Connection }
                                </button>
                                <button mat-raised-button color="primary" type="submit" [disabled]="isSaving() || form.pristine">
                                    @if (isSaving()) { <mat-spinner diameter="18" class="me-2"></mat-spinner> Saving… }
                                    @else { <i class="fa-solid fa-floppy-disk me-2"></i> Save }
                                </button>
                            </div>
                        </form>
                    </mat-card-content>
                </mat-card>

                <!-- ═══════════ Email templates ═══════════ -->
                <mat-card class="mb-4 integration-card">
                    <mat-card-header>
                        <mat-card-title><i class="fa-solid fa-envelope me-2"></i>Payment Emails</mat-card-title>
                        <mat-card-subtitle>Each email is optional — toggle it on and customize its content. Supports tags like ##NAME##, ##PAYMENT_AMOUNT##, ##SUBSCRIPTION_PLAN##.</mat-card-subtitle>
                    </mat-card-header>
                    <mat-card-content class="pt-3">
                        <mat-accordion>
                            @for (def of emailDefs; track def.type) {
                                <mat-expansion-panel>
                                    <mat-expansion-panel-header>
                                        <mat-panel-title>{{ def.label }}</mat-panel-title>
                                        <mat-panel-description>
                                            {{ templates[def.type].isActive ? 'Enabled' : 'Disabled' }}
                                        </mat-panel-description>
                                    </mat-expansion-panel-header>

                                    <div class="mb-2">
                                        <mat-slide-toggle [(ngModel)]="templates[def.type].isActive" color="primary">
                                            Send this email
                                        </mat-slide-toggle>
                                    </div>
                                    <div class="row">
                                        <div class="col-md-6">
                                            <mat-form-field appearance="outline" class="w-100">
                                                <mat-label>Sender Name</mat-label>
                                                <input matInput [(ngModel)]="templates[def.type].senderName" />
                                            </mat-form-field>
                                        </div>
                                        <div class="col-md-6">
                                            <mat-form-field appearance="outline" class="w-100">
                                                <mat-label>Sender Email</mat-label>
                                                <input matInput [(ngModel)]="templates[def.type].senderEmail" />
                                            </mat-form-field>
                                        </div>
                                    </div>
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Subject</mat-label>
                                        <input matInput [(ngModel)]="templates[def.type].subject" />
                                    </mat-form-field>
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>HTML Body</mat-label>
                                        <textarea matInput rows="10" [(ngModel)]="templates[def.type].template"></textarea>
                                    </mat-form-field>

                                    <div class="d-flex justify-content-end">
                                        <button mat-raised-button color="primary" type="button" (click)="saveTemplate(def.type)" [disabled]="savingType() === def.type">
                                            @if (savingType() === def.type) { <mat-spinner diameter="18" class="me-2"></mat-spinner> Saving… }
                                            @else { Save Template }
                                        </button>
                                    </div>
                                </mat-expansion-panel>
                            }
                        </mat-accordion>
                    </mat-card-content>
                </mat-card>
            }
        </div>
    `,
    styles: [`
        .payments-settings { max-width: 900px; }
        .settings-title { font-size: 1.25rem; font-weight: 600; color: #212529; margin-bottom: 4px; }
        .integration-card { border: 1px solid #dee2e6; box-shadow: none !important; }
        mat-card-title { font-size: 1rem !important; font-weight: 600; }
        .webhook-hint { font-size: 0.8rem; color: #495057; background: #f8f9fa; border-left: 3px solid #0d6efd; border-radius: 6px; padding: 10px 14px; margin-top: 8px; }
        .webhook-hint code { background: #e9ecef; padding: 1px 5px; border-radius: 3px; }
    `],
})
export default class PaymentsSettingPageComponent extends BaseComponent implements OnInit {
    private fb = inject(FormBuilder);
    private service = inject(PaymentSettingsService);

    form!: FormGroup;
    isLoading = signal(true);
    isSaving = signal(false);
    isTesting = signal(false);
    savingType = signal<string | null>(null);

    emailDefs = PAYMENT_EMAIL_DEFINITIONS;
    templates: Record<string, IEmailTemplate> = {};

    ngOnInit(): void {
        this.form = this.fb.group({
            enabled: [false],
            mode: ['test'],
            brandId: [''],
            testApiKey: [''],
            liveApiKey: [''],
            webhookSecret: [''],
            successUrl: [''],
            cancelUrl: [''],
        });
        this.load();
    }

    private load(): void {
        this.service.getSettings().subscribe({
            next: (settings) => {
                this.form.patchValue(settings);
                this.form.markAsPristine();
                this.isLoading.set(false);
            },
            error: () => this.isLoading.set(false),
        });

        this.service.getPaymentTemplates().then((saved) => {
            for (const def of this.emailDefs) {
                const existing = saved[def.type];
                this.templates[def.type] = existing ?? {
                    type: def.type,
                    scope: 'payments',
                    senderEmail: '',
                    senderName: '',
                    subject: def.subject,
                    template: def.template,
                    isActive: false,
                };
            }
        });
    }

    async save(): Promise<void> {
        if (this.isSaving()) return;
        this.isSaving.set(true);
        try {
            await this.service.saveSettings(this.form.getRawValue());
            // Re-mask saved secrets locally.
            this.form.patchValue({
                testApiKey: this.form.value.testApiKey ? MASKED_VALUE : '',
                liveApiKey: this.form.value.liveApiKey ? MASKED_VALUE : '',
                webhookSecret: this.form.value.webhookSecret ? MASKED_VALUE : '',
            });
            this.form.markAsPristine();
            this.toastService.success('Payment settings saved.');
        } catch (e) {
            console.error(e);
            this.toastService.error('Failed to save payment settings.');
        } finally {
            this.isSaving.set(false);
        }
    }

    async testConnection(): Promise<void> {
        this.isTesting.set(true);
        try {
            const result = await this.service.testConnection();
            if (result.success) {
                this.toastService.success(`Connected to Dodo Payments (${result.mode} mode).`);
            } else {
                this.toastService.error(`Connection failed: ${result.error ?? 'unknown error'}`);
            }
        } catch (e) {
            console.error(e);
            this.toastService.error('Connection test failed. Check your API key and that the integration is enabled.');
        } finally {
            this.isTesting.set(false);
        }
    }

    async saveTemplate(type: string): Promise<void> {
        this.savingType.set(type);
        try {
            await this.service.savePaymentTemplate(this.templates[type]);
            const refreshed = await this.service.getPaymentTemplates();
            if (refreshed[type]) this.templates[type] = refreshed[type];
            this.toastService.success('Template saved.');
        } catch (e) {
            console.error(e);
            this.toastService.error('Failed to save template.');
        } finally {
            this.savingType.set(null);
        }
    }
}
