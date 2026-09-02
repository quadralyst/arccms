import { TestBed } from '@angular/core/testing';
import { Firestore } from '@angular/fire/firestore';
import { Observable, of } from 'rxjs';
import { AuthService } from '../(auth)/auth.service';
import { OnboardingSetupService } from './onboarding-setup.service';

// Mock firebase/firestore functions
const mockSetDoc = vi.fn().mockResolvedValue(undefined);
const mockGetDoc = vi.fn().mockResolvedValue({ exists: () => false, data: () => undefined });
// Empty by default: nothing has been seeded, so createDefaultContentTypes writes.
const mockGetDocs = vi.fn().mockResolvedValue({ empty: true });
// `doc()` is called both as doc(firestore, 'Settings', 'about') and as
// doc(colRef, slug); echo back whichever trailing segment was given so tests can
// assert that content types are keyed by slug.
const mockDoc = vi.fn((...args: any[]) =>
    ({ id: args.length > 2 ? args[2] : args.length > 1 ? args[1] : 'mock-doc-id' }));
const mockCollection = vi.fn().mockReturnValue('mock-collection-ref');
const mockQuery = vi.fn().mockReturnValue('mock-query');
const mockWhere = vi.fn().mockReturnValue('mock-where');
const mockServerTimestamp = vi.fn().mockReturnValue('server-timestamp');

vi.mock('@angular/fire/firestore', async () => {
    const actual = await vi.importActual('@angular/fire/firestore');
    return {
        ...actual,
        doc: (...args: any[]) => mockDoc(...args),
        collection: (...args: any[]) => mockCollection(...args),
        setDoc: (...args: any[]) => mockSetDoc(...args),
        getDoc: (...args: any[]) => mockGetDoc(...args),
        getDocs: (...args: any[]) => mockGetDocs(...args),
        query: (...args: any[]) => mockQuery(...args),
        where: (...args: any[]) => mockWhere(...args),
        serverTimestamp: () => mockServerTimestamp(),
    };
});

describe('OnboardingSetupService', () => {
    let service: OnboardingSetupService;
    const mockFirestore = {};
    const mockAuthService = { isFirstRun: vi.fn().mockReturnValue(of(false)) };

    beforeEach(() => {
        vi.clearAllMocks();
        mockGetDocs.mockResolvedValue({ empty: true });
        mockAuthService.isFirstRun.mockReturnValue(of(false));

        TestBed.configureTestingModule({
            providers: [
                OnboardingSetupService,
                { provide: Firestore, useValue: mockFirestore },
                { provide: AuthService, useValue: mockAuthService },
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
            expect(statusCall[1]).toEqual({ isEnabled: true, requireSignupVerification: false, debugMode: false });
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
                expect(mockSetDoc.mock.calls[1][1]).toEqual({ isEnabled: true, requireSignupVerification: false, debugMode: false });
            });

            it('enables email for a valid smtp config', async () => {
                await service.saveEmailConfig({
                    activeProvider: 'smtp',
                    smtp: { host: 'smtp.x.com', port: 587, secure: false, user: 'u', password: 'p' },
                } as any);
                expect(mockSetDoc.mock.calls[1][1]).toEqual({ isEnabled: true, requireSignupVerification: false, debugMode: false });
            });

            it('enables email for a valid resend config', async () => {
                await service.saveEmailConfig({
                    activeProvider: 'resend',
                    resend: { apiKey: 're_123' },
                } as any);
                expect(mockSetDoc.mock.calls[1][1]).toEqual({ isEnabled: true, requireSignupVerification: false, debugMode: false });
            });

            it('keeps email DISABLED when the provider config is incomplete', async () => {
                await service.saveEmailConfig({
                    activeProvider: 'gmail',
                    gmail: { user: 'a@gmail.com', password: '' }, // missing password
                } as any);

                expect(mockSetDoc.mock.calls[0][1]).toEqual(expect.objectContaining({ isEnabled: false }));
                expect(mockSetDoc.mock.calls[1][1]).toEqual({ isEnabled: false, requireSignupVerification: false, debugMode: false });
            });

            it('keeps email DISABLED when no provider is selected', async () => {
                await service.saveEmailConfig({ senderEmail: 'x@y.com' } as any);
                expect(mockSetDoc.mock.calls[1][1]).toEqual({ isEnabled: false, requireSignupVerification: false, debugMode: false });
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
            expect(statusCall[1]).toEqual({ isEnabled: false, requireSignupVerification: false, debugMode: false });
        });

        it('should propagate Firestore errors', async () => {
            mockSetDoc.mockRejectedValueOnce(new Error('fail'));
            await expect(service.saveEmailSkipped()).rejects.toThrow('fail');
        });
    });

    describe('createDefaultContentTypes', () => {
        it('should create Articles and nothing else', async () => {
            await service.createDefaultContentTypes();

            expect(mockSetDoc).toHaveBeenCalledTimes(1);

            const data = mockSetDoc.mock.calls[0][1];
            expect(data).toHaveProperty('slug', 'articles');
            expect(data).toHaveProperty('name', 'Articles');
            expect(data).toHaveProperty('fields');
            expect(data).toHaveProperty('createdBy', 'system');
        });

        it('should key the document by slug so a re-run cannot duplicate it', async () => {
            await service.createDefaultContentTypes();

            // doc(colRef, 'articles') — not doc(colRef) with an auto-ID.
            expect(mockDoc).toHaveBeenCalledWith('mock-collection-ref', 'articles');
            expect(mockSetDoc.mock.calls[0][1].id).toBe('articles');
        });

        it('should skip a content type whose slug already exists', async () => {
            // The install already has an "articles" type — possibly an auto-ID one
            // seeded by an older build, which is exactly why the check is a query.
            mockGetDocs.mockResolvedValue({ empty: false });

            await service.createDefaultContentTypes();

            expect(mockWhere).toHaveBeenCalledWith('slug', '==', 'articles');
            expect(mockSetDoc).not.toHaveBeenCalled();
        });

        it('should be safe to call repeatedly (retry and re-entry)', async () => {
            await service.createDefaultContentTypes();
            expect(mockSetDoc).toHaveBeenCalledTimes(1);

            // Second pass: the type is there now, so nothing more is written.
            mockGetDocs.mockResolvedValue({ empty: false });
            await service.createDefaultContentTypes();
            expect(mockSetDoc).toHaveBeenCalledTimes(1);
        });

        it('should use serverTimestamp for content type timestamps', async () => {
            await service.createDefaultContentTypes();

            for (const call of mockSetDoc.mock.calls) {
                const data = call[1];
                expect(data.createdAt).toBe('server-timestamp');
                expect(data.modifiedAt).toBe('server-timestamp');
            }
        });

        it('should propagate Firestore errors', async () => {
            mockSetDoc.mockRejectedValueOnce(new Error('write failed'));

            await expect(service.createDefaultContentTypes()).rejects.toThrow('write failed');
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
            const result = await service.completeSetup();

            // 1 content type + 1 waitlist + 1 onboarding_status = 3
            expect(mockSetDoc).toHaveBeenCalledTimes(3);
            expect(result).toEqual({ waitlistCreated: true });
        });

        it('should not create waitlist if content types fail', async () => {
            mockSetDoc.mockRejectedValueOnce(new Error('content type failed'));

            await expect(service.completeSetup()).rejects.toThrow('content type failed');
            // Only 1 call was attempted before it threw
            expect(mockSetDoc).toHaveBeenCalledTimes(1);
        });

        it('should still mark onboarding complete when the waitlist write is denied', async () => {
            // The regression this guards: Waitlists is isAdmin()-gated, and a
            // denied create used to throw past markOnboardingComplete(), leaving
            // `completed: false` and trapping the admin in the wizard forever —
            // re-seeding content types on every lap.
            mockSetDoc
                .mockResolvedValueOnce(undefined)                                  // content type
                .mockRejectedValueOnce(new Error('permission-denied'))             // waitlist
                .mockResolvedValueOnce(undefined);                                 // onboarding_status

            const result = await service.completeSetup();

            expect(result).toEqual({ waitlistCreated: false });
            expect(mockSetDoc).toHaveBeenCalledTimes(3);

            const statusWrite = mockSetDoc.mock.calls[2][1];
            expect(statusWrite).toEqual({ completed: true, completedAt: 'server-timestamp' });
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

    describe('getOnboardingState', () => {
        const read = () => new Promise<string>((resolve) => {
            service.getOnboardingState().subscribe(resolve);
        });

        it('should be complete when the flag says completed: true', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ completed: true }) });
            expect(await read()).toBe('complete');
        });

        it('should be in-progress when the flag says completed: false', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ completed: false }) });
            expect(await read()).toBe('in-progress');
        });

        it('should trust the flag over isFirstRun', async () => {
            // The whole point of the change: email_lookup is filled by a Cloud
            // Function after the fact, so an undeployed trigger makes isFirstRun()
            // claim "first run" forever. A written flag outranks it.
            mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ completed: true }) });
            mockAuthService.isFirstRun.mockReturnValue(of(true));

            expect(await read()).toBe('complete');
            expect(mockAuthService.isFirstRun).not.toHaveBeenCalled();
        });

        it('should fall back to isFirstRun when no flag has been written', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
            mockAuthService.isFirstRun.mockReturnValue(of(true));
            expect(await read()).toBe('first-run');
        });

        it('should be complete for a legacy install with no flag but existing users', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
            mockAuthService.isFirstRun.mockReturnValue(of(false));
            expect(await read()).toBe('complete');
        });

        it('should fall back to isFirstRun when the flag cannot be read', async () => {
            // This is the frontend-shipped-before-rules-deployed window: reading
            // the flag signed out is denied until the public-read rule lands, and
            // answering "complete" there would leave a fresh install with no wizard.
            mockGetDoc.mockRejectedValueOnce(new Error('permission denied'));
            mockAuthService.isFirstRun.mockReturnValue(of(true));
            expect(await read()).toBe('first-run');
        });

        it('should fail open when neither signal is available', async () => {
            mockGetDoc.mockRejectedValueOnce(new Error('permission denied'));
            mockAuthService.isFirstRun.mockReturnValue(
                new Observable((subscriber) => subscriber.error(new Error('permission denied'))),
            );
            expect(await read()).toBe('complete');
        });
    });

    describe('shouldShowOnboarding', () => {
        const read = () => new Promise<boolean>((resolve) => {
            service.shouldShowOnboarding().subscribe(resolve);
        });

        it('should be false when setup is complete', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ completed: true }) });
            expect(await read()).toBe(false);
        });

        it('should be true when the wizard was started but never finished', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => true, data: () => ({ completed: false }) });
            expect(await read()).toBe(true);
        });

        it('should be true on a genuine first run', async () => {
            mockGetDoc.mockResolvedValueOnce({ exists: () => false, data: () => undefined });
            mockAuthService.isFirstRun.mockReturnValue(of(true));
            expect(await read()).toBe(true);
        });
    });
});
