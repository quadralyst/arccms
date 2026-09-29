/**
 * User Settings Model
 * 
 * Defines the interface and defaults for user signup and role settings.
 */

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
