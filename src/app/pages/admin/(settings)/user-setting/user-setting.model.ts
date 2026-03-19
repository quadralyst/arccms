/**
 * User Settings Model
 * 
 * Defines the interface and defaults for user signup and role settings.
 */

export interface IUserSettings {
    id?: string;
    isSignupEnabled: boolean;
    defaultRole: string;
    createdAt?: any;
    updatedAt?: any;
}

export const DEFAULT_USER_SETTINGS: IUserSettings = {
    isSignupEnabled: true,
    defaultRole: 'user',
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
