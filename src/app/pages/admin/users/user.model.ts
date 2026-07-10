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
    password?: string;
    emailVerified: boolean;
    photo?: string;
    status: UserStatus;
    role: UserRole;
    isActive: boolean;
    uid: string;
    isOnBoardingComplete?: boolean;
    updatedAt?: Date;

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
    dodoSubscriptionId?: string;
    dodoCustomerId?: string;
    /** Set once a trial-ending reminder email has been sent. */
    premiumTrialReminderSent?: boolean;
}

export type UserFormData = OmitCommonFields<IUser>;

export const COMPONENT_NAME: string = 'Users';
