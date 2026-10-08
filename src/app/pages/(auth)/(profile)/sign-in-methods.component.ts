/**
 * Profile, "Sign-in methods": the account's email, phone number and Google,
 * each added or changed with a verification code.
 *
 * One small inline flow per row: enter the email or number, get a code, and
 * (only when the account has none yet) choose a password or PIN. When the
 * email or number is on another account, one line says so and the same
 * button moves it here once the code is verified.
 */
import { ChangeDetectionStrategy, Component, computed, inject, OnDestroy, OnInit, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TranslocoPipe, TranslocoService } from '@jsverse/transloco';
import { injectT } from '../../../core/i18n/inject-t';
import { sentenceParts } from '../../../core/i18n/sentence-parts';
import type { TranslationKey } from '../../../core/i18n/translation-keys';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthState } from '../auth.store';
import { readSignInError, SignInService, type LinkCheck } from '../sign-in.service';
import { RESEND_SECONDS, SentCodes } from '../sent-codes';
import { CodeInputComponent } from '../../../../shared/components/code-input/code-input.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserSettingService } from '../../admin/(settings)/user-setting/user-setting.service';
import { phoneCountrySettings, phoneSignInOn } from '../../admin/(settings)/user-setting/user-setting.model';
import { classifyIdentifier, DEFAULT_COUNTRY_CODE, formatPhone, hasCountryCode, identifierProblem, withoutTrunk } from '../../../../shared/utils/identifier.util';
import { codesOf, countryByIso, DEFAULT_COUNTRY, startingCountry } from '../../../../shared/data/countries';
import { chipPhone, countryListText, rememberCountry, rememberedCountry, tidyChipNumber } from '../../../../shared/utils/phone-country';
import { PhoneCountryComponent } from '../../../../shared/components/phone-country/phone-country.component';

type Kind = 'email' | 'phone';
type Step = 'enter' | 'code' | 'secret';

interface Flow {
    kind: Kind;
    step: Step;
    /** What the person typed, cleaned. */
    typed: string;
    /** The server's check: the canonical value, whose it is, and what is still missing. */
    check: LinkCheck | null;
}

@Component({
    selector: 'arc-sign-in-methods',
    standalone: true,
    imports: [FormsModule, NgTemplateOutlet, TranslocoPipe, CodeInputComponent, PhoneCountryComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="card-title-row">
            <h2 class="section-title"><i class="fas fa-key me-2"></i> {{ 'member.methods.title' | transloco }}</h2>
        </div>

        @if (message()) {
            <div class="alert alert-success mt-3 mb-0 py-2">{{ message() }}</div>
        }

        <!-- Email -->
        <div class="info-row">
            <label>{{ 'member.methods.email' | transloco }}</label>
            @if (flow()?.kind !== 'email') {
                <div class="info-value">
                    <span [class.text-muted]="!user()?.email">{{ user()?.email || ('member.methods.not_added' | transloco) }}</span>
                    @if (user()?.email && user()?.emailVerified) {
                        <span class="verified-badge"><i class="fas fa-check-circle me-1"></i>{{ 'member.methods.verified' | transloco }}</span>
                    }
                    <button class="btn btn-sm btn-outline-secondary" (click)="start('email')" [disabled]="!!flow()">
                        {{ (user()?.email ? 'member.methods.change' : 'member.methods.add') | transloco }}
                    </button>
                </div>
            } @else {
                <ng-container *ngTemplateOutlet="flowTpl" />
            }
        </div>

        <!-- Phone -->
        @if (phoneEnabled() || user()?.phone) {
            <div class="info-row">
                <label>{{ 'member.methods.phone' | transloco }}</label>
                @if (flow()?.kind !== 'phone' && !changingPin()) {
                    <div class="info-value">
                        <span [class.text-muted]="!user()?.phone">{{ user()?.phone ? phoneShown() : ('member.methods.not_added' | transloco) }}</span>
                        @if (user()?.phone) {
                            <button class="btn btn-sm btn-link" (click)="startPinChange()" [disabled]="!!flow()">{{ 'member.methods.change_pin' | transloco }}</button>
                        }
                        @if (phoneEnabled()) {
                            <button class="btn btn-sm btn-outline-secondary" (click)="start('phone')" [disabled]="!!flow()">
                                {{ (user()?.phone ? 'member.methods.change' : 'member.methods.add') | transloco }}
                            </button>
                        }
                    </div>
                } @else if (changingPin()) {
                    <div class="edit-form">
                        <div class="form-label small">{{ 'member.methods.new_pin_heading' | transloco }}</div>
                        <arc-code-input [label]="'member.methods.new_pin' | transloco" [masked]="true" [oneTimeCode]="false" [disabled]="busy()"
                            (changed)="secret.set($event)" />
                        @if (error()) { <div class="text-danger small mt-2">{{ error() }}</div> }
                        <div class="edit-actions">
                            <button class="btn btn-sm btn-primary" (click)="savePin()" [disabled]="busy()">
                                {{ 'member.methods.save_pin' | transloco }} @if (busy()) { <span class="spinner-border spinner-border-sm ms-1"></span> }
                            </button>
                            <button class="btn btn-sm btn-light" (click)="cancel()">{{ 'common.actions.cancel' | transloco }}</button>
                        </div>
                    </div>
                } @else {
                    <ng-container *ngTemplateOutlet="flowTpl" />
                }
            </div>
        }

        <!-- Google -->
        @if (googleEnabled()) {
            <div class="info-row">
                <label>{{ 'member.methods.google' | transloco }}</label>
                <div class="info-value">
                    <span [class.text-muted]="!googleConnected()">{{ (googleConnected() ? 'member.methods.connected' : 'member.methods.not_connected') | transloco }}</span>
                    @if (!googleConnected()) {
                        <button class="btn btn-sm btn-outline-secondary" (click)="connectGoogle()" [disabled]="!!flow() || busy()">{{ 'member.methods.connect' | transloco }}</button>
                    }
                </div>
            </div>
        }

        <ng-template #flowTpl>
            @let f = flow()!;
            <div class="edit-form">
                @switch (f.step) {
                    @case ('enter') {
                        <!-- A number shows its country beside it (specs/phone-country-spec.md). -->
                        <div class="input-group flex-nowrap">
                            @if (f.kind === 'phone' && !hasOwnCode(f.typed)) {
                                <arc-phone-country [countries]="phoneCountries()" [(value)]="phoneCountry" (chosen)="countryChosen(numberBox)" />
                            }
                            <input #numberBox class="form-control" [type]="f.kind === 'email' ? 'email' : 'tel'"
                                [placeholder]="(f.kind === 'email' ? 'member.methods.email_placeholder' : phoneCountry() === 'IN' ? 'member.methods.phone_placeholder' : 'member.methods.phone_placeholder_any') | transloco"
                                [autocomplete]="f.kind === 'email' ? 'email' : hasOwnCode(f.typed) ? 'tel' : 'tel-national'"
                                [ngModel]="f.typed" (ngModelChange)="setTyped($event)"
                                (paste)="cleanTyped()" (blur)="typedBlur($event)" (keydown.enter)="sendCode()" />
                        </div>
                        @if (f.check?.status === 'other') {
                            <div class="small mt-2 move-note">
                                {{ (f.kind === 'email' ? 'member.methods.move_email' : 'member.methods.move_number') | transloco }}
                                <a class="ms-1" role="button" (click)="signInElsewhere()">{{ 'member.methods.sign_in_elsewhere' | transloco }}</a>
                            </div>
                        }
                    }
                    @case ('code') {
                        @let sent = codeSentParts();
                        <div class="small text-muted mb-2">{{ sent[0] }}<strong>{{ shownValue() }}</strong>{{ sent[1] }}</div>
                        <arc-code-input #codeBoxes [label]="'member.auth.code_label' | transloco" [disabled]="busy()" [invalid]="!!error()"
                            (completed)="verifyCode($event)" />
                        @if (notice()) {
                            <div class="small text-muted mt-2 code-notice">{{ notice() }}</div>
                        }
                        @if (testCodeInLogs()) {
                            <div class="small text-muted mt-2">{{ (f.kind === 'email' ? 'member.auth.test_code_in_email_logs' : 'member.auth.test_code_in_logs') | transloco }}</div>
                        }
                    }
                    @case ('secret') {
                        @if (f.kind === 'phone') {
                            <div class="form-label small">{{ 'member.methods.choose_pin_number' | transloco }}</div>
                            <arc-code-input [label]="'member.methods.new_pin' | transloco" [masked]="true" [oneTimeCode]="false" [disabled]="busy()"
                                (changed)="secret.set($event)" />
                        } @else {
                            <div class="form-label small">{{ 'member.methods.choose_password_email' | transloco }}</div>
                            <input class="form-control" type="password" autocomplete="new-password" [placeholder]="'member.methods.password_placeholder' | transloco"
                                [ngModel]="secret()" (ngModelChange)="secret.set($event)" (keydown.enter)="finish()" />
                        }
                    }
                }
                @if (error()) { <div class="text-danger small mt-2">{{ error() }}</div> }
                <div class="edit-actions">
                    @switch (f.step) {
                        @case ('enter') {
                            <button class="btn btn-sm btn-primary" (click)="sendCode()" [disabled]="busy()">
                                {{ 'member.methods.send_code' | transloco }} @if (busy()) { <span class="spinner-border spinner-border-sm ms-1"></span> }
                            </button>
                        }
                        @case ('code') {
                            <button class="btn btn-sm btn-primary" (click)="verifyCode()" [disabled]="busy()">
                                {{ 'member.auth.verify' | transloco }} @if (busy()) { <span class="spinner-border spinner-border-sm ms-1"></span> }
                            </button>
                            <button class="btn btn-sm btn-link resend" (click)="resend()" [disabled]="busy() || resendIn() > 0">
                                {{ resendIn() > 0 ? ('member.auth.resend_in' | transloco: { value: resendIn() }) : ('member.auth.resend' | transloco) }}
                            </button>
                        }
                        @case ('secret') {
                            <button class="btn btn-sm btn-primary" (click)="finish()" [disabled]="busy()">
                                {{ 'member.profile.save' | transloco }} @if (busy()) { <span class="spinner-border spinner-border-sm ms-1"></span> }
                            </button>
                        }
                    }
                    <button class="btn btn-sm btn-light" (click)="cancel()">{{ 'common.actions.cancel' | transloco }}</button>
                </div>
            </div>
        </ng-template>
    `,
    styles: [`
        :host { display: block; }
        .card-title-row { padding-bottom: 1rem; border-bottom: 1px solid #eee; }
        .section-title { font-size: 1.1rem; font-weight: 600; color: #111827; margin: 0; }
        .info-row { padding: 1.25rem 0; border-bottom: 1px solid #f0f0f0; }
        .info-row:last-of-type { border-bottom: none; padding-bottom: 0; }
        .info-row > label { display: block; font-size: 0.85rem; font-weight: 500; color: #4b5563; margin-bottom: 0.5rem; }
        .info-value { display: flex; align-items: center; gap: 0.75rem; flex-wrap: wrap; }
        .info-value > span:first-child { flex: 1; font-size: 1rem; color: #111827; }
        .info-value > span.text-muted { color: #9ca3af !important; }
        .verified-badge { color: #10b981; font-size: 0.85rem; font-weight: 500; }
        .edit-form { margin-top: 0.5rem; }
        .edit-actions { display: flex; gap: 0.5rem; margin-top: 1rem; align-items: center; }
        .move-note { color: #92400e; background: #fffbeb; border: 1px solid #fde68a; border-radius: 6px; padding: 0.5rem 0.75rem; }
        @media (max-width: 576px) { .form-control { font-size: 16px; } }
    `],
})
export class SignInMethodsComponent implements OnInit, OnDestroy {
    private readonly signIn = inject(SignInService);
    private readonly authStore = inject(AuthState);
    private readonly toast = inject(ToastService);
    private readonly settings = inject(UserSettingService);
    private readonly router = inject(Router);
    private readonly t = injectT();
    private readonly transloco = inject(TranslocoService);
    private readonly lang = () => this.transloco.getActiveLang();

    readonly user = this.authStore.currentUser;
    /** Settings, SMS's default country code: how the saved number is shown. */
    readonly countryCode = signal(DEFAULT_COUNTRY_CODE);
    /** The countries a new number can be from, and the one beside the box (specs/phone-country-spec.md). */
    readonly phoneCountries = signal<string[]>([DEFAULT_COUNTRY]);
    readonly countriesListed = signal(false);
    readonly phoneCountry = signal(DEFAULT_COUNTRY);
    readonly phoneShown = computed(() => formatPhone(this.user()?.phone ?? '', this.countryCode()));

    readonly phoneEnabled = signal(false);
    readonly googleEnabled = signal(false);
    readonly googleConnected = signal(false);

    readonly flow = signal<Flow | null>(null);
    readonly changingPin = signal(false);
    readonly busy = signal(false);
    readonly error = signal('');
    readonly message = signal('');
    /** The PIN or password being chosen. */
    readonly secret = signal('');
    /**
     * Test SMS provider or Simulated email provider: nothing went out, and the
     * code is only in SMS Logs or Email Logs, for admins (review F).
     */
    readonly testCodeInLogs = signal(false);
    /** A quiet line under the code boxes: a code was sent a moment ago (specs/sign-in-codes-spec.md, SC-D2). */
    readonly notice = signal('');
    /** Seconds until Resend comes back. */
    readonly resendIn = signal(0);
    /** The codes asked for, so going back and forth never asks again too soon (SC-D1). */
    private readonly sentCodes = new SentCodes();
    private countdown?: ReturnType<typeof setInterval>;

    private readonly codeBoxes = viewChild<CodeInputComponent>('codeBoxes');

    /** "Enter the 6-digit code sent to {value}", split so the value can be bold (L-D15). */
    codeSentParts(): [string, string] {
        return sentenceParts((k, p) => this.t(k as TranslationKey, p), 'member.methods.code_sent_to');
    }

    readonly shownValue = computed(() => {
        const f = this.flow();
        const value = f?.check?.value ?? '';
        return f?.kind === 'phone' ? formatPhone(value, this.countryCode()) : value;
    });

    ngOnInit(): void {
        this.googleConnected.set(this.signIn.hasGoogle());
        firstValueFrom(this.settings.getSettings()).then((s) => {
            this.phoneEnabled.set(phoneSignInOn(s));
            const countries = phoneCountrySettings(s);
            this.countryCode.set(countryByIso(countries.country)!.code);
            this.phoneCountries.set(countries.countries);
            this.countriesListed.set(countries.listed);
            this.phoneCountry.set(startingCountry(countries.countries, countries.country, rememberedCountry()));
            this.googleEnabled.set(s.googleSignIn === true);
        }).catch(() => undefined);
    }

    start(kind: Kind): void {
        this.reset();
        this.flow.set({ kind, step: 'enter', typed: '', check: null });
    }

    startPinChange(): void {
        this.reset();
        this.changingPin.set(true);
    }

    cancel(): void {
        this.reset();
    }

    private reset(): void {
        this.flow.set(null);
        this.changingPin.set(false);
        this.error.set('');
        this.message.set('');
        this.secret.set('');
        this.testCodeInLogs.set(false);
        this.busy.set(false);
        // The codes asked for stay remembered: starting again with the same value carries on.
        this.notice.set('');
        clearInterval(this.countdown);
        this.resendIn.set(0);
    }

    setTyped(typed: string): void {
        // A different value needs a fresh check (and a fresh "linked to another account").
        this.flow.update((f) => (f ? { ...f, typed, check: null } : f));
    }

    /** Pasted or finished typing: show the cleaned-up value. */
    cleanTyped(): void {
        setTimeout(() => {
            const f = this.flow();
            if (!f) return;
            if (f.kind === 'phone') {
                const tidy = tidyChipNumber(f.typed, countryByIso(this.phoneCountry()), this.countriesListed() ? this.phoneCountries() : null);
                if (tidy?.country) this.phoneCountry.set(tidy.country.iso);
                if (tidy && tidy.shown !== f.typed) this.setTyped(tidy.shown);
                return;
            }
            const id = classifyIdentifier(f.typed, this.countryCode());
            if (id.kind === f.kind && id.display !== f.typed) this.setTyped(id.display);
        });
    }

    hasOwnCode(typed: string): boolean {
        return hasCountryCode(typed);
    }

    /** Leaving the box tidies it, but not on the way to the country chip. */
    typedBlur(event: FocusEvent): void {
        if ((event.relatedTarget as Element | null)?.closest?.('arc-phone-country')) return;
        this.cleanTyped();
    }

    countryChosen(box: HTMLInputElement): void {
        this.cleanTyped();
        box.focus();
    }

    /** The number in the box with its country code, or null when it is not one. */
    private typedPhone(typed: string): string | null {
        return chipPhone(typed, countryByIso(this.phoneCountry()));
    }

    /** What is wrong with the number typed, said as on the sign-in page. */
    private phoneError(typed: string): string {
        const country = countryByIso(this.phoneCountry());
        const allowed = this.countriesListed() ? codesOf(this.phoneCountries()) : undefined;
        const problem = identifierProblem(withoutTrunk(typed, country?.trunk), true, country?.code, allowed);
        if (problem === 'phone_not_allowed') {
            return this.t('member.auth.identifier_error.phone_not_allowed', { countries: countryListText(this.phoneCountries(), this.lang()) });
        }
        if (problem === 'phone_start' && this.phoneCountries().length > 1) return this.t('member.auth.identifier_error.phone_start_choose');
        return this.t(problem?.startsWith('phone_') ? `member.auth.identifier_error.${problem}` as TranslationKey : 'member.methods.invalid_phone');
    }

    /**
     * First press: check the value. Free: the code goes straight out. On another
     * account: one line says so, and the next press sends the code.
     */
    async sendCode(): Promise<void> {
        const f = this.flow();
        if (!f || this.busy()) return;
        const phone = f.kind === 'phone' ? this.typedPhone(f.typed) : null;
        const allowed = this.countriesListed() ? codesOf(this.phoneCountries()) : null;
        if (f.kind === 'phone' && (!phone || (allowed && !allowed.some((code) => phone.startsWith(`+${code}`))))) {
            // A number says what is wrong with it, as on the sign-in page.
            this.error.set(this.phoneError(f.typed));
            return;
        }
        if (f.kind === 'email' && classifyIdentifier(f.typed).kind !== 'email') {
            this.error.set(this.t('member.methods.invalid_email'));
            return;
        }
        if (phone && !hasCountryCode(f.typed)) rememberCountry(this.phoneCountry());
        await this.run(async () => {
            let check = f.check;
            if (!check) {
                check = await this.signIn.checkForLink(phone ?? f.typed);
                this.flow.set({ ...f, check });
                if (check.status === 'yours') throw { code: 'local', message: this.t(f.kind === 'email' ? 'member.methods.already_yours_email' : 'member.methods.already_yours_number') };
                if (check.status === 'blocked') throw { code: 'local', message: this.t('member.methods.blocked_email') };
                if (check.status === 'other') return; // shown; the next press sends the code
            }
            await this.requestCode(check);
            this.flow.set({ ...f, check, step: 'code' });
        });
    }

    ngOnDestroy(): void {
        clearInterval(this.countdown);
    }

    private startCountdown(seconds: number): void {
        clearInterval(this.countdown);
        this.resendIn.set(Math.max(0, seconds));
        this.countdown = setInterval(() => {
            if (this.resendIn() > 0) this.resendIn.update((n) => n - 1);
            else clearInterval(this.countdown);
        }, 1000);
    }

    async resend(): Promise<void> {
        const check = this.flow()?.check;
        if (!check || this.resendIn() > 0) return;
        await this.run(async () => {
            await this.requestCode(check, true);
            this.codeBoxes()?.reset();
            this.toast.success(this.t('member.methods.new_code'));
        });
    }

    /**
     * Send a code, unless one for this value still works (`resend` sends anyway).
     * The server's "please wait" starts the countdown with a quiet line instead
     * of an error (specs/sign-in-codes-spec.md, SC-D1, SC-D2).
     */
    private async requestCode(check: LinkCheck, resend = false): Promise<void> {
        const key = `${check.kind}:${check.value}`;
        this.notice.set('');
        const known = this.sentCodes.fresh(key);
        if (!resend && known) {
            this.testCodeInLogs.set(known.testCodeInLogs);
            this.startCountdown(this.sentCodes.secondsLeft(key));
            return;
        }
        this.testCodeInLogs.set(false);
        try {
            const reply = check.kind === 'email'
                ? await this.signIn.requestEmailLinkCode(check.value)
                : await this.signIn.requestPhoneCode(check.value, 'link');
            this.testCodeInLogs.set(!!reply.testMode);
            if (reply.sameCode) this.notice.set(this.t('member.auth.code_sent_again'));
            this.sentCodes.remember(key, { testCode: '', testCodeInLogs: !!reply.testMode });
            this.startCountdown(RESEND_SECONDS);
        } catch (err) {
            const failed = readSignInError(err);
            const wait = Number(failed.details?.['wait']);
            if (failed.reason !== 'wait' || !(wait > 0)) throw err;
            this.sentCodes.remember(key, { testCode: '', testCodeInLogs: known?.testCodeInLogs ?? false }, wait);
            this.testCodeInLogs.set(known?.testCodeInLogs ?? false);
            this.notice.set(this.t('member.auth.code_already_sent'));
            this.startCountdown(wait);
        }
    }

    /** The code boxes: verify on the last digit, or on the Verify button. */
    async verifyCode(code?: string): Promise<void> {
        const f = this.flow();
        const value = code ?? this.codeBoxes()?.value() ?? '';
        if (!f?.check || this.busy()) return;
        if (value.length !== 6) {
            this.error.set(this.t('member.methods.enter_code'));
            return;
        }
        const check = f.check;
        const key = `${check.kind}:${check.value}`;
        const ok = await this.run(async () => {
            try {
                if (check.kind === 'email') await this.signIn.verifyEmailLinkCode(check.value, value);
                else await this.signIn.verifyPhoneCode(check.value, value, 'link');
            } catch (err) {
                // A spent code (expired, too many tries): the next try sends a new one.
                const reason = readSignInError(err).reason;
                if (reason === 'code-expired' || reason === 'code-tries') this.sentCodes.forget(key);
                throw err;
            }
        });
        if (ok) this.sentCodes.forget(key);
        if (!ok) {
            this.codeBoxes()?.reset();
            return;
        }
        const needsSecret = check.kind === 'phone' ? check.needsPin : check.needsPassword;
        if (needsSecret) this.flow.set({ ...f, step: 'secret' });
        else await this.finish();
    }

    /** Link the verified email or number (with the new PIN or password when one was needed). */
    async finish(): Promise<void> {
        const f = this.flow();
        const check = f?.check;
        if (!f || !check) return;
        const secret = this.secret();
        if (f.step === 'secret') {
            if (check.kind === 'phone' && !/^\d{6}$/.test(secret)) {
                this.error.set(this.t('member.methods.choose_pin'));
                return;
            }
            if (check.kind === 'email' && secret.length < 8) {
                this.error.set(this.t('member.methods.password_min'));
                return;
            }
        }

        await this.run(async () => {
            const result = check.kind === 'email'
                ? await this.signIn.linkEmail(check.value, secret || undefined)
                : await this.signIn.linkPhone(check.value, secret || undefined);
            await this.authStore.refreshCurrentUser();
            this.reset();
            // Whole sentences per case, so each language orders its own words (L-D15).
            const email = check.kind === 'email';
            this.message.set(this.t(result.moved
                ? (email ? 'member.methods.email_moved' : 'member.methods.phone_moved')
                : (email ? 'member.methods.email_saved' : 'member.methods.phone_saved')));
        });
    }

    async savePin(): Promise<void> {
        if (!/^\d{6}$/.test(this.secret())) {
            this.error.set(this.t('member.methods.choose_pin'));
            return;
        }
        await this.run(async () => {
            await this.signIn.setPin(this.secret());
            this.reset();
            this.message.set(this.t('member.methods.pin_changed'));
        });
    }

    async connectGoogle(): Promise<void> {
        const ok = await this.run(() => this.signIn.connectGoogle(), (err) => {
            const code = String((err as { code?: string })?.code ?? '');
            if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
            if (code === 'auth/credential-already-in-use') return this.t('member.methods.google_in_use');
            return this.t('member.methods.google_failed');
        });
        if (ok) {
            this.googleConnected.set(true);
            this.message.set(this.t('member.methods.google_connected'));
        }
    }

    /** Sign out, to sign in to the account that has this email or number. */
    async signInElsewhere(): Promise<void> {
        await firstValueFrom(this.authStore.logout()).catch(() => undefined);
        await this.router.navigate(['/signup']);
    }

    /** Run a step with the busy flag and errors shown in place. Returns whether it worked. */
    private async run(action: () => Promise<unknown>, describe?: (err: unknown) => string): Promise<boolean> {
        this.busy.set(true);
        this.error.set('');
        this.message.set('');
        try {
            await action();
            return true;
        } catch (err) {
            this.error.set(describe ? describe(err) : readSignInError(err).message);
            return false;
        } finally {
            this.busy.set(false);
        }
    }
}
