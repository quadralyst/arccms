import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { OnboardingSetupService } from './onboarding-setup.service';

// Mock firebase/firestore functions
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockGetDoc = vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined });
const mockDoc = vi.fn().mockReturnValue({ id: 'mock-doc-id' });
const mockCollection = vi.fn().mockReturnValue('mock-collection-ref');
const mockServerTimestamp = vi.fn().mockReturnValue('server-timestamp');

vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual('@angular/fire/firestore');
    return {
        ...actual,
        doc: (...args: any[]) => mockDoc(...args),
        collection: (...args: any[]) => mockCollection(...args),
        setDoc: (...args: any[]) => mockSetDoc(...args),
        getDoc: (...args: any[]) => mockGetDoc(...args),
        serverTimestamp: () => mockServerTimestamp(),
    };
});

describe('OnboardingSetupService', () => {
    let service: OnboardingSetupService;
    const mockFirestore = {};

    beforeEach(() => {
        vi.clearAllMocks();

        TestBed.configureTestingModule({
            providers: [
                OnboardingSetupService,
                { provide: Firestore, useValue: mockFirestore },
            ],
        });

        service = TestBed.inject(OnboardingSetupService);
    });

    describe('saveSiteInfo', () => {
        it('should write Settings/about and Settings/site', async () => {
            await service.saveSiteInfo('My Site', 'https://mysite.com');

            // Should call setDoc at least twice (about + site)
            expect(mockSetDoc).toHaveBeenCalledTimes(2);

            // Verify Settings/about
            const aboutCall = mockSetDoc.mock.calls[0];
            expect(aboutCall[1]).toEqual(expect.objectContaining({
                name: 'My Site',
                finalUrl: 'https://mysite.com',
                address: '',
            }));

            // Verify Settings/site
            const siteCall = mockSetDoc.mock.calls[1];
            expect(siteCall[1]).toEqual(expect.objectContaining({
                siteName: 'My Site',
                baseUrl: 'https://mysite.com',
            }));
        });

        it('should pass merge: true to setDoc', async () => {
            await service.saveSiteInfo('My Site', 'https://mysite.com');

            // Both calls should include { merge: true }
            expect(mockSetDoc.mock.calls[0][2]).toEqual({ merge: true });
            expect(mockSetDoc.mock.calls[1][2]).toEqual({ merge: true });
        });

        it('should write Settings/integrations when unsplash key provided', async () => {
            await service.saveSiteInfo('My Site', 'https://mysite.com', 'my-unsplash-key');

            // about + site + integrations = 3 calls
            expect(mockSetDoc).toHaveBeenCalledTimes(3);

            const integrationsCall = mockSetDoc.mock.calls[2];
            expect(integrationsCall[1]).toEqual(expect.objectContaining({
                unsplash: { accessKey: 'my-unsplash-key', secretKey: '' },
            }));
        });

        it('should not write integrations when unsplash key not provided', async () => {
            await service.saveSiteInfo('My Site', 'https://mysite.com');
            expect(mockSetDoc).toHaveBeenCalledTimes(2);
        });

        it('should propagate Firestore errors', async () => {
            mockSetDoc.mockRejectedValueOnce(new Error('Firestore write failed'));
            await expect(service.saveSiteInfo('My Site', 'https://mysite.com')).rejects.toThrow('Firestore write failed');
        });
    });

    describe('saveDefaultSettings', () => {
        it('should write Settings/users, Settings/misc, and Settings/integrations', async () => {
            await service.saveDefaultSettings();

            expect(mockSetDoc).toHaveBeenCalledTimes(3);

            const usersCall = mockSetDoc.mock.calls[0];
            expect(usersCall[1]).toEqual(expect.objectContaining({
                isSignupEnabled: true,
                defaultRole: 'user',
            }));

            const miscCall = mockSetDoc.mock.calls[1];
            expect(miscCall[1]).toEqual(expect.objectContaining({
                showPoweredBy: true,
            }));

            const integrationsCall = mockSetDoc.mock.calls[2];
            expect(integrationsCall[1]).toEqual(expect.objectContaining({
                geo: { geoEnabled: true, geoApiProvider: 'ipapi', geoApiKey: '', geoApiEndpoint: '' },
            }));
        });

        it('should use serverTimestamp for users doc', async () => {
            await service.saveDefaultSettings();

            const usersData = mockSetDoc.mock.calls[0][1];
            expect(usersData.createdAt).toBe('server-timestamp');
            expect(usersData.updatedAt).toBe('server-timestamp');
        });

        it('should propagate Firestore errors', async () => {
            mockSetDoc.mockRejectedValueOnce(new Error('fail'));
            await expect(service.saveDefaultSettings()).rejects.toThrow('fail');
        });
    });

    describe('saveEmailConfig', () => {
        it('should write Settings/email and Settings/email_status with isEnabled true', async () => {
            const settings: any = {
                isEnabled: true,
                activeProvider: 'gmail',
                senderEmail: 'test@gmail.com',
                senderName: 'Test',
                gmail: { user: 'test@gmail.com', password: 'pass' },
                smtp: { host: '', port: 587, secure: false, user: '', password: '' },
                resend: { apiKey: '' },
            };

            await service.saveEmailConfig(settings);

            expect(mockSetDoc).toHaveBeenCalledTimes(2);

            const emailCall = mockSetDoc.mock.calls[0];
            expect(emailCall[1]).toEqual(expect.objectContaining({
                isEnabled: true,
                activeProvider: 'gmail',
                senderEmail: 'test@gmail.com',
            }));

            const statusCall = mockSetDoc.mock.calls[1];
            expect(statusCall[1]).toEqual({ isEnabled: true, requireSignupVerification: false });
        });

        it('should use serverTimestamp for email doc', async () => {
            const settings: any = {
                isEnabled: true,
                activeProvider: 'gmail',
                senderEmail: 'test@gmail.com',
            };
            await service.saveEmailConfig(settings);

            const emailData = mockSetDoc.mock.calls[0][1];
            expect(emailData.createdAt).toBe('server-timestamp');
            expect(emailData.updatedAt).toBe('server-timestamp');
        });

        it('should propagate Firestore errors', async () => {
            mockSetDoc.mockRejectedValueOnce(new Error('fail'));
            await expect(service.saveEmailConfig({ isEnabled: true } as any)).rejects.toThrow('fail');
        });

        // E6: onboarding must apply the same "no enable without a valid provider"
        // coercion the Email Settings page uses.
        describe('E6 valid-provider guard', () => {
            it('enables email when the chosen provider config is valid (gmail)', async () => {
                await service.saveEmailConfig({
                    activeProvider: 'gmail',
                    gmail: { user: 'a@gmail.com', password: 'app-pass' },
                } as any);

                expect(mockSetDoc.mock.calls[0][1]).toEqual(expect.objectContaining({ isEnabled: true }));
                expect(mockSetDoc.mock.calls[1][1]).toEqual({ isEnabled: true, requireSignupVerification: false });
            });

            it('enables email for a valid smtp config', async () => {
                await service.saveEmailConfig({
                    activeProvider: 'smtp',
                    smtp: { host: 'smtp.x.com', port: 587, secure: false, user: 'u', password: 'p' },
                } as any);
                expect(mockSetDoc.mock.calls[1][1]).toEqual({ isEnabled: true, requireSignupVerification: false });
            });

            it('enables email for a valid resend config', async () => {
                await service.saveEmailConfig({
                    activeProvider: 'resend',
                    resend: { apiKey: 're_123' },
                } as any);
                expect(mockSetDoc.mock.calls[1][1]).toEqual({ isEnabled: true, requireSignupVerification: false });
            });

            it('keeps email DISABLED when the provider config is incomplete', async () => {
                await service.saveEmailConfig({
                    activeProvider: 'gmail',
                    gmail: { user: 'a@gmail.com', password: '' }, // missing password
                } as any);

                expect(mockSetDoc.mock.calls[0][1]).toEqual(expect.objectContaining({ isEnabled: false }));
                expect(mockSetDoc.mock.calls[1][1]).toEqual({ isEnabled: false, requireSignupVerification: false });
            });

            it('keeps email DISABLED when no provider is selected', async () => {
                await service.saveEmailConfig({ senderEmail: 'x@y.com' } as any);
                expect(mockSetDoc.mock.calls[1][1]).toEqual({ isEnabled: false, requireSignupVerification: false });
            });
        });
    });

    describe('saveEmailSkipped', () => {
        it('should write Settings/email with isEnabled false', async () => {
            await service.saveEmailSkipped();

            expect(mockSetDoc).toHaveBeenCalledTimes(2);

            const emailCall = mockSetDoc.mock.calls[0];
            expect(emailCall[1]).toEqual(expect.objectContaining({
                isEnabled: false,
            }));

            const statusCall = mockSetDoc.mock.calls[1];
            expect(statusCall[1]).toEqual({ isEnabled: false, requireSignupVerification: false });
        });

        it('should propagate Firestore errors', async () => {
            mockSetDoc.mockRejectedValueOnce(new Error('fail'));
            await expect(service.saveEmailSkipped()).rejects.toThrow('fail');
        });
    });

    describe('createDefaultContentTypes', () => {
        it('should create 3 content type documents', async () => {
            await service.createDefaultContentTypes();

            // 3 content types
            expect(mockSetDoc).toHaveBeenCalledTimes(3);

            // Verify each has required fields
            for (const call of mockSetDoc.mock.calls) {
                const data = call[1];
                expect(data).toHaveProperty('name');
                expect(data).toHaveProperty('slug');
                expect(data).toHaveProperty('fields');
                expect(data).toHaveProperty('createdBy', 'system');
            }
        });

        it('should create Articles, User Manuals, and Release Notes', async () => {
            await service.createDefaultContentTypes();

            const slugs = mockSetDoc.mock.calls.map((call: any) => call[1].slug);
            expect(slugs).toEqual(['articles', 'user-manuals', 'release-notes']);
        });

        it('should use serverTimestamp for content type timestamps', async () => {
            await service.createDefaultContentTypes();

            for (const call of mockSetDoc.mock.calls) {
                const data = call[1];
                expect(data.createdAt).toBe('server-timestamp');
                expect(data.modifiedAt).toBe('server-timestamp');
            }
        });

        it('should propagate Firestore errors mid-loop', async () => {
            // First call succeeds, second fails
            mockSetDoc
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('write failed'));

            await expect(service.createDefaultContentTypes()).rejects.toThrow('write failed');
            // Only 2 calls made (first succeeded, second threw)
            expect(mockSetDoc).toHaveBeenCalledTimes(2);
        });
    });

    describe('createDefaultWaitlist', () => {
        it('should create Waitlists/default document', async () => {
            await service.createDefaultWaitlist();

            expect(mockSetDoc).toHaveBeenCalledTimes(1);

            const data = mockSetDoc.mock.calls[0][1];
            expect(data).toEqual(expect.objectContaining({
                slug: 'default',
                name: 'Waitlist',
                isActive: true,
                otpEnabled: true,
            }));
        });

        it('should use serverTimestamp for waitlist timestamps', async () => {
            await service.createDefaultWaitlist();

            const data = mockSetDoc.mock.calls[0][1];
            expect(data.createdAt).toBe('server-timestamp');
            expect(data.updatedAt).toBe('server-timestamp');
        });

        it('should propagate Firestore errors', async () => {
            mockSetDoc.mockRejectedValueOnce(new Error('fail'));
            await expect(service.createDefaultWaitlist()).rejects.toThrow('fail');
        });
    });

    describe('completeSetup', () => {
        it('should create content types, waitlist, and mark onboarding complete', async () => {
            await service.completeSetup();

            // 3 content types + 1 waitlist + 1 onboarding_status = 5
            expect(mockSetDoc).toHaveBeenCalledTimes(5);
        });

        it('should not create waitlist if content types fail', async () => {
            mockSetDoc.mockRejectedValueOnce(new Error('content type failed'));

            await expect(service.completeSetup()).rejects.toThrow('content type failed');
            // Only 1 call was attempted before it threw
            expect(mockSetDoc).toHaveBeenCalledTimes(1);
        });

        it('should propagate waitlist creation error', async () => {
            // 3 content types succeed, waitlist fails
            mockSetDoc
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(undefined)
                .mockResolvedValueOnce(undefined)
                .mockRejectedValueOnce(new Error('waitlist failed'));

            await expect(service.completeSetup()).rejects.toThrow('waitlist failed');
            expect(mockSetDoc).toHaveBeenCalledTimes(4);
        });
    });

    describe('markOnboardingStarted', () => {
        it('should write Settings/onboarding_status with completed: false', async () => {
            await service.markOnboardingStarted();

            expect(mockSetDoc).toHaveBeenCalledTimes(1);
            const data = mockSetDoc.mock.calls[0][1];
            expect(data).toEqual({
                completed: false,
                startedAt: 'server-timestamp',
            });
        });

        it('should propagate Firestore errors', async () => {
            mockSetDoc.mockRejectedValueOnce(new Error('fail'));
            await expect(service.markOnboardingStarted()).rejects.toThrow('fail');
        });
    });

    describe('markOnboardingComplete', () => {
        it('should write Settings/onboarding_status with completed: true and merge', async () => {
            await service.markOnboardingComplete();

            expect(mockSetDoc).toHaveBeenCalledTimes(1);
            const data = mockSetDoc.mock.calls[0][1];
            expect(data).toEqual({
                completed: true,
                completedAt: 'server-timestamp',
            });
            expect(mockSetDoc.mock.calls[0][2]).toEqual({ merge: true });
        });

        it('should propagate Firestore errors', async () => {
            mockSetDoc.mockRejectedValueOnce(new Error('fail'));
            await expect(service.markOnboardingComplete()).rejects.toThrow('fail');
        });
    });

    describe('isOnboardingComplete', () => {
        it('should return true when document does not exist (legacy install)', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
            const result = await new Promise<boolean>((resolve) => {
                service.isOnboardingComplete().subscribe(resolve);
            });
            expect(result).toBe(true);
        });

        it('should return true when document exists with completed: true', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ completed: true }) });
            const result = await new Promise<boolean>((resolve) => {
                service.isOnboardingComplete().subscribe(resolve);
            });
            expect(result).toBe(true);
        });

        it('should return false when document exists with completed: false', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ completed: false }) });
            const result = await new Promise<boolean>((resolve) => {
                service.isOnboardingComplete().subscribe(resolve);
            });
            expect(result).toBe(false);
        });

        it('should return true on Firestore read error (fail-open)', async () => {
            mockGetDoc.mockRejectedValueOnce(new Error('permission denied'));
            const result = await new Promise<boolean>((resolve) => {
                service.isOnboardingComplete().subscribe(resolve);
            });
            expect(result).toBe(true);
        });
    });
});
