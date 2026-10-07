/**
 * Phone, Google and linked sign-in from the browser: thin wrappers over the
 * callables in functions/src/auth, plus the Firebase calls that finish a
 * sign-in (a custom token for phone, the Google popup).
 */
import { inject, Injectable, Injector, runInInjectionContext } from '@angular/core';
import {
    Auth,
    GoogleAuthProvider,
    linkWithCredential,
    linkWithPopup,
    signInWithCustomToken,
    signInWithPopup,
    type AuthCredential,
    type UserCredential,
} from '@angular/fire/auth';
import { Functions } from '@angular/fire/functions';
import { arcCallable } from '../../core/config/arc-functions';
import { TranslocoService } from '@jsverse/transloco';
import { genericErrorText } from './auth-messages';

export type PhoneOtpPurpose = 'signup' | 'reset' | 'link';

export interface PhoneAccount {
    phone: string;
    exists: boolean;
    hasPin: boolean;
    signupOpen: boolean;
}

export type LinkStatus = 'available' | 'yours' | 'other' | 'blocked';

export interface LinkCheck {
    kind: 'email' | 'phone';
    value: string;
    status: LinkStatus;
    needsPin?: boolean;
    needsPassword?: boolean;
}

/**
 * The functions a sign-in or sign-up calls, woken by `warmUp()` when the page
 * opens. Each answers a `{ warmUp: true }` call at once (functions/src/auth/warmUp.ts).
 */
export const SIGN_IN_FUNCTIONS = {
    email: ['checkEmailAccount', 'requestSignupOtp', 'verifySignupOtp', 'createAccountRecord'],
    phone: ['checkPhoneAccount', 'requestPhoneOtp', 'verifyPhoneOtp', 'completePhoneSignup', 'signInWithPin'],
    google: ['ensureGoogleAccount'],
} as const;

/** A function stays started for several minutes after a call, so waking it more often is wasted. */
const WARM_UP_EVERY_MS = 5 * 60 * 1000;

/** A callable's error, as the page shows it. */
export interface SignInError {
    code: string;
    message: string;
    reason?: string;
}

/** Read a Firebase or callable error into something a page can show. */
export function readSignInError(err: unknown, fallback = genericErrorText()): SignInError {
    const e = err as { code?: string; message?: string; details?: { reason?: string } };
    const code = String(e?.code ?? '').replace(/^functions\//, '');
    const message = code && code !== 'internal' && e?.message ? e.message : fallback;
    return { code, message, reason: e?.details?.reason };
}

@Injectable({ providedIn: 'root' })
export class SignInService {
    private readonly auth = inject(Auth);
    private readonly functions = inject(Functions);
    private readonly injector = inject(Injector);

    /**
     * Tickets from verified codes, by purpose and number or address. The step
     * after a code (create the account, set a new PIN) sends its ticket back, so
     * only this browser can use the code it verified (review F).
     */
    private readonly tickets = new Map<string, string>();

    private lastWarmUp = 0;

    /**
     * Start the functions this page's sign-in methods use, without waiting:
     * each one would otherwise take seconds to start on its first call, one
     * after another through the steps. A warm-up call does nothing on the
     * server, and a failed one changes nothing.
     */
    warmUp(methods: { phone: boolean; google: boolean }): void {
        const now = Date.now();
        if (now - this.lastWarmUp < WARM_UP_EVERY_MS) return;
        this.lastWarmUp = now;
        const names: string[] = [
            ...SIGN_IN_FUNCTIONS.email,
            ...(methods.phone ? SIGN_IN_FUNCTIONS.phone : []),
            ...(methods.google ? SIGN_IN_FUNCTIONS.google : []),
        ];
        for (const name of names) {
            this.call(name, { warmUp: true }).catch(() => undefined);
        }
    }

    private rememberTicket(key: string, reply: { ticket?: string }): void {
        if (reply?.ticket) this.tickets.set(key, reply.ticket);
    }

    private async call<T>(name: string, data: Record<string, unknown>): Promise<T> {
        const result = await runInInjectionContext(this.injector, () => arcCallable(this.functions, name)(data));
        return result.data as T;
    }

    // --- Email ---------------------------------------------------------------

    /**
     * Registered (password), new (sign up), a login with no access to this site,
     * or `unfinished`: a recent sign-up whose record was never made, which the
     * next password sign-in finishes.
     */
    checkEmail(email: string): Promise<{ status: 'registered' | 'new' | 'no-access' | 'unfinished'; signupOpen: boolean }> {
        return this.call('checkEmailAccount', { email });
    }

    /**
     * Email sign-up, after the browser created the password sign-in: the server
     * writes the record and its claims (functions/src/auth/emailAccount.ts), and
     * the token is refreshed so it carries them.
     */
    async createAccountRecord(name: string, options: { finish?: boolean } = {}): Promise<{ id: string; created: boolean }> {
        const email = (this.auth.currentUser?.email ?? '').trim().toLowerCase();
        const ticket = this.tickets.get(`email:signup:${email}`);
        const result = await this.call<{ id: string; created: boolean }>('createAccountRecord', {
            name, ...(ticket ? { ticket } : {}), ...(options.finish ? { finish: true } : {}),
        });
        this.tickets.delete(`email:signup:${email}`);
        await this.auth.currentUser?.getIdToken(true);
        return result;
    }

    /**
     * Email a sign-up code to this address. `testMode`: the Simulated email
     * provider, where nothing is sent, and the code comes back as `testCode`.
     */
    requestSignupCode(email: string, name?: string): Promise<{ sent: boolean; testMode?: boolean; testCode?: string }> {
        return this.call('requestSignupOtp', { email, ...(name ? { name } : {}) });
    }

    /** Check the sign-up code sent to this address. */
    async verifySignupCode(email: string, code: string): Promise<{ verified: boolean }> {
        const reply = await this.call<{ verified: boolean; ticket?: string }>('verifySignupOtp', { email, code });
        this.rememberTicket(`email:signup:${email.trim().toLowerCase()}`, reply);
        return { verified: reply.verified };
    }

    // --- The account's claims and deletion (docs/app/account-contract.html) ------

    /**
     * Make sure the ID token carries this record's `arccms_uid` and its role as
     * `arccms_role`: asks the server to set the claims when the token lacks or
     * disagrees with them (an account made before a claim existed, or a role
     * changed since), then refreshes the token. Returns whether it had to.
     */
    async ensureRecordClaim(userDocId: string, role = ''): Promise<boolean> {
        const user = this.auth.currentUser;
        if (!user || !userDocId) return false;
        const { claims } = await user.getIdTokenResult();
        if (claims['arccms_uid'] === userDocId && (claims['arccms_role'] ?? '') === (role || '')) return false;
        await this.call('refreshMyClaims', {});
        await user.getIdToken(true);
        return true;
    }

    deleteMyAccount(): Promise<{ deleted: boolean }> {
        return this.call('deleteMyAccount', {});
    }

    // --- Phone ---------------------------------------------------------------

    checkPhone(phone: string): Promise<PhoneAccount> {
        return this.call('checkPhoneAccount', { phone });
    }

    /**
     * `testMode`: the Test SMS provider, where nothing is sent. A sign-up code
     * then comes back as `testCode`, and so does a reset code when an admin turned
     * on "Show PIN reset codes on screen" (Settings, SMS); otherwise reset and link
     * codes are in SMS Logs only.
     */
    requestPhoneCode(phone: string, purpose: PhoneOtpPurpose): Promise<{ sent: boolean; testMode?: boolean; testCode?: string }> {
        return this.call('requestPhoneOtp', { phone, purpose });
    }

    async verifyPhoneCode(phone: string, code: string, purpose: PhoneOtpPurpose): Promise<{ verified: boolean }> {
        const reply = await this.call<{ verified: boolean; ticket?: string }>('verifyPhoneOtp', { phone, code, purpose });
        this.rememberTicket(`phone:${purpose}:${phone}`, reply);
        return { verified: reply.verified };
    }

    async completePhoneSignup(phone: string, name: string, pin: string): Promise<void> {
        const ticket = this.tickets.get(`phone:signup:${phone}`);
        const { token } = await this.call<{ token: string }>('completePhoneSignup', { phone, name, pin, ticket });
        this.tickets.delete(`phone:signup:${phone}`);
        await this.signInWithToken(token);
    }

    async signInWithPin(phone: string, pin: string): Promise<void> {
        const { token } = await this.call<{ token: string }>('signInWithPin', { phone, pin });
        await this.signInWithToken(token);
    }

    async resetPin(phone: string, pin: string): Promise<void> {
        const ticket = this.tickets.get(`phone:reset:${phone}`);
        const { token } = await this.call<{ token: string }>('resetPin', { phone, pin, ticket });
        this.tickets.delete(`phone:reset:${phone}`);
        await this.signInWithToken(token);
    }

    setPin(pin: string): Promise<{ saved: boolean }> {
        return this.call('setPin', { pin });
    }

    private signInWithToken(token: string): Promise<UserCredential> {
        return runInInjectionContext(this.injector, () => signInWithCustomToken(this.auth, token));
    }

    // --- Google --------------------------------------------------------------

    /** Google popup, then make sure the person has a record, and a token carrying its claims. */
    async signInWithGoogle(): Promise<void> {
        await runInInjectionContext(this.injector, () => signInWithPopup(this.auth, new GoogleAuthProvider()));
        await this.call('ensureGoogleAccount', {});
        await this.auth.currentUser?.getIdToken(true);
    }

    /** The Google credential from a failed popup, to link after the password sign-in. */
    googleCredentialFrom(err: unknown): AuthCredential | null {
        return GoogleAuthProvider.credentialFromError(err as never);
    }

    async linkCredential(credential: AuthCredential): Promise<void> {
        const user = this.auth.currentUser;
        if (user) await runInInjectionContext(this.injector, () => linkWithCredential(user, credential));
    }

    /** Profile: connect Google to the signed-in account. */
    async connectGoogle(): Promise<void> {
        const user = this.auth.currentUser;
        if (!user) throw { code: 'unauthenticated', message: this.injector.get(TranslocoService).translate('member.errors.sign_in_again') };
        await runInInjectionContext(this.injector, () => linkWithPopup(user, new GoogleAuthProvider()));
    }

    /** Whether the signed-in account has Google connected. */
    hasGoogle(): boolean {
        return this.hasProvider('google.com');
    }

    /** Whether the signed-in account has a password (email sign-in). */
    hasPassword(): boolean {
        return this.hasProvider('password');
    }

    private hasProvider(providerId: string): boolean {
        return !!this.auth.currentUser?.providerData.some((p) => p.providerId === providerId);
    }

    // --- Adding or moving an email or number ---------------------------------

    checkForLink(identifier: string): Promise<LinkCheck> {
        return this.call('checkIdentifierForLink', { identifier });
    }

    /** `testMode`: the Simulated email provider; the code is in Email Logs only. */
    requestEmailLinkCode(email: string): Promise<{ sent: boolean; testMode?: boolean }> {
        return this.call('requestEmailLinkOtp', { email });
    }

    verifyEmailLinkCode(email: string, code: string): Promise<{ verified: boolean }> {
        return this.call('verifySignupOtp', { email, code, purpose: 'link' });
    }

    async linkEmail(email: string, password?: string): Promise<{ moved: boolean }> {
        const result = await this.call<{ moved: boolean }>('linkEmail', { email, ...(password ? { password } : {}) });
        // The session still carries the old address until the token refreshes.
        await this.auth.currentUser?.reload();
        await this.auth.currentUser?.getIdToken(true);
        return result;
    }

    linkPhone(phone: string, pin?: string): Promise<{ moved: boolean }> {
        return this.call('linkPhone', { phone, ...(pin ? { pin } : {}) });
    }
}
