/**
 * User Model
 * 
 * Defines the structure for user data in the application.
 */

import { UserRole, UserStatus } from '../../../../shared/components/base/base.component';
import { IBaseModel, OmitCommonFields } from '../../../../shared/models/base-model';
import type { TranslationKey } from '../../../core/i18n/translation-keys';
import { minPasswordLength, type PasswordProblem } from '../../../../shared/utils/password-rule';
import type { SignInStrength } from '../../../../shared/utils/sign-in-strength';

export interface IUser extends IBaseModel {
    email: string;
    name: string;
    firstName?: string;
    lastName?: string;
    emailVerified: boolean;
    photo?: string;
    status: UserStatus;
    role: UserRole;
    isActive: boolean;
    uid: string;
    isOnBoardingComplete?: boolean;
    updatedAt?: Date;
    /** How the account was made: `phone`, `admin`, `app` (an app account, no email or phone) and so on. */
    by?: string;
    phone?: string;
    /**
     * Who owns the sign-in account (functions/src/users/authOwner.ts): none or
     * `arccms` is Arc CMS; `shared` or `host` is another app in the same project.
     */
    authOwner?: string;
    /** An app account its app opened to self-service (docs/app/app-accounts.html). */
    selfService?: boolean;
    /**
     * The admin UI language this person reads (M-D11). Independent of the
     * languages the site publishes in: see core/i18n/admin-language.service.ts.
     */
    preferredLanguage?: string;

    // ── Premium entitlement (written ONLY by Cloud Functions; clients cannot set these) ──
    /** Master gate: true when the user currently holds a paid entitlement. */
    isPro?: boolean;
    /** The single active tier key, e.g. 'plus' | 'gold' | 'platinum'. */
    premiumType?: string;
    /** Internal rank used for highest-tier-wins resolution (higher = more access). */
    premiumTierRank?: number;
    premiumStatus?: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired';
    premiumExpiresAt?: Date;
    /** One-time purchases: end of the included free-updates window (access is lifetime). */
    updatesUntil?: Date;
    /** Grandfathering audit trail: the deal locked in at purchase. */
    premiumTierLabel?: string;
    premiumDiscountCode?: string;
    /** Prepaid credit balance (sum of the CreditLedger; written only by Cloud Functions). */
    creditBalance?: number;
    /** Which gateway granted the current entitlement. */
    provider?: 'dodo' | 'stripe' | 'razorpay';
    providerSubscriptionId?: string;
    providerCustomerId?: string;
    /** Set once a trial-ending reminder email has been sent. */
    premiumTrialReminderSent?: boolean;
}

export type UserFormData = OmitCommonFields<IUser>;

export const COMPONENT_NAME: string = 'Users';

/**
 * An account an app created for a person with no email and no phone, such as staff
 * (`by: 'app'`, docs/app/app-accounts.html).
 */
export function isAppAccount(user: { by?: unknown } | null | undefined): boolean {
    return user?.by === APP_ACCOUNT_SOURCE;
}

/** The `by` an app account has. */
export const APP_ACCOUNT_SOURCE = 'app';

/** Which accounts the users list shows: everyone, only people, or only app accounts. */
export type AccountKind = 'all' | 'people' | 'app';

export const ACCOUNT_KINDS: readonly AccountKind[] = ['all', 'people', 'app'];

/** The most accounts a search on the users page looks through: Firestore cannot search inside a field, so the page does. */
export const MAX_SEARCHED_USERS = 5000;

/**
 * Whether an account matches what was typed: any part of the name, email or phone, in any
 * case. Typed digits also match a number however it is written, so "98765" finds +919876543210.
 */
export function matchesUserSearch(user: Pick<IUser, 'name' | 'email'> & Partial<Pick<IUser, 'firstName' | 'lastName' | 'phone'>>, typed: string): boolean {
    const term = typed.trim().toLowerCase();
    if (!term) return true;
    const texts = [user.name, user.firstName, user.lastName, user.email, user.phone];
    if (texts.some((text) => typeof text === 'string' && text.toLowerCase().includes(term))) return true;
    // Without leading zeros: a number typed the way it is dialled at home, 098..., is stored as +9198...
    const digits = /^[\d\s()+.-]+$/.test(term) ? term.replace(/\D/g, '').replace(/^0+/, '') : '';
    return !!digits && typeof user.phone === 'string' && user.phone.replace(/\D/g, '').includes(digits);
}

/**
 * The query conditions for a kind of account. People are the records whose `by` is
 * anything but `app`. Firestore leaves out a record with no `by` at all, so older
 * records are given one first (fillAccountSources, UsersComponent.checkOlderAccounts).
 */
export function accountKindConditions(kind: AccountKind): Array<{ field: string; operator: '==' | '!='; value: string }> {
    if (kind === 'people') return [{ field: 'by', operator: '!=', value: APP_ACCOUNT_SOURCE }];
    if (kind === 'app') return [{ field: 'by', operator: '==', value: APP_ACCOUNT_SOURCE }];
    return [];
}

/**
 * The reasons the users callables refuse with (functions/src/users/adminUserAccess.ts,
 * adminSetPhone.ts, adminCreateUser.ts, adminSetPassword.ts), and what the page says.
 */
const USER_REFUSALS: Record<string, TranslationKey> = {
    'last-admin': 'admin.users.errors.last_admin',
    'own-account': 'admin.users.errors.own_account',
    'unverified-account': 'admin.users.errors.unverified_account',
    'app-managed': 'admin.users.errors.app_managed',
    'shared-account': 'admin.users.errors.shared_account',
    'no-account': 'admin.users.errors.no_account',
    'no-email': 'admin.users.errors.no_email',
    'pin-sign-in': 'admin.users.errors.pin_sign_in',
    'number-taken': 'admin.users.errors.number_taken',
    'invalid-number': 'admin.users.errors.invalid_number',
    'country-not-allowed': 'admin.users.errors.country_not_allowed',
    'not-active-admin': 'admin.users.errors.not_active_admin',
    'detached': 'admin.users.errors.detached',
};

/** Refusals that carry no reason, known by their code alone. */
const USER_REFUSAL_CODES: Record<string, TranslationKey> = {
    'functions/already-exists': 'admin.users.errors.already_exists',
    'functions/not-found': 'admin.users.errors.not_found',
    'functions/invalid-argument': 'admin.users.errors.check_details',
};

/** What is wrong with a password an admin typed, in the admin's words (the member's are member.auth.password_error). */
const PASSWORD_PROBLEMS: Record<PasswordProblem, TranslationKey> = {
    short: 'admin.users.password_errors.short',
    repeated: 'admin.users.password_errors.repeated',
    sequence: 'admin.users.password_errors.sequence',
    common: 'admin.users.password_errors.common',
    personal: 'admin.users.password_errors.personal',
};

/** The translated reason a password an admin typed for someone is refused. */
export function passwordProblemMessage(problem: PasswordProblem | null | undefined, t: (key: TranslationKey, params?: Record<string, unknown>) => string, strength: SignInStrength = 'strict'): string {
    return t(PASSWORD_PROBLEMS[problem ?? 'short'] ?? PASSWORD_PROBLEMS.short, { min: minPasswordLength(strength) });
}

/**
 * What to tell an admin when a users callable failed: the refusal's reason in their
 * language (a weak password says what is wrong with it), or what its code means,
 * or else `fallback`. Never the server's English: the technical detail stays in the console.
 */
export function userActionError(error: unknown, t: (key: TranslationKey, params?: Record<string, unknown>) => string, fallback: TranslationKey): string {
    const failure = error as { code?: unknown; details?: { reason?: unknown; problem?: unknown; min?: unknown } } | null;
    const details = failure?.details;
    const reason = typeof details?.reason === 'string' ? details.reason : '';
    if (reason === 'weak-password') {
        const problem = typeof details?.problem === 'string' && details.problem in PASSWORD_PROBLEMS ? details.problem as PasswordProblem : 'short';
        return t(PASSWORD_PROBLEMS[problem], { min: typeof details?.min === 'number' ? details.min : minPasswordLength() });
    }
    const key = USER_REFUSALS[reason] ?? (reason ? undefined : USER_REFUSAL_CODES[typeof failure?.code === 'string' ? failure.code : '']);
    return t(key ?? fallback, details as Record<string, unknown> | undefined);
}

/**
 * The roles Add user and Edit user offer: the known roles (Settings, Users), and the
 * role the record has now when it is another one, so saving never changes it unasked.
 */
export function roleChoices(known: ReadonlyArray<{ id: string }>, current?: string | null): string[] {
    const ids = known.map((role) => role.id);
    return current && !ids.includes(current) ? [...ids, current] : ids;
}

/**
 * The translated name of a role. One the admin pages do not name reads as words from
 * its id, in sentence case: `propertyOwner` is "Property owner".
 */
export function roleLabel(role: string, t: (key: TranslationKey) => string): string {
    if (role === 'admin') return t('admin.users.roles.admin');
    if (role === 'user') return t('admin.users.roles.user');
    const words = role.replace(/([a-z\d])([A-Z])/g, '$1 $2').replace(/[_-]+/g, ' ').trim().toLowerCase();
    return words ? words.charAt(0).toUpperCase() + words.slice(1) : role;
}
