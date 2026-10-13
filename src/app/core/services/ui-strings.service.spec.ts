/**
 * Tests for UiStringsService.
 */
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UiStringsService } from './ui-strings.service';
import { LocalizationService } from './localization.service';
import { setSiteManifestForTesting, siteManifest } from '../site/site';

describe('UiStringsService', () => {
    let service: UiStringsService;
    let get: ReturnType<typeof vi.fn>;

    let localization: { load: ReturnType<typeof vi.fn> };

    beforeEach(() => {
        setSiteManifestForTesting();
        get = vi.fn().mockReturnValue(of({ read_more: 'लेख पढ़ें' }));
        localization = { load: vi.fn().mockResolvedValue({ defaultLanguage: 'en' }) };
        TestBed.configureTestingModule({
            providers: [
                UiStringsService,
                { provide: HttpClient, useValue: { get } },
                { provide: LocalizationService, useValue: localization },
            ],
        });
        service = TestBed.inject(UiStringsService);
    });

    /** A site whose strings include its default language, English. */
    function withEnglishFile(): void {
        setSiteManifestForTesting({ ...siteManifest(), strings: [...siteManifest().strings, 'en'] });
    }

    it('starts empty, so the authored English stands', () => {
        expect(service.strings()).toEqual({});
        expect(service.translate('read_more', 'Read Article')).toBe('Read Article');
    });

    it('loads a language file and activates it', async () => {
        await service.use('hi');

        expect(get).toHaveBeenCalledWith('/_site/strings/hi.json');
        expect(service.translate('read_more', 'Read Article')).toBe('लेख पढ़ें');
    });

    it('requests nothing for a language the site has no strings for', async () => {
        await service.use('ta');

        expect(get).not.toHaveBeenCalled();
        expect(service.translate('read_more', 'Read Article')).toBe('Read Article');
    });

    it('falls back to the caller default for a missing key', async () => {
        await service.use('hi');

        expect(service.translate('unknown', 'English default')).toBe('English default');
    });

    it('treats a blank translation as untranslated', async () => {
        get.mockReturnValue(of({ read_more: '  ' }));
        await service.use('hi');

        expect(service.translate('read_more', 'Read Article')).toBe('Read Article');
    });

    it('loads a language for a part of the page without making it the page\'s language', async () => {
        expect(await service.load('hi')).toEqual({ read_more: 'लेख पढ़ें' });
        expect(service.activeLang()).toBe('');
        expect(service.strings()).toEqual({});

        // Cached: the page switching to it later needs no second request.
        await service.use('hi');
        expect(get).toHaveBeenCalledTimes(1);
        expect(await service.load('')).toEqual({});
    });

    it('clears strings for a default language without a file', async () => {
        await service.use('hi');
        await service.use('');

        expect(service.strings()).toEqual({});
        expect(service.translate('read_more', 'Read Article')).toBe('Read Article');
    });

    it('requests nothing for a default language the site has no strings for', async () => {
        await service.use('');
        expect(get).not.toHaveBeenCalled();
    });

    // specs/form-gamification-spec.md G-D4: the default language's file works like any other.
    it('loads the default language\'s own file when the site has one', async () => {
        withEnglishFile();
        get.mockReturnValue(of({ read_more: 'Keep reading' }));

        await service.use('');

        expect(get).toHaveBeenCalledWith('/_site/strings/en.json');
        expect(service.activeLang()).toBe('');
        expect(service.translate('read_more', 'Read Article')).toBe('Keep reading');
        expect(await service.load('')).toEqual({ read_more: 'Keep reading' });
        expect(get).toHaveBeenCalledTimes(1);
    });

    it('keeps the authored English when the settings cannot be read', async () => {
        withEnglishFile();
        localization.load.mockRejectedValue(new Error('offline'));

        await service.use('');

        expect(get).not.toHaveBeenCalled();
        expect(service.strings()).toEqual({});
    });

    it('keeps the language the page switched to last, whichever load finishes first', async () => {
        withEnglishFile();
        const pending = service.use('');
        await service.use('hi');
        await pending;

        expect(service.activeLang()).toBe('hi');
        expect(service.translate('read_more', 'Read Article')).toBe('लेख पढ़ें');
    });

    it('caches a language after the first load', async () => {
        await service.use('hi');
        await service.use('');
        await service.use('hi');

        expect(get).toHaveBeenCalledTimes(1);
    });

    it('shares one request between concurrent callers', async () => {
        await Promise.all([service.use('hi'), service.use('hi')]);

        expect(get).toHaveBeenCalledTimes(1);
    });

    it('falls back to English when the file is missing', async () => {
        get.mockReturnValue(throwError(() => new Error('404')));

        await service.use('hi');

        // A missing strings file is the designed fallback, not an error.
        expect(service.strings()).toEqual({});
        expect(service.translate('read_more', 'Read Article')).toBe('Read Article');
    });

    it('ignores a malformed file', async () => {
        get.mockReturnValue(of('not an object' as never));

        await service.use('hi');

        expect(service.translate('read_more', 'Read Article')).toBe('Read Article');
    });
});
