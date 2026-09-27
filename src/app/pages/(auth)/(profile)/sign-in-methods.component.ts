/**
 * Profile, "Sign-in methods": the account's email, phone number and Google,
 * each added or changed with a verification code.
 *
 * One small inline flow per row: enter the email or number, get a code, and
 * (only when the account has none yet) choose a password or PIN. When the
 * email or number is on another account, one line says so and the same
 * button moves it here once the code is verified.
 */
import { ChangeDetectionStrategy, Component, computed, inject, OnInit, signal, viewChild } from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { firstValueFrom } from 'rxjs';
import { AuthState } from '../auth.store';
import { readSignInError, SignInService, type LinkCheck } from '../sign-in.service';
import { CodeInputComponent } from '../../../../shared/components/code-input/code-input.component';
import { ToastService } from '../../../../shared/services/toast.service';
import { UserSettingService } from '../../admin/(settings)/user-setting/user-setting.service';
import { classifyIdentifier, formatPhone } from '../../../../shared/utils/identifier.util';

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
    imports: [FormsModule, NgTemplateOutlet, CodeInputComponent],
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `
        <div class="card-title-row">
            <h2 class="section-title"><i class="fas fa-key me-2"></i> Sign-in methods</h2>
        </div>

        @if (message()) {
            <div class="alert alert-success mt-3 mb-0 py-2">{{ message() }}</div>
        }

        <!-- Email -->
        <div class="info-row">
            <label>Email</label>
            @if (flow()?.kind !== 'email') {
                <div class="info-value">
                    <span [class.text-muted]="!user()?.email">{{ user()?.email || 'Not added' }}</span>
                    @if (user()?.email && user()?.emailVerified) {
                        <span class="verified-badge"><i class="fas fa-check-circle me-1"></i>Verified</span>
                    }
                    <button class="btn btn-sm btn-outline-secondary" (click)="start('email')" [disabled]="!!flow()">
                        {{ user()?.email ? 'Change' : 'Add' }}
                    </button>
                </div>
            } @else {
                <ng-container *ngTemplateOutlet="flowTpl" />
            }
        </div>

        <!-- Phone -->
        @if (phoneEnabled() || user()?.phone) {
            <div class="info-row">
                <label>Phone number</label>
                @if (flow()?.kind !== 'phone' && !changingPin()) {
                    <div class="info-value">
                        <span [class.text-muted]="!user()?.phone">{{ user()?.phone ? phoneShown() : 'Not added' }}</span>
                        @if (user()?.phone) {
                            <button class="btn btn-sm btn-link" (click)="startPinChange()" [disabled]="!!flow()">Change PIN</button>
                        }
                        @if (phoneEnabled()) {
                            <button class="btn btn-sm btn-outline-secondary" (click)="start('phone')" [disabled]="!!flow()">
                                {{ user()?.phone ? 'Change' : 'Add' }}
                            </button>
                        }
                    </div>
                } @else if (changingPin()) {
                    <div class="edit-form">
                        <div class="form-label small">New 6-digit PIN</div>
                        <arc-code-input label="New PIN" [masked]="true" [oneTimeCode]="false" [disabled]="busy()"
                            (changed)="secret.set($event)" />
                        @if (error()) { <div class="text-danger small mt-2">{{ error() }}</div> }
                        <div class="edit-actions">
                            <button class="btn btn-sm btn-primary" (click)="savePin()" [disabled]="busy()">
                                Save PIN @if (busy()) { <span class="spinner-border spinner-border-sm ms-1"></span> }
                            </button>
                            <button class="btn btn-sm btn-light" (click)="cancel()">Cancel</button>
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
                <label>Google</label>
                <div class="info-value">
                    <span [class.text-muted]="!googleConnected()">{{ googleConnected() ? 'Connected' : 'Not connected' }}</span>
                    @if (!googleConnected()) {
                        <button class="btn btn-sm btn-outline-secondary" (click)="connectGoogle()" [disabled]="!!flow() || busy()">Connect</button>
                    }
                </div>
            </div>
        }

        <ng-template #flowTpl>
            @let f = flow()!;
            <div class="edit-form">
                @switch (f.step) {
                    @case ('enter') {
                        <input class="form-control" [type]="f.kind === 'email' ? 'email' : 'tel'"
                            [placeholder]="f.kind === 'email' ? 'name@example.com' : '98765 43210'"
                            [autocomplete]="f.kind === 'email' ? 'email' : 'tel'"
                            [ngModel]="f.typed" (ngModelChange)="setTyped($event)"
                            (paste)="cleanTyped()" (blur)="cleanTyped()" (keydown.enter)="sendCode()" />
                        @if (f.check?.status === 'other') {
                            <div class="small mt-2 move-note">
                                This {{ f.kind === 'email' ? 'email' : 'number' }} is linked to another account. Verify it to move it here.
                                <a class="ms-1" role="button" (click)="signInElsewhere()">Sign in to that account instead</a>
                            </div>
                        }
                    }
                    @case ('code') {
                        <div class="small text-muted mb-2">Enter the 6-digit code sent to <strong>{{ shownValue() }}</strong></div>
                        <arc-code-input #codeBoxes label="Verification code" [disabled]="busy()" [invalid]="!!error()"
                            (completed)="verifyCode($event)" />
                    }
                    @case ('secret') {
                        @if (f.kind === 'phone') {
                            <div class="form-label small">Choose a 6-digit PIN for signing in with your number</div>
                            <arc-code-input label="New PIN" [masked]="true" [oneTimeCode]="false" [disabled]="busy()"
                                (changed)="secret.set($event)" />
                        } @else {
                            <div class="form-label small">Choose a password for signing in with your email</div>
                            <input class="form-control" type="password" autocomplete="new-password" placeholder="At least 8 characters"
                                [ngModel]="secret()" (ngModelChange)="secret.set($event)" (keydown.enter)="finish()" />
                        }
                    }
                }
                @if (error()) { <div class="text-danger small mt-2">{{ error() }}</div> }
                <div class="edit-actions">
                    @switch (f.step) {
                        @case ('enter') {
                            <button class="btn btn-sm btn-primary" (click)="sendCode()" [disabled]="busy()">
                                Send code @if (busy()) { <span class="spinner-border spinner-border-sm ms-1"></span> }
                            </button>
                        }
                        @case ('code') {
                            <button class="btn btn-sm btn-primary" (click)="verifyCode()" [disabled]="busy()">
                                Verify @if (busy()) { <span class="spinner-border spinner-border-sm ms-1"></span> }
                            </button>
                            <button class="btn btn-sm btn-link" (click)="resend()" [disabled]="busy()">Resend</button>
                        }
                        @case ('secret') {
                            <button class="btn btn-sm btn-primary" (click)="finish()" [disabled]="busy()">
                                Save @if (busy()) { <span class="spinner-border spinner-border-sm ms-1"></span> }
                            </button>
                        }
                    }
                    <button class="btn btn-sm btn-light" (click)="cancel()">Cancel</button>
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
export class SignInMethodsComponent implements OnInit {
    private readonly signIn = inject(SignInService);
    private readonly authStore = inject(AuthState);
    private readonly toast = inject(ToastService);
    private readonly settings = inject(UserSettingService);
    private readonly router = inject(Router);

    readonly user = this.authStore.currentUser;
    readonly phoneShown = computed(() => formatPhone(this.user()?.phone ?? ''));

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

    private readonly codeBoxes = viewChild<CodeInputComponent>('codeBoxes');

    readonly shownValue = computed(() => {
        const f = this.flow();
        const value = f?.check?.value ?? '';
        return f?.kind === 'phone' ? formatPhone(value) : value;
    });

    ngOnInit(): void {
        this.googleConnected.set(this.signIn.hasGoogle());
        firstValueFrom(this.settings.getSettings()).then((s) => {
            this.phoneEnabled.set(s.phoneSignIn === true);
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
        this.busy.set(false);
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
            const id = classifyIdentifier(f.typed);
            if (id.kind === f.kind && id.display !== f.typed) this.setTyped(id.display);
        });
    }

    /**
     * First press: check the value. Free: the code goes straight out. On another
     * account: one line says so, and the next press sends the code.
     */
    async sendCode(): Promise<void> {
        const f = this.flow();
        if (!f || this.busy()) return;
        const id = classifyIdentifier(f.typed);
        if (id.kind !== f.kind) {
            this.error.set(f.kind === 'email' ? 'Enter a valid email address.' : 'Enter a valid mobile number.');
            return;
        }
        await this.run(async () => {
            let check = f.check;
            if (!check) {
                check = await this.signIn.checkForLink(f.typed);
                this.flow.set({ ...f, check });
                if (check.status === 'yours') throw { code: 'local', message: `This ${f.kind === 'email' ? 'email' : 'number'} is already on your account.` };
                if (check.status === 'blocked') throw { code: 'local', message: 'This email is used by an account that cannot be moved here.' };
                if (check.status === 'other') return; // shown; the next press sends the code
            }
            await this.requestCode(check);
            this.flow.set({ ...f, check, step: 'code' });
        });
    }

    async resend(): Promise<void> {
        const check = this.flow()?.check;
        if (!check) return;
        await this.run(async () => {
            await this.requestCode(check);
            this.codeBoxes()?.reset();
            this.toast.success('A new code is on its way');
        });
    }

    private requestCode(check: LinkCheck): Promise<unknown> {
        return check.kind === 'email'
            ? this.signIn.requestEmailLinkCode(check.value)
            : this.signIn.requestPhoneCode(check.value, 'link');
    }

    /** The code boxes: verify on the last digit, or on the Verify button. */
    async verifyCode(code?: string): Promise<void> {
        const f = this.flow();
        const value = code ?? this.codeBoxes()?.value() ?? '';
        if (!f?.check || this.busy()) return;
        if (value.length !== 6) {
            this.error.set('Please enter the 6-digit code.');
            return;
        }
        const check = f.check;
        const ok = await this.run(async () => {
            if (check.kind === 'email') await this.signIn.verifyEmailLinkCode(check.value, value);
            else await this.signIn.verifyPhoneCode(check.value, value, 'link');
        });
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
                this.error.set('Choose a 6-digit PIN.');
                return;
            }
            if (check.kind === 'email' && secret.length < 8) {
                this.error.set('Use at least 8 characters.');
                return;
            }
        }
        const label = check.kind === 'email' ? 'Email' : 'Phone number';
        await this.run(async () => {
            const result = check.kind === 'email'
                ? await this.signIn.linkEmail(check.value, secret || undefined)
                : await this.signIn.linkPhone(check.value, secret || undefined);
            await this.authStore.refreshCurrentUser();
            this.reset();
            this.message.set(result.moved ? `${label} moved to this account.` : `${label} saved.`);
        });
    }

    async savePin(): Promise<void> {
        if (!/^\d{6}$/.test(this.secret())) {
            this.error.set('Choose a 6-digit PIN.');
            return;
        }
        await this.run(async () => {
            await this.signIn.setPin(this.secret());
            this.reset();
            this.message.set('PIN changed.');
        });
    }

    async connectGoogle(): Promise<void> {
        const ok = await this.run(() => this.signIn.connectGoogle(), (err) => {
            const code = String((err as { code?: string })?.code ?? '');
            if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return '';
            if (code === 'auth/credential-already-in-use') return 'This Google account is already used by another account.';
            return 'Google could not be connected. Please try again.';
        });
        if (ok) {
            this.googleConnected.set(true);
            this.message.set('Google connected.');
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
