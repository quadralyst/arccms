/**
 * Tests for UiStringsService.
 */
import { TestBed } from '@angular/core/testing';
import { HttpClient } from '@angular/common/http';
import { of, throwError } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { UiStringsService } from './ui-strings.service';

describe('UiStringsService', () => {
    let service: UiStringsService;
    let get: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        get = vi.fn().mockReturnValue(of({ read_more: 'लेख पढ़ें' }));
        TestBed.configureTestingModule({
            providers: [UiStringsService, { provide: HttpClient, useValue: { get } }],
        });
        service = TestBed.inject(UiStringsService);
    });

    it('starts empty, so the authored English stands', () => {
        expect(service.strings()).toEqual({});
        expect(service.translate('read_more', 'Read Article')).toBe('Read Article');
    });

    it('loads a language file and activates it', async () => {
        await service.use('hi');

        expect(get).toHaveBeenCalledWith('/i18n/hi/strings.json');
        expect(service.translate('read_more', 'Read Article')).toBe('लेख पढ़ें');
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

    it('clears strings for the default language', async () => {
        await service.use('hi');
        await service.use('');

        expect(service.strings()).toEqual({});
        expect(service.translate('read_more', 'Read Article')).toBe('Read Article');
    });

    it('does not request the default language', async () => {
        await service.use('');
        expect(get).not.toHaveBeenCalled();
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
