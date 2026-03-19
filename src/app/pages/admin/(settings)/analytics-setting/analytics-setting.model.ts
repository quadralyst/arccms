/**
 * Google Analytics OAuth Configuration
 */
export interface IAnalyticsOAuthConfig {
    clientId: string;
    clientSecret: string;
}

/**
 * Analytics Settings Model
 * Stored in Firestore at Settings/analytics
 * Only the OAuth client credentials are managed from this page.
 * Tokens are managed server-side by cloud functions.
 */
export interface IAnalyticsSettings {
    id?: string;
    oauth: IAnalyticsOAuthConfig;
    isConnected?: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}

/**
 * Default analytics settings values
 */
export const DEFAULT_ANALYTICS_SETTINGS: IAnalyticsSettings = {
    oauth: {
        clientId: '',
        clientSecret: '',
    },
    isConnected: false,
};
