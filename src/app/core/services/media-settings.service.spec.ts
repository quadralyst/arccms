import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const mockGetDoc = vi.fn();
vi.mock('@angular/fire/firestore', async (importOriginal) => ({
    ...(await importOriginal<typeof import('@angular/fire/firestore')>()),
    doc: vi.fn(() => ({})),
    getDoc: (...args: unknown[]) => mockGetDoc(...args),
}));

import { MediaSettingsService } from './media-settings.service';
import { TemplateHydrationService } from './template-hydration.service';

describe('MediaSettingsService', () => {
    let service: MediaSettingsService;

    beforeEach(() => {
        mockGetDoc.mockReset();
        TestBed.configureTestingModule({ providers: [{ provide: Firestore, useValue: {} }] });
        service = TestBed.inject(MediaSettingsService);
    });

    afterEach(() => TemplateHydrationService.setMaxImageSize(undefined));

    it('reads the image maximum once and hands it to template hydration', async () => {
        mockGetDoc.mockResolvedValue({ exists: () => true, data: () => ({ mediaMaxSize: 1600 }) });
        const setMax = vi.spyOn(TemplateHydrationService, 'setMaxImageSize');
        await Promise.all([service.load(), service.load()]);
        expect(mockGetDoc).toHaveBeenCalledTimes(1);
        expect(service.maxSize()).toBe(1600);
        expect(setMax).toHaveBeenCalledWith(1600);
    });

    it('keeps the default when Settings has no maximum or cannot be read', async () => {
        mockGetDoc.mockRejectedValue(new Error('offline'));
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        expect(await service.load()).toBe(1200);
        expect(service.maxSize()).toBe(1200);
    });
});
