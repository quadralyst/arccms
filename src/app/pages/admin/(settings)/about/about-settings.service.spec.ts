/**
 * Tests for AboutSettingsService
 */
import { TestBed } from '@angular/core/testing';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AboutSettingsService } from './about-settings.service';
import { Firestore } from '@angular/fire/firestore';
import { DEFAULT_ABOUT_SETTINGS } from './about-settings.model';

// Mock @angular/fire/firestore functions
vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual<any>('@angular/fire/firestore');
    return {
        ...actual,
        doc: vi.fn(),
        getDoc: vi.fn(),
        setDoc: vi.fn(),
    };
});

import { doc, getDoc, setDoc } from '@angular/fire/firestore';

describe('AboutSettingsService', () => {
    let service: AboutSettingsService;
    let firestoreMock: any;

    beforeEach(() => {
        firestoreMock = {};

        TestBed.configureTestingModule({
            providers: [
                AboutSettingsService,
                { provide: Firestore, useValue: firestoreMock },
            ],
        });

        service = TestBed.inject(AboutSettingsService);
        vi.clearAllMocks();
    });

    describe('load', () => {
        it('should return data from Firestore when document exists', async () => {
            const mockData = {
                name: 'My Site',
                finalUrl: 'https://example.com',
                address: '123 Main St',
            };
            vi.mocked(doc).mockReturnValue('docRef' as any);
            vi.mocked(getDoc).mockResolvedValue({
                exists: () => true,
                data: () => mockData,
            } as any);

            const result = await service.load();

            expect(doc).toHaveBeenCalledWith(firestoreMock, 'Settings', 'about');
            expect(result).toEqual(mockData);
        });

        it('should return defaults when document does not exist', async () => {
            vi.mocked(doc).mockReturnValue('docRef' as any);
            vi.mocked(getDoc).mockResolvedValue({
                exists: () => false,
                data: () => undefined,
            } as any);

            const result = await service.load();

            expect(result).toEqual(DEFAULT_ABOUT_SETTINGS);
        });

        it('should merge defaults with partial document data', async () => {
            vi.mocked(doc).mockReturnValue('docRef' as any);
            vi.mocked(getDoc).mockResolvedValue({
                exists: () => true,
                data: () => ({ name: 'Partial' }),
            } as any);

            const result = await service.load();

            expect(result.name).toBe('Partial');
            expect(result.finalUrl).toBe('');
            expect(result.address).toBe('');
        });
    });

    describe('save', () => {
        it('should write settings to Firestore with merge', async () => {
            vi.mocked(doc).mockReturnValue('docRef' as any);
            vi.mocked(setDoc).mockResolvedValue(undefined);

            const settings = {
                name: 'My Site',
                finalUrl: 'https://example.com',
                address: '123 Main St',
            };

            await service.save(settings);

            expect(doc).toHaveBeenCalledWith(firestoreMock, 'Settings', 'about');
            expect(setDoc).toHaveBeenCalledWith('docRef', settings, { merge: true });
        });
    });
});
