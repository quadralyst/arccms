import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Firestore } from '@angular/fire/firestore';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { EmailSettingService } from './email-setting.service';
import { DEFAULT_EMAIL_SETTINGS, EMAIL_PROVIDERS } from './email-setting.model';

vi.mock('@angular/fire/firestore', () => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    serverTimestamp: vi.fn(),
    Firestore: class {},
}));

vi.mock('@angular/fire/functions', () => ({
    httpsCallable: vi.fn(),
    Functions: class {},
}));

describe('EmailSettingService', () => {
    let service: EmailSettingService;
    let mockFirestore: any;
    let mockFunctions: any;

    beforeEach(() => {
        vi.clearAllMocks();
        mockFirestore = {};
        mockFunctions = {};

        TestBed.configureTestingModule({
            providers: [
                EmailSettingService,
                { provide: Firestore, useValue: mockFirestore },
                { provide: Functions, useValue: mockFunctions },
            ],
        });

        service = TestBed.inject(EmailSettingService);
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('DEFAULT_EMAIL_SETTINGS', () => {
        it('should have email disabled by default', () => {
            expect(DEFAULT_EMAIL_SETTINGS.isEnabled).toBe(false);
        });

        it('should have smtp as default provider', () => {
            expect(DEFAULT_EMAIL_SETTINGS.activeProvider).toBe('smtp');
        });

        it('should have correct SMTP defaults', () => {
            expect(DEFAULT_EMAIL_SETTINGS.smtp.port).toBe(587);
            expect(DEFAULT_EMAIL_SETTINGS.smtp.secure).toBe(false);
        });

        it('should have all provider configs initialized', () => {
            expect(DEFAULT_EMAIL_SETTINGS.smtp).toBeDefined();
            expect(DEFAULT_EMAIL_SETTINGS.resend).toBeDefined();
        });
    });

    describe('EMAIL_PROVIDERS', () => {
        it('should have four providers (incl. Debug Provider)', () => {
            expect(EMAIL_PROVIDERS.length).toBe(4);
        });

        it('should have correct provider IDs', () => {
            const ids = EMAIL_PROVIDERS.map(p => p.id);
            expect(ids).toContain('smtp');
            expect(ids).toContain('resend');
            expect(ids).toContain('gmail');
        });
    });
    describe('testEmailConnection', () => {
        const payload = {
            config: { ...DEFAULT_EMAIL_SETTINGS, smtp: { ...DEFAULT_EMAIL_SETTINGS.smtp, password: 'secret123' } },
            activeProvider: 'smtp' as const,
            testEmail: 'test@example.com',
            subject: 'Subject',
            message: 'Message',
        };

        it('should call the testSmtpConfigConnection callable', async () => {
            const callable = vi.fn().mockResolvedValue({ data: { success: true, message: 'ok' } });
            vi.mocked(httpsCallable).mockReturnValue(callable as any);

            await service.testEmailConnection(payload);

            expect(httpsCallable).toHaveBeenCalledWith(expect.anything(), 'testSmtpConfigConnection');
            expect(callable).toHaveBeenCalledWith(payload);
        });

        it('should return the callable result directly', async () => {
            const callable = vi.fn().mockResolvedValue({ data: { success: true, message: 'Connected' } });
            vi.mocked(httpsCallable).mockReturnValue(callable as any);

            const result = await service.testEmailConnection(payload);

            expect(result).toEqual({ success: true, message: 'Connected' });
        });

        it('should normalise a malformed response rather than returning undefined', async () => {
            const callable = vi.fn().mockResolvedValue({ data: undefined });
            vi.mocked(httpsCallable).mockReturnValue(callable as any);

            const result = await service.testEmailConnection(payload);

            expect(result).toEqual({ success: false, message: '' });
        });

        it('should propagate a rejection so the caller can surface it', async () => {
            const callable = vi.fn().mockRejectedValue(new Error('unauthenticated'));
            vi.mocked(httpsCallable).mockReturnValue(callable as any);

            await expect(service.testEmailConnection(payload)).rejects.toThrow('unauthenticated');
        });

        it('should never write credentials to Firestore', async () => {
            const { setDoc } = await import('@angular/fire/firestore');
            const callable = vi.fn().mockResolvedValue({ data: { success: true, message: 'ok' } });
            vi.mocked(httpsCallable).mockReturnValue(callable as any);

            await service.testEmailConnection(payload);

            // The whole point of the change: the payload goes in the request body,
            // not into Settings/emailTestingConnection.
            expect(setDoc).not.toHaveBeenCalled();
        });
    });

    describe('removed credential-persisting API', () => {
        it('no longer exposes the emailTestingConnection document helpers', () => {
            const surface = service as unknown as Record<string, unknown>;
            expect(surface['monitorConnectionTest']).toBeUndefined();
            expect(surface['saveEmailTestingConfig']).toBeUndefined();
            expect(surface['getEmailTestingConfig']).toBeUndefined();
        });
    });
});
