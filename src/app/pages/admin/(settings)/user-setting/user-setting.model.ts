/**
 * User Settings Model
 * 
 * Defines the interface and defaults for user signup and role settings.
 */

import { isOn } from '../../../../core/features/features';
import { DEFAULT_COUNTRY_CODE } from '../../../../../shared/utils/identifier.util';
import { cleanCountryList, resolveCountrySettings } from '../../../../../shared/data/countries';

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
    /** Copy of Settings, SMS's default country (ISO id, `IN`), which the country chip starts on. */
    phoneCountry?: string;
    /** Copy of Settings, SMS's allowed countries (ISO ids), the only ones the country chip offers. */
    phoneCountries?: string[];
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

/**
 * The countries the sign-in page's country chip offers (specs/phone-country-spec.md).
 * `listed` is false for a copy written before countries were stored: the page then
 * leaves a number with its own `+code` to the server rather than refuse it.
 */
export function phoneCountrySettings(
    settings: Pick<IUserSettings, 'phoneCountryCode' | 'phoneCountry' | 'phoneCountries'> | null | undefined,
): { country: string; countries: string[]; listed: boolean } {
    const listed = cleanCountryList(settings?.phoneCountries).length > 0;
    const resolved = resolveCountrySettings({
        countries: settings?.phoneCountries,
        country: settings?.phoneCountry,
        code: settings?.phoneCountryCode,
    });
    return { ...resolved, listed };
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
