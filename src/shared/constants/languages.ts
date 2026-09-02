/**
 * Language catalogue
 *
 * The picker list for the Localization settings page. Codes are BCP-47 primary
 * subtags and double as the URL prefix for published pages (`/hi/articles/...`).
 *
 * This is a convenience list, not a limit — the settings page also accepts a
 * custom code, and `ILanguage` entries in `Settings/localization` are stored
 * with their own labels, so removing a language from this catalogue never
 * breaks a site already publishing it.
 *
 * Spec: docs/multilingual-spec.md — Phase M1.
 */

import { ILanguage } from '../models/localization.model';

export const SUPPORTED_LANGUAGES: ILanguage[] = [
    { code: 'en', label: 'English', nativeLabel: 'English' },
    { code: 'es', label: 'Spanish', nativeLabel: 'Español' },
    { code: 'fr', label: 'French', nativeLabel: 'Français' },
    { code: 'de', label: 'German', nativeLabel: 'Deutsch' },
    { code: 'it', label: 'Italian', nativeLabel: 'Italiano' },
    { code: 'pt', label: 'Portuguese', nativeLabel: 'Português' },
    { code: 'nl', label: 'Dutch', nativeLabel: 'Nederlands' },
    { code: 'ru', label: 'Russian', nativeLabel: 'Русский' },
    { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
    { code: 'bn', label: 'Bengali', nativeLabel: 'বাংলা' },
    { code: 'mr', label: 'Marathi', nativeLabel: 'मराठी' },
    { code: 'ta', label: 'Tamil', nativeLabel: 'தமிழ்' },
    { code: 'te', label: 'Telugu', nativeLabel: 'తెలుగు' },
    { code: 'gu', label: 'Gujarati', nativeLabel: 'ગુજરાતી' },
    { code: 'kn', label: 'Kannada', nativeLabel: 'ಕನ್ನಡ' },
    { code: 'ml', label: 'Malayalam', nativeLabel: 'മലയാളം' },
    { code: 'pa', label: 'Punjabi', nativeLabel: 'ਪੰਜਾਬੀ' },
    { code: 'zh', label: 'Chinese', nativeLabel: '中文' },
    { code: 'ja', label: 'Japanese', nativeLabel: '日本語' },
    { code: 'ko', label: 'Korean', nativeLabel: '한국어' },
    { code: 'id', label: 'Indonesian', nativeLabel: 'Bahasa Indonesia' },
    { code: 'vi', label: 'Vietnamese', nativeLabel: 'Tiếng Việt' },
    { code: 'th', label: 'Thai', nativeLabel: 'ไทย' },
    { code: 'tr', label: 'Turkish', nativeLabel: 'Türkçe' },
    { code: 'pl', label: 'Polish', nativeLabel: 'Polski' },
    { code: 'uk', label: 'Ukrainian', nativeLabel: 'Українська' },
    { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true },
    { code: 'he', label: 'Hebrew', nativeLabel: 'עברית', rtl: true },
    { code: 'fa', label: 'Persian', nativeLabel: 'فارسی', rtl: true },
    { code: 'ur', label: 'Urdu', nativeLabel: 'اردو', rtl: true },
];

/** Catalogue lookup by BCP-47 code. */
export function findSupportedLanguage(code: string): ILanguage | undefined {
    const normalized = code.trim().toLowerCase();
    return SUPPORTED_LANGUAGES.find((l) => l.code === normalized);
}

/**
 * A language code is a BCP-47 primary subtag, optionally with a region
 * (`en`, `hi`, `pt-br`). Kept deliberately loose — it only has to be a safe
 * URL segment and a valid `<html lang>` value.
 */
export const LANGUAGE_CODE_PATTERN = /^[a-z]{2,3}(-[a-z0-9]{2,8})?$/;

export function isValidLanguageCode(code: string): boolean {
    return LANGUAGE_CODE_PATTERN.test(code.trim().toLowerCase());
}
