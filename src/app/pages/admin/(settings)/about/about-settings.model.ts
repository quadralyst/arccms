/**
 * About Settings Model
 *
 * Site identity configuration: name, production URL, and physical address.
 * Used by cloud functions for canonical URLs, SEO meta, and email footers.
 * Stored in Firestore at Settings/about.
 */

export interface IAboutSettings {
    name: string;
    finalUrl: string;
    address: string;
}

export const DEFAULT_ABOUT_SETTINGS: IAboutSettings = {
    name: '',
    finalUrl: '',
    address: '',
};
