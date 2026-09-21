/**
 * Tests for SiteIdentityService (docs/discoverability-spec.md, D1)
 */
import { TestBed } from '@angular/core/testing';
import { Firestore, getDoc } from '@angular/fire/firestore';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { SiteIdentityService } from './site-identity.service';
import { DEFAULT_ABOUT_SETTINGS } from '../../pages/admin/(settings)/about/about-settings.model';

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    doc: vi.fn(() => ({ path: 'Settings/about' })),
    getDoc: vi.fn(),
}));

function snapshot(data: unknown | null) {
    return { exists: () => data !== null, data: () => data };
}

describe('SiteIdentityService', () => {
    let service: SiteIdentityService;

    beforeEach(() => {
        vi.clearAllMocks();
        TestBed.configureTestingModule({
            providers: [SiteIdentityService, { provide: Firestore, useValue: {} }],
        });
        service = TestBed.inject(SiteIdentityService);
    });

    it('starts with the empty identity before loading', () => {
        expect(service.identity()).toEqual(DEFAULT_ABOUT_SETTINGS);
    });

    it('loads Settings/about, fills defaults and coerces bad values', async () => {
        vi.mocked(getDoc).mockResolvedValue(snapshot({
            name: 'Acme',
            finalUrl: 'https://acme.com',
            logoUrl: 'https://acme.com/logo.png',
            sameAs: 'oops',
            organizationType: 'Cooperative',
        }) as any);

        const identity = await service.load();

        expect(identity.name).toBe('Acme');
        expect(identity.logoUrl).toBe('https://acme.com/logo.png');
        expect(identity.sameAs).toEqual([]);
        expect(identity.organizationType).toBe('Organization');
        expect(identity.description).toBe('');
        expect(service.identity()).toEqual(identity);
    });

    it('reads once and shares the load between callers', async () => {
        vi.mocked(getDoc).mockResolvedValue(snapshot({ name: 'Acme' }) as any);
        await Promise.all([service.load(), service.load()]);
        await service.load();
        expect(getDoc).toHaveBeenCalledTimes(1);
    });

    it('falls back to defaults when the read fails', async () => {
        const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.mocked(getDoc).mockRejectedValue(new Error('denied'));
        const identity = await service.load();
        expect(identity).toEqual(DEFAULT_ABOUT_SETTINGS);
        expect(errorSpy).toHaveBeenCalled();
        errorSpy.mockRestore();
    });

    it('treats a missing document as the empty identity', async () => {
        vi.mocked(getDoc).mockResolvedValue(snapshot(null) as any);
        expect(await service.load()).toEqual(DEFAULT_ABOUT_SETTINGS);
    });
});
