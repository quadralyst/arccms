import { TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Firestore, docData } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { EmailSettingService } from './email-setting.service';
import { DEFAULT_EMAIL_SETTINGS, EMAIL_PROVIDERS } from './email-setting.model';
import { of } from 'rxjs';

vi.mock('@angular/fire/firestore', () => ({
    doc: vi.fn(),
    getDoc: vi.fn(),
    setDoc: vi.fn(),
    serverTimestamp: vi.fn(),
    collection: vi.fn(),
    addDoc: vi.fn(),
    docData: vi.fn(),
    Firestore: class {},
}));

describe('EmailSettingService', () => {
    let service: EmailSettingService;
    let mockFirestore: any;
    let mockFunctions: any;

    beforeEach(() => {
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
        it('should be defined', () => {
            expect(service.testEmailConnection).toBeDefined();
        });

        it('should return a Promise<void>', async () => {
            const result = service.testEmailConnection({});
            expect(result).toBeDefined();
            expect(typeof (result as any).then).toBe('function');
        });
    });

    describe('monitorConnectionTest', () => {
        it('should be defined', () => {
            expect(service.monitorConnectionTest).toBeDefined();
        });

        it('should return an Observable', () => {
            vi.mocked(docData).mockReturnValue(of({} as any));
            const result = service.monitorConnectionTest();
            expect(result).toBeDefined();
        });
    });
});
