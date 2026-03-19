/**
 * Global Message Settings Model
 * Configuration for site-wide announcement banners
 */

/**
 * Gradient preset configuration
 */
export interface IGradientPreset {
    id: string;
    name: string;
    gradient: string;
    textColor: string;
}

/**
 * Global Message Settings Interface
 */
export interface IGlobalMessageSettings {
    id?: string;
    /** Whether the global message banner is enabled */
    isEnabled: boolean;
    /** Banner heading text */
    heading: string;
    /** Banner message text */
    message: string;
    /** CTA button label (optional) */
    buttonLabel: string;
    /** CTA button URL (optional) */
    buttonLink: string;
    /** Selected gradient preset ID */
    gradientId: string;
    /** Timestamp when settings were created */
    createdAt?: Date;
    /** Timestamp when settings were last updated */
    updatedAt?: Date;
}

/**
 * Pre-defined gradient presets for the banner
 */
export const GRADIENT_PRESETS: IGradientPreset[] = [
    {
        id: 'info-blue',
        name: 'Info Blue',
        gradient: 'linear-gradient(135deg, #3c76f5 0%, #1d47a3 100%)',
        textColor: '#ffffff',
    },
    {
        id: 'warning-amber',
        name: 'Warning Amber',
        gradient: 'linear-gradient(135deg, #f093fb 0%, #f5576c 100%)',
        textColor: '#ffffff',
    },
    {
        id: 'success-green',
        name: 'Success Green',
        gradient: 'linear-gradient(135deg, #4facfe 0%, #00f2fe 100%)',
        textColor: '#ffffff',
    },
    {
        id: 'urgent-red',
        name: 'Urgent Red',
        gradient: 'linear-gradient(135deg, #fa709a 0%, #fee140 100%)',
        textColor: '#1a1a1a',
    },
    {
        id: 'ocean-blue',
        name: 'Ocean Blue',
        gradient: 'linear-gradient(135deg, #1d47a3 0%, #24c6dc 100%)',
        textColor: '#ffffff',
    },
    {
        id: 'ocean-teal',
        name: 'Ocean Teal',
        gradient: 'linear-gradient(135deg, #0ea5e9 0%, #14b8a6 100%)',
        textColor: '#ffffff',
    },
];

/**
 * Default global message settings
 */
export const DEFAULT_GLOBAL_MESSAGE_SETTINGS: IGlobalMessageSettings = {
    isEnabled: false,
    heading: '',
    message: '',
    buttonLabel: '',
    buttonLink: '',
    gradientId: 'info-blue',
};

/**
 * Get gradient preset by ID
 */
export function getGradientById(id: string): IGradientPreset {
    return GRADIENT_PRESETS.find((g) => g.id === id) || GRADIENT_PRESETS[0];
}
