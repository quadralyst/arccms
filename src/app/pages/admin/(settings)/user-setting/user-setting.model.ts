/**
 * User Settings Model
 * 
 * Defines the interface and defaults for user signup and role settings.
 */

import { isOn } from '../../../../core/features/features';
import { DEFAULT_COUNTRY_CODE } from '../../../../../shared/utils/identifier.util';

export interface IUserSettings {
    id?: string;
    isSignupEnabled: boolean;
    defaultRole: string;
    /** Sign in with a phone number (SMS code, then a PIN). Needs Settings, SMS. */
    phoneSignIn?: boolean;
    /** Sign in with Google. Needs the Google provider on in the Firebase console. */
    googleSignIn?: boolean;
    /**
     * Copy of Settings, SMS's default country code (`Settings/sms` is admin only), so the
     * sign-in page reads a number without one the way the server will. Written by
     * SmsSettingsService; digits only, `91` when missing.
     */
    phoneCountryCode?: string;
    createdAt?: any;
    updatedAt?: any;
}

/**
 * Whether people can sign in with a phone number. It sends its codes by SMS, so
 * it is off without the SMS feature whatever the setting says (specs/feature-flags-spec.md).
 */
export function phoneSignInOn(settings: Pick<IUserSettings, 'phoneSignIn'> | null | undefined, smsOn = isOn('sms')): boolean {
    return smsOn && settings?.phoneSignIn === true;
}

/** The country code a number typed without one belongs to: Settings, SMS's default. */
export function phoneCountryCode(settings: Pick<IUserSettings, 'phoneCountryCode'> | null | undefined): string {
    return String(settings?.phoneCountryCode ?? '').replace(/\D/g, '') || DEFAULT_COUNTRY_CODE;
}

export const DEFAULT_USER_SETTINGS: IUserSettings = {
    isSignupEnabled: true,
    defaultRole: 'user',
    phoneSignIn: false,
    googleSignIn: false,
};

export const AVAILABLE_ROLES = [
    {
        id: 'admin',
        label: 'Admin',
        description: 'Full access to all features',
    },
    {
        id: 'user',
        label: 'User',
        description: 'Standard user access',
    },
];
