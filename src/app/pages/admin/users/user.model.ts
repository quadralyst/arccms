/**
 * User Model
 * 
 * Defines the structure for user data in the application.
 */

import { UserRole, UserStatus } from '../../../../shared/components/base/base.component';
import { IBaseModel, OmitCommonFields } from '../../../../shared/models/base-model';

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
     * languages the site publishes in — see core/i18n/admin-language.service.ts.
     */
    preferredLanguage?: string;

    // ── Premium entitlement (written ONLY by Cloud Functions; clients cannot set these) ──
    /** Master gate — true when the user currently holds a paid entitlement. */
    isPro?: boolean;
    /** The single active tier key, e.g. 'plus' | 'gold' | 'platinum'. */
    premiumType?: string;
    /** Internal rank used for highest-tier-wins resolution (higher = more access). */
    premiumTierRank?: number;
    premiumStatus?: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired';
    premiumExpiresAt?: Date;
    /** One-time purchases: end of the included free-updates window (access is lifetime). */
    updatesUntil?: Date;
    /** Grandfathering audit trail — the deal locked in at purchase. */
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
