/**
 * User Settings Model
 * 
 * Defines the interface and defaults for user signup and role settings.
 */

import { isOn } from '../../../../core/features/features';

export interface IUserSettings {
    id?: string;
    isSignupEnabled: boolean;
    defaultRole: string;
    /** Sign in with a phone number (SMS code, then a PIN). Needs Settings, SMS. */
    phoneSignIn?: boolean;
    /** Sign in with Google. Needs the Google provider on in the Firebase console. */
    googleSignIn?: boolean;
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
