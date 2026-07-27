/**
 * Tests for the localization model helpers.
 *
 * These invariants are what the publish pipeline and the editor rely on, so
 * they are tested against deliberately malformed documents.
 */
import { describe, it, expect } from 'vitest';
import {
    DEFAULT_LOCALIZATION_SETTINGS,
    ENGLISH,
    extraLanguages,
    findLanguage,
    isLanguageEnabled,
    isMultilingual,
    languagePathPrefix,
    normalizeLocalizationSettings,
} from './localization.model';

const HINDI = { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' };

describe('normalizeLocalizationSettings', () => {
    it('returns the English default for null/undefined/empty input', () => {
        for (const input of [null, undefined, {}]) {
            expect(normalizeLocalizationSettings(input)).toEqual(DEFAULT_LOCALIZATION_SETTINGS);
        }
    });

    it('keeps a well-formed document intact', () => {
        const settings = normalizeLocalizationSettings({
            defaultLanguage: 'en',
            enabledLanguages: [ENGLISH, HINDI],
        });
        expect(settings.defaultLanguage).toBe('en');
        expect(settings.enabledLanguages.map((l) => l.code)).toEqual(['en', 'hi']);
    });

    it('always lists the default language first', () => {
        const settings = normalizeLocalizationSettings({
            defaultLanguage: 'hi',
            enabledLanguages: [ENGLISH, HINDI],
        });
        expect(settings.enabledLanguages.map((l) => l.code)).toEqual(['hi', 'en']);
    });

    it('adds the default language when it is missing from the list', () => {
        const settings = normalizeLocalizationSettings({
            defaultLanguage: 'fr',
            enabledLanguages: [HINDI],
        });
        expect(settings.defaultLanguage).toBe('fr');
        expect(settings.enabledLanguages.map((l) => l.code)).toEqual(['fr', 'hi']);
    });

    it('falls back to the first enabled language when the default is blank', () => {
        const settings = normalizeLocalizationSettings({ enabledLanguages: [HINDI, ENGLISH] });
        expect(settings.defaultLanguage).toBe('hi');
    });

    it('lower-cases and trims codes', () => {
        const settings = normalizeLocalizationSettings({
            defaultLanguage: ' EN ',
            enabledLanguages: [{ code: ' EN ', label: 'English', nativeLabel: 'English' }],
        });
        expect(settings.defaultLanguage).toBe('en');
        expect(settings.enabledLanguages[0].code).toBe('en');
    });

    it('drops duplicates and entries without a code', () => {
        const settings = normalizeLocalizationSettings({
            defaultLanguage: 'en',
            enabledLanguages: [ENGLISH, { ...ENGLISH }, HINDI, { code: '', label: 'Broken' }],
        });
        expect(settings.enabledLanguages.map((l) => l.code)).toEqual(['en', 'hi']);
    });

    it('falls back to the code when labels are missing', () => {
        const settings = normalizeLocalizationSettings({
            defaultLanguage: 'en',
            enabledLanguages: [ENGLISH, { code: 'sw' }],
        });
        const swahili = settings.enabledLanguages.find((l) => l.code === 'sw');
        expect(swahili).toEqual({ code: 'sw', label: 'sw', nativeLabel: 'sw' });
    });

    it('preserves the rtl flag only when set', () => {
        const settings = normalizeLocalizationSettings({
            defaultLanguage: 'en',
            enabledLanguages: [ENGLISH, { code: 'ar', label: 'Arabic', nativeLabel: 'العربية', rtl: true }],
        });
        expect(settings.enabledLanguages[1].rtl).toBe(true);
        expect(settings.enabledLanguages[0].rtl).toBeUndefined();
    });

    it('tolerates a non-array enabledLanguages', () => {
        const settings = normalizeLocalizationSettings({
            defaultLanguage: 'en',
            enabledLanguages: 'not-an-array',
        });
        expect(settings).toEqual(DEFAULT_LOCALIZATION_SETTINGS);
    });
});

describe('helpers', () => {
    const settings = normalizeLocalizationSettings({
        defaultLanguage: 'en',
        enabledLanguages: [ENGLISH, HINDI],
    });

    it('extraLanguages excludes the default', () => {
        expect(extraLanguages(settings).map((l) => l.code)).toEqual(['hi']);
        expect(extraLanguages(DEFAULT_LOCALIZATION_SETTINGS)).toEqual([]);
    });

    it('isLanguageEnabled / findLanguage', () => {
        expect(isLanguageEnabled(settings, 'hi')).toBe(true);
        expect(isLanguageEnabled(settings, 'fr')).toBe(false);
        expect(findLanguage(settings, 'hi')?.nativeLabel).toBe('हिन्दी');
        expect(findLanguage(settings, 'fr')).toBeUndefined();
    });

    it('isMultilingual', () => {
        expect(isMultilingual(settings)).toBe(true);
        expect(isMultilingual(DEFAULT_LOCALIZATION_SETTINGS)).toBe(false);
    });

    it('languagePathPrefix leaves the default language at the root', () => {
        expect(languagePathPrefix(settings, 'en')).toBe('');
        expect(languagePathPrefix(settings, 'hi')).toBe('/hi');
        expect(languagePathPrefix(settings, '')).toBe('');
    });
});
