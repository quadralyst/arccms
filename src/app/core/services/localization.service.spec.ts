/**
 * Tests for LocalizationService
 */
import { TestBed } from '@angular/core/testing';
import { Firestore, getDoc, setDoc } from '@angular/fire/firestore';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { LOCALIZATION_CACHE_KEY, LocalizationService, readStoredLocalization } from './localization.service';
import { DEFAULT_LOCALIZATION_SETTINGS } from '../../../shared/models/localization.model';

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    doc: vi.fn(() => ({ path: 'Settings/localization' })),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
}));

const HINDI = { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' };
const ENGLISH = { code: 'en', label: 'English', nativeLabel: 'English' };

function snapshot(data: unknown | null) {
    return { exists: () => data !== null, data: () => data };
}

describe('LocalizationService', () => {
    let service: LocalizationService;

    beforeEach(() => {
        vi.clearAllMocks();
        localStorage.clear();
        TestBed.configureTestingModule({
            providers: [LocalizationService, { provide: Firestore, useValue: {} }],
        });
        service = TestBed.inject(LocalizationService);
    });

    it('starts with the single-language default before loading', () => {
        expect(service.settings()).toEqual(DEFAULT_LOCALIZATION_SETTINGS);
        expect(service.loaded()).toBe(false);
        expect(service.isMultilingual()).toBe(false);
    });

    it('loads and normalizes the settings document', async () => {
        vi.mocked(getDoc).mockResolvedValue(
            snapshot({ defaultLanguage: 'en', enabledLanguages: [ENGLISH, HINDI] }) as never,
        );

        const settings = await service.load();

        expect(settings.defaultLanguage).toBe('en');
        expect(service.enabledLanguages().map((l) => l.code)).toEqual(['en', 'hi']);
        expect(service.extraLanguages().map((l) => l.code)).toEqual(['hi']);
        expect(service.isMultilingual()).toBe(true);
        expect(service.loaded()).toBe(true);
    });

    it('falls back to defaults when the document is missing', async () => {
        vi.mocked(getDoc).mockResolvedValue(snapshot(null) as never);

        const settings = await service.load();

        expect(settings).toEqual(DEFAULT_LOCALIZATION_SETTINGS);
        expect(service.loaded()).toBe(true);
    });

    it('falls back to defaults when the read is denied', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        vi.mocked(getDoc).mockRejectedValue(new Error('permission-denied'));

        const settings = await service.load();

        expect(settings).toEqual(DEFAULT_LOCALIZATION_SETTINGS);
        expect(service.loaded()).toBe(true);
        consoleSpy.mockRestore();
    });

    it('caches the load and shares one read between concurrent callers', async () => {
        vi.mocked(getDoc).mockResolvedValue(
            snapshot({ defaultLanguage: 'en', enabledLanguages: [ENGLISH] }) as never,
        );

        const [a, b] = await Promise.all([service.load(), service.load()]);
        await service.load();

        expect(a).toEqual(b);
        expect(getDoc).toHaveBeenCalledTimes(1);
    });

    it('re-reads when forced', async () => {
        vi.mocked(getDoc).mockResolvedValue(
            snapshot({ defaultLanguage: 'en', enabledLanguages: [ENGLISH] }) as never,
        );
        await service.load();
        await service.load(true);

        expect(getDoc).toHaveBeenCalledTimes(2);
    });

    it('saves normalized settings and updates the signals', async () => {
        vi.mocked(setDoc).mockResolvedValue(undefined as never);

        await service.save({
            defaultLanguage: 'hi',
            enabledLanguages: [ENGLISH, HINDI],
        });

        const written = vi.mocked(setDoc).mock.calls[0][1] as { enabledLanguages: { code: string }[] };
        // Normalized on the way out: the default language is pinned first.
        expect(written.enabledLanguages.map((l) => l.code)).toEqual(['hi', 'en']);
        expect(service.defaultLanguage()).toBe('hi');
        expect(service.loaded()).toBe(true);
    });

    it('exposes lookup helpers over the loaded settings', async () => {
        vi.mocked(getDoc).mockResolvedValue(
            snapshot({ defaultLanguage: 'en', enabledLanguages: [ENGLISH, HINDI] }) as never,
        );
        await service.load();

        expect(service.isEnabled('hi')).toBe(true);
        expect(service.isEnabled('fr')).toBe(false);
        expect(service.find('hi')?.nativeLabel).toBe('हिन्दी');
        expect(service.pathPrefix('en')).toBe('');
        expect(service.pathPrefix('hi')).toBe('/hi');
    });
    describe("this browser's copy of the list", () => {
        it('knows nothing before the first read', () => {
            expect(service.known()).toBeNull();
        });

        it('keeps the list it read, so the next visit knows it without waiting', async () => {
            vi.mocked(getDoc).mockResolvedValue(
                snapshot({ defaultLanguage: 'en', enabledLanguages: [ENGLISH, HINDI] }) as never,
            );
            await service.load();
            expect(readStoredLocalization()?.enabledLanguages.map((l) => l.code)).toEqual(['en', 'hi']);

            // A new visit: a new service, not loaded yet.
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({ providers: [LocalizationService, { provide: Firestore, useValue: {} }] });
            const next = TestBed.inject(LocalizationService);
            expect(next.loaded()).toBe(false);
            expect(next.known()?.enabledLanguages.map((l) => l.code)).toEqual(['en', 'hi']);
        });

        it('keeps a single-language site too, when there is no settings document', async () => {
            vi.mocked(getDoc).mockResolvedValue(snapshot(null) as never);
            await service.load();
            expect(readStoredLocalization()).toEqual(DEFAULT_LOCALIZATION_SETTINGS);
        });

        it('falls back to the kept list when the read fails, and keeps it', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            localStorage.setItem(LOCALIZATION_CACHE_KEY, JSON.stringify({ defaultLanguage: 'en', enabledLanguages: [ENGLISH, HINDI] }));
            vi.mocked(getDoc).mockRejectedValue(new Error('unavailable'));

            const settings = await service.load();

            expect(settings.enabledLanguages.map((l) => l.code)).toEqual(['en', 'hi']);
            expect(readStoredLocalization()?.enabledLanguages).toHaveLength(2);
            consoleSpy.mockRestore();
        });

        it('keeps what an admin saves', async () => {
            vi.mocked(setDoc).mockResolvedValue(undefined as never);
            await service.save({ defaultLanguage: 'en', enabledLanguages: [ENGLISH, HINDI] });
            expect(readStoredLocalization()?.enabledLanguages.map((l) => l.code)).toEqual(['en', 'hi']);
        });

        it('ignores a kept copy it cannot read', () => {
            localStorage.setItem(LOCALIZATION_CACHE_KEY, '{not json');
            expect(service.known()).toBeNull();
        });
    });
});
