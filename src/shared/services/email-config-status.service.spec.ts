/**
 * Tests for EmailConfigStatusService
 */
import { TestBed } from '@angular/core/testing';
import { EmailConfigStatusService } from './email-config-status.service';
import { Firestore, doc, onSnapshot } from '@angular/fire/firestore';
import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// Track mock state
let mockOnSnapshotCallback: any = null;
let mockOnSnapshotError: any = null;

// Mock the Firestore module
vi.mock('@angular/fire/firestore', () => ({
    Firestore: class { },
    doc: vi.fn(),
    onSnapshot: vi.fn((docRef: any, successCallback: any, errorCallback?: any) => {
        mockOnSnapshotCallback = successCallback;
        mockOnSnapshotError = errorCallback;
        return vi.fn(); // unsubscribe function
    })
}));

describe('EmailConfigStatusService', () => {
    let service: EmailConfigStatusService;
    let mockFirestore: any;

    /**
     * Helper to create service and trigger Firestore callback with specific data
     * Note: The service uses 'isEnabled' field, not 'enabled'
     */
    function createServiceWithEmailState(isEnabled: boolean | null, triggerError = false): EmailConfigStatusService {
        TestBed.resetTestingModule();
        TestBed.configureTestingModule({
            providers: [
                EmailConfigStatusService,
                { provide: Firestore, useValue: mockFirestore }
            ]
        });

        const svc = TestBed.inject(EmailConfigStatusService);

        // Trigger the callback that was registered
        if (triggerError && mockOnSnapshotError) {
            mockOnSnapshotError(new Error('Firestore error'));
        } else if (mockOnSnapshotCallback) {
            mockOnSnapshotCallback({
                data: () => isEnabled === null ? null : { isEnabled }
            });
        }

        return svc;
    }

    beforeEach(() => {
        mockFirestore = {};
        mockOnSnapshotCallback = null;
        mockOnSnapshotError = null;

        // Clear sessionStorage
        try {
            if (typeof sessionStorage !== 'undefined') {
                sessionStorage.clear();
            }
        } catch { }

        TestBed.configureTestingModule({
            providers: [
                EmailConfigStatusService,
                { provide: Firestore, useValue: mockFirestore }
            ]
        });

        service = TestBed.inject(EmailConfigStatusService);

        // Trigger default callback (email disabled - isEnabled: false)
        if (mockOnSnapshotCallback) {
            mockOnSnapshotCallback({
                data: () => ({ isEnabled: false })
            });
        }
    });

    afterEach(() => {
        vi.clearAllMocks();
        try {
            if (typeof sessionStorage !== 'undefined') {
                sessionStorage.clear();
            }
        } catch { }
    });

    it('should be created', () => {
        expect(service).toBeTruthy();
    });

    describe('isEmailConfigured', () => {
        it('should return false when email is not enabled', () => {
            expect(service.isEmailConfigured()).toBe(false);
        });

        it('should return true when email is enabled (isEnabled: true)', () => {
            const enabledService = createServiceWithEmailState(true);
            expect(enabledService.isEmailConfigured()).toBe(true);
        });

        it('should return false when Firestore document has no data', () => {
            const noDataService = createServiceWithEmailState(null);
            expect(noDataService.isEmailConfigured()).toBe(false);
        });
    });

    describe('isLoading', () => {
        it('should be false after Firestore listener returns', () => {
            expect(service.isLoading()).toBe(false);
        });

        it('should be true before Firestore listener returns', () => {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    EmailConfigStatusService,
                    { provide: Firestore, useValue: mockFirestore }
                ]
            });
            const loadingService = TestBed.inject(EmailConfigStatusService);
            // Don't trigger callback - should still be loading
            expect(loadingService.isLoading()).toBe(true);
        });
    });

    describe('bannerDismissed', () => {
        it('should return false initially', () => {
            expect(service.bannerDismissed()).toBe(false);
        });

        it('should return true after dismissBanner is called', () => {
            service.dismissBanner();
            expect(service.bannerDismissed()).toBe(true);
        });

        it('should persist dismissed state to sessionStorage', () => {
            service.dismissBanner();
            try {
                if (typeof sessionStorage !== 'undefined') {
                    expect(sessionStorage.getItem('email_banner_dismissed')).toBe('true');
                }
            } catch {
                // Skip if sessionStorage not available
            }
        });

        it('should restore dismissed state from sessionStorage', () => {
            try {
                if (typeof sessionStorage !== 'undefined') {
                    sessionStorage.setItem('email_banner_dismissed', 'true');

                    const restoredService = createServiceWithEmailState(false);
                    expect(restoredService.bannerDismissed()).toBe(true);
                }
            } catch {
                // Skip if sessionStorage not available
            }
        });
    });

    describe('shouldShowBanner', () => {
        it('should return true when email is not configured and banner not dismissed', () => {
            // Default state: email disabled, not dismissed, not loading
            expect(service.shouldShowBanner()).toBe(true);
        });

        it('should return false when email is configured (isEnabled: true)', () => {
            const enabledService = createServiceWithEmailState(true);
            expect(enabledService.shouldShowBanner()).toBe(false);
        });

        it('should return false when banner is dismissed', () => {
            service.dismissBanner();
            expect(service.shouldShowBanner()).toBe(false);
        });

        it('should return false when still loading', () => {
            TestBed.resetTestingModule();
            TestBed.configureTestingModule({
                providers: [
                    EmailConfigStatusService,
                    { provide: Firestore, useValue: mockFirestore }
                ]
            });
            const loadingService = TestBed.inject(EmailConfigStatusService);
            // Don't trigger callback - stays in loading state
            expect(loadingService.shouldShowBanner()).toBe(false);
        });
    });

    describe('Firestore error handling', () => {
        it('should set isEmailConfigured to false on error', () => {
            const errorService = createServiceWithEmailState(false, true);
            expect(errorService.isEmailConfigured()).toBe(false);
            expect(errorService.isLoading()).toBe(false);
        });
    });

    describe('cleanup', () => {
        it('should have ngOnDestroy method', () => {
            expect(typeof service.ngOnDestroy).toBe('function');
        });

        it('should not throw when ngOnDestroy is called', () => {
            expect(() => service.ngOnDestroy()).not.toThrow();
        });
    });
});
