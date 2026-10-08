/**
 * Settings, SMS: the provider for text messages (phone sign-in codes) and a
 * test send. With the default Test provider nothing is sent: every message is
 * in Email + SMS, SMS Logs, and the sign-in page shows sign-up codes. Reset codes
 * are shown only when the admin turns that on here, since anyone could then reset
 * any PIN; link codes never are (they would let anyone move a number).
 */
import { ChangeDetectionStrategy, Component, inject, OnInit, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { injectT } from '../../../../core/i18n/inject-t';
import { CountryPickerComponent } from '../../../../../shared/components/country-picker/country-picker.component';
import { countryByIso, countryName, flagUrl } from '../../../../../shared/data/countries';
import { DEFAULT_SMS_FORM, SmsSettingsForm, SmsSettingsService } from './sms-settings.service';

@Component({
    selector: 'arc-sms-settings',
    standalone: true,
    imports: [FormsModule, TranslocoPipe, RouterLink, CountryPickerComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="settings-section">
            <h3 class="mb-2">{{ 'admin.settings.sms.title' | transloco }}</h3>
            <p class="text-muted mb-2">{{ 'admin.settings.sms.intro' | transloco }}</p>
            <!-- The phone sign-in switch is in User Settings: say where it stands, and link to it. -->
            <p class="mb-4 phone-status">
                @if (phoneSignIn()) {
                    <i class="fa-solid fa-circle-check text-success me-1"></i>{{ 'admin.settings.sms.phone_on' | transloco }}
                } @else {
                    <i class="fa-solid fa-circle-minus text-muted me-1"></i>{{ 'admin.settings.sms.phone_off' | transloco }}
                }
                <a routerLink="/admin/settings/user" class="ms-1">{{ 'admin.settings.sms.phone_switch_link' | transloco }}</a>
            </p>

            @if (form().provider === 'log') {
                <div class="alert alert-warning d-flex gap-2 align-items-start">
                    <i class="fa-solid fa-triangle-exclamation mt-1"></i>
                    <span>{{ 'admin.settings.sms.test_mode_warning' | transloco }}</span>
                </div>
                <div class="form-check form-switch mb-3 reset-codes">
                    <input id="smsShowResetCodes" type="checkbox" class="form-check-input" role="switch"
                        [ngModel]="form().showResetCodes" (ngModelChange)="update('showResetCodes', $event)" />
                    <label class="form-check-label" for="smsShowResetCodes">{{ 'admin.settings.sms.show_reset_codes' | transloco }}</label>
                    <small class="d-block mt-1" [class.text-danger]="form().showResetCodes" [class.text-muted]="!form().showResetCodes">
                        {{ 'admin.settings.sms.show_reset_codes_hint' | transloco }}
                    </small>
                </div>
            }

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

            <div class="mb-3 countries">
                <label class="form-label" for="smsCountries">{{ 'admin.settings.sms.countries' | transloco }}</label>
                <arc-country-picker inputId="smsCountries" [value]="form().allowedCountries" (valueChange)="setCountries($event)" />
                <small class="text-muted d-block mt-1">{{ 'admin.settings.sms.countries_hint' | transloco }}</small>
            </div>
            <!-- With one country it is the default too: nothing to choose. -->
            @if (form().allowedCountries.length > 1) {
                <div class="mb-3 default-country">
                    <label class="form-label" for="smsDefaultCountry">{{ 'admin.settings.sms.default_country' | transloco }}</label>
                    <div class="input-group">
                        <span class="input-group-text"><img [src]="flag(form().defaultCountry)" alt="" width="20" height="15" /></span>
                        <select id="smsDefaultCountry" class="form-select" [ngModel]="form().defaultCountry" (ngModelChange)="update('defaultCountry', $event)">
                            @for (iso of form().allowedCountries; track iso) {
                                <option [value]="iso">{{ name(iso) }} (+{{ code(iso) }})</option>
                            }
                        </select>
                    </div>
                    <small class="text-muted d-block mt-1">{{ 'admin.settings.sms.default_country_hint' | transloco }}</small>
                </div>
            }

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


            <p class="mt-4 mb-0">
                <a routerLink="/admin/sms-logs"><i class="fa-solid fa-comment-sms me-1"></i>{{ 'admin.settings.sms.logs_link' | transloco }}</a>
            </p>
        </div>
    `,
    styles: [`
        .settings-section { max-width: 760px; }
        h3 { font-size: 1.25rem; font-weight: 600; color: #212529; }
        h4 { font-size: 1rem; font-weight: 600; margin-bottom: 0.75rem; }
        .test-row { max-width: 420px; }
        .default-country .input-group { max-width: 360px; }
        .default-country img { border-radius: 2px; box-shadow: 0 0 0 1px rgba(0, 0, 0, 0.1); }
    `],
})
export class SmsSettingsPage implements OnInit {
    private readonly service = inject(SmsSettingsService);
    private readonly t = injectT();
    private readonly transloco = inject(TranslocoService);
    private readonly lang = toSignal(this.transloco.langChanges$, { initialValue: this.transloco.getActiveLang() });

    readonly form = signal<SmsSettingsForm>({ ...DEFAULT_SMS_FORM });
    readonly hasAuthKey = signal(false);
    readonly phoneSignIn = signal(false);
    readonly saving = signal(false);
    readonly saveMessage = signal('');

    readonly testPhone = signal('');
    readonly testing = signal(false);
    readonly testMessage = signal('');
    readonly testFailed = signal(false);

    ngOnInit(): void {
        this.service.load().then(({ form, hasAuthKey, phoneSignIn }) => {
            this.form.set(form);
            this.hasAuthKey.set(hasAuthKey);
            this.phoneSignIn.set(phoneSignIn);
        }).catch((err) => console.error('SMS settings: load failed', err));
    }

    update<K extends keyof SmsSettingsForm>(key: K, value: SmsSettingsForm[K]): void {
        this.form.update((f) => ({ ...f, [key]: value }));
        this.saveMessage.set('');
    }

    /** The allowed countries; a default that was taken off becomes the first one left. */
    setCountries(countries: string[]): void {
        const defaultCountry = countries.includes(this.form().defaultCountry) ? this.form().defaultCountry : countries[0];
        this.form.update((f) => ({ ...f, allowedCountries: countries, defaultCountry }));
        this.saveMessage.set('');
    }

    name(iso: string): string {
        return countryName(iso, this.lang());
    }

    code(iso: string): string {
        return countryByIso(iso)?.code ?? '';
    }

    flag(iso: string): string {
        return flagUrl(iso);
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
        }
    }
}
