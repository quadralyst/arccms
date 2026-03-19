/**
 * Unsplash Integration Configuration
 */
export interface IUnsplashConfig {
    accessKey: string;
    secretKey: string;
}

/**
 * Geolocation Integration Configuration
 */
export interface IGeoConfig {
    geoEnabled: boolean;
    geoApiProvider: 'ipapi' | 'ipinfo' | 'custom';
    geoApiKey: string;
    geoApiEndpoint: string;
}

/**
 * Integrations Settings Model
 * Stored in Firestore at Settings/integrations
 */
export interface IIntegrationsSettings {
    id?: string;
    unsplash: IUnsplashConfig;
    geo: IGeoConfig;
    createdAt?: Date;
    updatedAt?: Date;
}

/**
 * Default integrations settings values
 */
export const DEFAULT_INTEGRATIONS_SETTINGS: IIntegrationsSettings = {
    unsplash: {
        accessKey: '',
        secretKey: '',
    },
    geo: {
        geoEnabled: false,
        geoApiProvider: 'ipapi',
        geoApiKey: '',
        geoApiEndpoint: '',
    },
};
