import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Firestore } from '@angular/fire/firestore';
import { IntegrationsSettingService } from './integrations-setting.service';
import { DEFAULT_INTEGRATIONS_SETTINGS } from './integrations-setting.model';
import { firstValueFrom } from 'rxjs';

// Mock Firestore module
const mockGetDoc = vi.fn();
const mockSetDoc = vi.fn();
const mockDoc = vi.fn(() => ({}));
const mockServerTimestamp = vi.fn(() => 'MOCK_TIMESTAMP');

vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    doc: (...args: any[]) => mockDoc(...args),
    getDoc: (...args: any[]) => mockGetDoc(...args),
    setDoc: (...args: any[]) => mockSetDoc(...args),
    serverTimestamp: () => mockServerTimestamp(),
}));

describe('IntegrationsSettingService', () => {
    let service: IntegrationsSettingService;

    beforeEach(() => {
        vi.clearAllMocks();

        TestBed.configureTestingModule({
            providers: [
                IntegrationsSettingService,
                { provide: Firestore, useValue: {} },
            ],
        });

        service = TestBed.inject(IntegrationsSettingService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('getIntegrationsSettings', () => {
        it('should return default settings when document does not exist', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => false });

            const settings = await firstValueFrom(service.getIntegrationsSettings());
            expect(settings).toEqual(DEFAULT_INTEGRATIONS_SETTINGS);
        });

        it('should return settings from Firestore when document exists', async () => {
            const firestoreData = {
                unsplash: { accessKey: 'test-key', secretKey: 'test-secret' },
            };
            mockGetDoc.mockResolvedValueOnce({
                exists: () => true,
                id: 'integrations',
                data: () => firestoreData,
            });

            const settings = await firstValueFrom(service.getIntegrationsSettings());
            expect(settings.unsplash.accessKey).toBe('test-key');
            expect(settings.unsplash.secretKey).toBe('test-secret');
            expect(settings.id).toBe('integrations');
        });

        it('should return defaults on Firestore error', async () => {
            mockGetDoc.mockRejectedValueOnce(new Error('Firestore unavailable'));

            const settings = await firstValueFrom(service.getIntegrationsSettings());
            expect(settings).toEqual(DEFAULT_INTEGRATIONS_SETTINGS);
        });
    });

    describe('saveIntegrationsSettings', () => {
        it('should call setDoc with merge: true', async () => {
            // Simulate existing document
            mockGetDoc.mockResolvedValueOnce({ exists: () => true });
            mockSetDoc.mockResolvedValueOnce(undefined);

            await service.saveIntegrationsSettings({
                unsplash: { accessKey: 'key', secretKey: 'secret' },
            });

            expect(mockSetDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    unsplash: { accessKey: 'key', secretKey: 'secret' },
                    updatedAt: 'MOCK_TIMESTAMP',
                }),
                { merge: true }
            );
        });

        it('should add createdAt when document does not exist yet', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => false });
            mockSetDoc.mockResolvedValueOnce(undefined);

            await service.saveIntegrationsSettings({
                unsplash: { accessKey: 'key', secretKey: 'secret' },
            });

            expect(mockSetDoc).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    createdAt: 'MOCK_TIMESTAMP',
                    updatedAt: 'MOCK_TIMESTAMP',
                }),
                { merge: true }
            );
        });

        it('should not include the id field in the saved data', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => true });
            mockSetDoc.mockResolvedValueOnce(undefined);

            await service.saveIntegrationsSettings({
                id: 'integrations',
                unsplash: { accessKey: 'key', secretKey: 'secret' },
            });

            const savedData = mockSetDoc.mock.calls[0][1];
            expect(savedData.id).toBeUndefined();
        });
    });
});
