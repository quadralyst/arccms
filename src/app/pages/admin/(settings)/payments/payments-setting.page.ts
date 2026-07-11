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
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { BaseComponent } from '../../../../../shared/components/base/base.component';
import { EmailTemplateEditorComponent } from '../../../../../shared/components/email-template-editor/email-template-editor.component';
import { TestEmailComponent } from '../../../../../shared/components/test-email/test-email.component';
import { roleGuard } from '../../../../guards/role.guard';
import { PaymentSettingsService, PAYMENT_EMAIL_DEFINITIONS } from './payment-settings.service';
import { MASKED_VALUE } from './payment-settings.model';
import { IEmailTemplate, PaymentEmailType } from '../../(waitlists)/email-template.model';

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
        MatDialogModule,
        EmailTemplateEditorComponent,
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
                                                <input matInput [ngModel]="templates[def.type].senderName" (ngModelChange)="onFieldChange(def.type, 'senderName', $event)" />
                                            </mat-form-field>
                                        </div>
                                        <div class="col-md-6">
                                            <mat-form-field appearance="outline" class="w-100">
                                                <mat-label>Sender Email</mat-label>
                                                <input matInput [ngModel]="templates[def.type].senderEmail" (ngModelChange)="onFieldChange(def.type, 'senderEmail', $event)" />
                                            </mat-form-field>
                                        </div>
                                    </div>
                                    <mat-form-field appearance="outline" class="w-100">
                                        <mat-label>Subject</mat-label>
                                        <input matInput [ngModel]="templates[def.type].subject" (ngModelChange)="onFieldChange(def.type, 'subject', $event)" />
                                    </mat-form-field>
                                    <label class="editor-label">Email body</label>
                                    <arc-email-template-editor
                                        [placeholders]="paymentTags"
                                        [value]="templates[def.type].template"
                                        (contentChange)="onFieldChange(def.type, 'template', $event)">
                                    </arc-email-template-editor>

                                    <!-- Test → confirm → save gate -->
                                    <div class="template-footer">
                                        @if (awaitingConfirm()[def.type]) {
                                            <div class="confirm-box">
                                                <span class="confirm-q"><mat-icon class="me-1">mark_email_read</mat-icon> Did you receive the test email?</span>
                                                <span class="confirm-actions">
                                                    <button mat-stroked-button type="button" (click)="confirmReceived(def.type, false)">Not yet</button>
                                                    <button mat-raised-button color="primary" type="button" (click)="confirmReceived(def.type, true)">Yes, I received it</button>
                                                </span>
                                            </div>
                                        }
                                        <div class="footer-row">
                                            <span class="confirm-hint">
                                                @if (confirmed()[def.type]) {
                                                    <mat-icon class="ok">check_circle</mat-icon> Test confirmed — you can save.
                                                } @else {
                                                    Send a test email and confirm receipt to enable saving.
                                                }
                                            </span>
                                            <span class="footer-actions">
                                                <button mat-stroked-button type="button" (click)="sendTest(def)" [disabled]="!templates[def.type].template">
                                                    <mat-icon class="me-1">send</mat-icon> Test email
                                                </button>
                                                <button mat-raised-button color="primary" type="button" (click)="saveTemplate(def.type)" [disabled]="savingType() === def.type || !confirmed()[def.type]">
                                                    @if (savingType() === def.type) { <mat-spinner diameter="18" class="me-2"></mat-spinner> Saving… }
                                                    @else { Save Template }
                                                </button>
                                            </span>
                                        </div>
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
        .editor-label { display: block; font-size: 0.8rem; color: #6c757d; margin: 4px 0 6px; }
        .template-footer { margin-top: 12px; }
        .footer-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
        .footer-actions { display: flex; gap: 8px; }
        .confirm-hint { font-size: 0.8rem; color: #6c757d; display: inline-flex; align-items: center; gap: 4px; }
        .confirm-hint .ok { color: #198754; font-size: 18px; height: 18px; width: 18px; }
        .confirm-box { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap;
            background: #fff8e1; border: 1px solid #ffe69c; border-radius: 8px; padding: 10px 14px; margin-bottom: 10px; }
        .confirm-q { display: inline-flex; align-items: center; font-size: 0.875rem; font-weight: 500; color: #664d03; }
        .confirm-actions { display: flex; gap: 8px; }
    `],
})
export default class PaymentsSettingPageComponent extends BaseComponent implements OnInit {
    private fb = inject(FormBuilder);
    private service = inject(PaymentSettingsService);
    private dialog = inject(MatDialog);

    /** Per-template gate: a test email must be sent and confirmed before saving. */
    confirmed = signal<Record<string, boolean>>({});
    awaitingConfirm = signal<Record<string, boolean>>({});

    form!: FormGroup;
    isLoading = signal(true);
    isSaving = signal(false);
    isTesting = signal(false);
    savingType = signal<string | null>(null);

    emailDefs = PAYMENT_EMAIL_DEFINITIONS;
    templates: Record<string, IEmailTemplate> = {};

    /** Tags surfaced as insertable chips in the email body editor. */
    paymentTags = [
        '##NAME##', '##PAYMENT_AMOUNT##', '##CURRENCY##', '##PAYMENT_STATUS##',
        '##SUBSCRIPTION_PLAN##', '##RENEWAL_DATE##', '##TRIAL_ENDS_AT##',
    ];

    ngOnInit(): void {
        this.form = this.fb.group({
            enabled: [false],
            mode: ['test'],
            testApiKey: [''],
            liveApiKey: [''],
            webhookSecret: [''],
            successUrl: [''],
            cancelUrl: [''],
        });
        this.initTemplates();
        this.load();
    }

    private defaultTemplate(def: { type: PaymentEmailType; subject: string; template: string }): IEmailTemplate {
        return {
            type: def.type,
            scope: 'payments',
            senderEmail: '',
            senderName: '',
            subject: def.subject,
            template: def.template,
            isActive: false,
        };
    }

    /** Populate template objects synchronously so the form renders before the async load resolves. */
    private initTemplates(): void {
        for (const def of this.emailDefs) {
            this.templates[def.type] = this.defaultTemplate(def);
        }
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

        this.service.getPaymentTemplates()
            .then((saved) => {
                // Overwrite defaults with any saved templates.
                for (const def of this.emailDefs) {
                    if (saved[def.type]) {
                        this.templates[def.type] = saved[def.type];
                    }
                }
            })
            .catch((e) => console.error('Failed to load payment templates', e));
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

    /** Update a template field and invalidate any prior test confirmation. */
    onFieldChange(type: string, key: 'senderName' | 'senderEmail' | 'subject' | 'template', value: string): void {
        (this.templates[type] as unknown as Record<string, string>)[key] = value;
        if (this.confirmed()[type] || this.awaitingConfirm()[type]) {
            this.confirmed.update((m) => ({ ...m, [type]: false }));
            this.awaitingConfirm.update((m) => ({ ...m, [type]: false }));
        }
    }

    /** Open the shared test-email dialog (sends via the EmailLogs pipeline), then ask for confirmation. */
    sendTest(def: { type: PaymentEmailType }): void {
        const tpl = this.templates[def.type];
        if (!tpl?.template) {
            this.toastService.error('Add email content before sending a test.');
            return;
        }
        const ref = this.dialog.open(TestEmailComponent, {
            width: '90vw',
            maxWidth: '1000px',
            maxHeight: '90vh',
            panelClass: 'test-email-dialog',
            data: {
                formValue: {
                    senderName: tpl.senderName,
                    senderEmail: tpl.senderEmail,
                    subject: tpl.subject,
                    previewText: tpl.previewText || '',
                },
                contentTemplate: tpl.template,
                allSelectedTemplateData: { type: def.type },
            },
        });
        ref.afterClosed().subscribe(() => {
            // The test is sent from inside the dialog; once it closes, confirm receipt.
            this.awaitingConfirm.update((m) => ({ ...m, [def.type]: true }));
        });
    }

    /** Record whether the admin received the test email; gates the Save button. */
    confirmReceived(type: string, received: boolean): void {
        this.awaitingConfirm.update((m) => ({ ...m, [type]: false }));
        if (received) {
            this.confirmed.update((m) => ({ ...m, [type]: true }));
            this.toastService.success('Confirmed — you can now save this template.');
        } else {
            this.toastService.error('No test received. Check your Email settings, then send another test.');
        }
    }
}
