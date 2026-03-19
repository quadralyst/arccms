/**
 * Site Usage Settings Model
 * Configuration for GDPR-compliant site usage banners
 */

import { GRADIENT_PRESETS, IGradientPreset } from '../message/global-message.model';

// Re-export gradient presets for use in site usage
export { GRADIENT_PRESETS };
export type { IGradientPreset };

/**
 * Get gradient by ID helper function
 */
export function getGradientById(id: string): IGradientPreset {
    return GRADIENT_PRESETS.find((g) => g.id === id) || GRADIENT_PRESETS[0];
}

/**
 * Site Usage Settings Interface
 */
export interface ISiteUsageSettings {
    id?: string;
    /** Whether the site usage banner is enabled */
    isEnabled: boolean;
    /** Main consent message text */
    bannerText: string;
    /** Accept button text */
    acceptButtonText: string;
    /** Reject button text */
    rejectButtonText: string;
    /** Link to privacy/cookie policy page */
    privacyPolicyLink: string;
    /** Selected gradient preset ID */
    gradientId: string;
    /** Timestamp when settings were created */
    createdAt?: Date;
    /** Timestamp when settings were last updated */
    updatedAt?: Date;
}

/**
 * Default site usage settings
 */
export const DEFAULT_SITE_USAGE_SETTINGS: ISiteUsageSettings = {
    isEnabled: false,
    bannerText: 'We use cookies to enhance your browsing experience and analyze site traffic. By clicking "Accept All", you consent to our use of cookies.',
    acceptButtonText: 'Accept All',
    rejectButtonText: 'Reject All',
    privacyPolicyLink: '/p/cookie-policy',
    gradientId: 'info-blue',
};

/**
 * LocalStorage key for storing user consent choice
 */
export const SITE_USAGE_STORAGE_KEY = 'arc_site_usage';

/**
 * Possible consent states
 */
export type SiteUsageState = 'pending' | 'accepted' | 'rejected';
