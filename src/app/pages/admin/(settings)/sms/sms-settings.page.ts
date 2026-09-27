/**
 * Settings, SMS: the provider for text messages (phone sign-in codes), a test
 * send, and the recent messages. With the default Test provider nothing is
 * sent and every code can be read in Recent messages.
 */
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe } from '@jsverse/transloco';
import { injectT } from '../../../../core/i18n/inject-t';
import { DEFAULT_SMS_FORM, SmsLogRow, SmsSettingsForm, SmsSettingsService } from './sms-settings.service';

@Component({
    selector: 'arc-sms-settings',
    standalone: true,
    imports: [FormsModule, TranslocoPipe, DatePipe],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="settings-section">
            <h3 class="mb-2">{{ 'admin.settings.sms.title' | transloco }}</h3>
            <p class="text-muted mb-4">{{ 'admin.settings.sms.intro' | transloco }}</p>

            <div class="mb-3">
                <label class="form-label" for="smsProvider">{{ 'admin.settings.sms.provider' | transloco }}</label>
                <select id="smsProvider" class="form-select" [ngModel]="form().provider" (ngModelChange)="update('provider', $event)">
                    <option value="log">{{ 'admin.settings.sms.provider_log' | transloco }}</option>
                    <option value="msg91">{{ 'admin.settings.sms.provider_msg91' | transloco }}</option>
                </select>
            </div>

            @if (form().provider === 'msg91') {
                <div class="mb-3">
                    <label class="form-label" for="msg91Key">{{ 'admin.settings.sms.msg91_auth_key' | transloco }}</label>
                    <input id="msg91Key" type="password" class="form-control" autocomplete="off"
                        [placeholder]="hasAuthKey() ? '••••••••••••' : ''"
                        [ngModel]="form().msg91AuthKey" (ngModelChange)="update('msg91AuthKey', $event)" />
                    @if (hasAuthKey()) {
                        <small class="text-muted d-block mt-1">{{ 'admin.settings.sms.msg91_auth_key_hint' | transloco }}</small>
                    }
                </div>
                <div class="mb-3">
                    <label class="form-label" for="msg91Template">{{ 'admin.settings.sms.msg91_template' | transloco }}</label>
                    <input id="msg91Template" type="text" class="form-control"
                        [ngModel]="form().msg91OtpTemplateId" (ngModelChange)="update('msg91OtpTemplateId', $event)" />
                    <small class="text-muted d-block mt-1">{{ 'admin.settings.sms.msg91_template_hint' | transloco }}</small>
                </div>
            }

            <div class="row">
                <div class="col-sm-5 mb-3">
                    <label class="form-label" for="smsDefaultCountry">{{ 'admin.settings.sms.default_country' | transloco }}</label>
                    <div class="input-group">
                        <span class="input-group-text">+</span>
                        <input id="smsDefaultCountry" type="text" inputmode="numeric" class="form-control"
                            [ngModel]="form().defaultCountryCode" (ngModelChange)="update('defaultCountryCode', $event)" />
                    </div>
                    <small class="text-muted d-block mt-1">{{ 'admin.settings.sms.default_country_hint' | transloco }}</small>
                </div>
                <div class="col-sm-7 mb-3">
                    <label class="form-label" for="smsAllowed">{{ 'admin.settings.sms.allowed_countries' | transloco }}</label>
                    <input id="smsAllowed" type="text" class="form-control"
                        [ngModel]="form().allowedCountryCodes" (ngModelChange)="update('allowedCountryCodes', $event)" />
                    <small class="text-muted d-block mt-1">{{ 'admin.settings.sms.allowed_countries_hint' | transloco }}</small>
                </div>
            </div>

            <button class="btn btn-primary" (click)="save()" [disabled]="saving()">
                @if (saving()) { <i class="fas fa-spinner fa-spin me-1"></i> {{ 'common.actions.saving' | transloco }} }
                @else { <i class="fas fa-save me-1"></i> {{ 'admin.settings.sms.save' | transloco }} }
            </button>
            @if (saveMessage()) { <span class="ms-3 text-success"><i class="fas fa-check me-1"></i> {{ saveMessage() }}</span> }

            <hr class="my-4" />

            <h4>{{ 'admin.settings.sms.test_title' | transloco }}</h4>
            <div class="d-flex gap-2 align-items-start test-row">
                <input type="tel" class="form-control" [placeholder]="'98765 43210'" autocomplete="off"
                    [attr.aria-label]="'admin.settings.sms.test_phone' | transloco"
                    [ngModel]="testPhone()" (ngModelChange)="testPhone.set($event)" (keydown.enter)="sendTest()" />
                <button class="btn btn-outline-primary text-nowrap" (click)="sendTest()" [disabled]="testing() || !testPhone()">
                    @if (testing()) { <i class="fas fa-spinner fa-spin me-1"></i> }
                    {{ 'admin.settings.sms.test_send' | transloco }}
                </button>
            </div>
            @if (testMessage()) {
                <small class="d-block mt-2" [class.text-danger]="testFailed()" [class.text-success]="!testFailed()">{{ testMessage() }}</small>
            }

            <hr class="my-4" />

            <div class="d-flex align-items-center justify-content-between mb-2">
                <h4 class="mb-0">{{ 'admin.settings.sms.logs_title' | transloco }}</h4>
                <button class="btn btn-sm btn-light" (click)="loadLogs()" [disabled]="loadingLogs()">
                    <i class="fas fa-rotate me-1"></i> {{ 'admin.settings.sms.logs_refresh' | transloco }}
                </button>
            </div>
            @if (logs().length === 0) {
                <p class="text-muted">{{ 'admin.settings.sms.logs_empty' | transloco }}</p>
            } @else {
                <div class="table-responsive">
                    <table class="table table-sm align-middle logs">
                        <thead>
                            <tr>
                                <th>{{ 'admin.settings.sms.col_time' | transloco }}</th>
                                <th>{{ 'admin.settings.sms.col_to' | transloco }}</th>
                                <th>{{ 'admin.settings.sms.col_message' | transloco }}</th>
                                <th>{{ 'admin.settings.sms.col_status' | transloco }}</th>
                            </tr>
                        </thead>
                        <tbody>
                            @for (log of logs(); track log.id) {
                                <tr>
                                    <td class="text-nowrap small">{{ log.createdAt | date: 'd MMM, HH:mm' }}</td>
                                    <td class="text-nowrap small">{{ log.to }}</td>
                                    <td class="small">{{ log.text }}
                                        @if (log.error) { <div class="text-danger">{{ log.error }}</div> }
                                    </td>
                                    <td><span [class]="'badge status-' + log.status">{{ ('admin.settings.sms.status_' + log.status) | transloco }}</span></td>
                                </tr>
                            }
                        </tbody>
                    </table>
                </div>
            }
        </div>
    `,
    styles: [`
        .settings-section { max-width: 760px; }
        h3 { font-size: 1.25rem; font-weight: 600; color: #212529; }
        h4 { font-size: 1rem; font-weight: 600; margin-bottom: 0.75rem; }
        .test-row { max-width: 420px; }
        .logs td { vertical-align: top; }
        .status-logged { background: #e7f1ff; color: #0b5ed7; }
        .status-sent { background: #d1fae5; color: #065f46; }
        .status-failed { background: #fee2e2; color: #991b1b; }
    `],
})
export class SmsSettingsPage implements OnInit {
    private readonly service = inject(SmsSettingsService);
    private readonly t = injectT();

    readonly form = signal<SmsSettingsForm>({ ...DEFAULT_SMS_FORM });
    readonly hasAuthKey = signal(false);
    readonly saving = signal(false);
    readonly saveMessage = signal('');

    readonly testPhone = signal('');
    readonly testing = signal(false);
    readonly testMessage = signal('');
    readonly testFailed = signal(false);

    readonly logs = signal<SmsLogRow[]>([]);
    readonly loadingLogs = signal(false);

    ngOnInit(): void {
        this.service.load().then(({ form, hasAuthKey }) => {
            this.form.set(form);
            this.hasAuthKey.set(hasAuthKey);
        }).catch((err) => console.error('SMS settings: load failed', err));
        void this.loadLogs();
    }

    update<K extends keyof SmsSettingsForm>(key: K, value: SmsSettingsForm[K]): void {
        this.form.update((f) => ({ ...f, [key]: value }));
        this.saveMessage.set('');
    }

    async save(): Promise<void> {
        this.saving.set(true);
        try {
            await this.service.save(this.form());
            if (this.form().msg91AuthKey.trim()) this.hasAuthKey.set(true);
            this.update('msg91AuthKey', '');
            this.saveMessage.set(this.t('admin.settings.sms.saved'));
        } catch (err) {
            console.error('SMS settings: save failed', err);
        } finally {
            this.saving.set(false);
        }
    }

    async sendTest(): Promise<void> {
        if (!this.testPhone() || this.testing()) return;
        this.testing.set(true);
        this.testMessage.set('');
        try {
            const result = await this.service.sendTest(this.testPhone());
            this.testFailed.set(result.status === 'failed');
            this.testMessage.set(
                result.status === 'failed' ? this.t('admin.settings.sms.test_failed', { error: result.error ?? '' })
                    : result.status === 'logged' ? this.t('admin.settings.sms.test_logged')
                        : this.t('admin.settings.sms.test_sent'),
            );
        } catch (err: any) {
            this.testFailed.set(true);
            this.testMessage.set(this.t('admin.settings.sms.test_failed', { error: err?.message ?? '' }));
        } finally {
            this.testing.set(false);
            void this.loadLogs();
        }
    }

    async loadLogs(): Promise<void> {
        this.loadingLogs.set(true);
        try {
            this.logs.set(await this.service.recentLogs());
        } catch (err) {
            console.error('SMS settings: logs failed', err);
        } finally {
            this.loadingLogs.set(false);
        }
    }
}
