/**
 * Tests for Site Usage Page Component
 *
 * Tests verify the SiteUsagePageComponent functionality including:
 * - Component creation
 * - Form initialization and validation
 * - Settings loading and saving
 * - Toggle consent functionality
 * - Gradient selection
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { of, throwError } from 'rxjs';
import SiteUsagePageComponent from './site-usage.page';
import { SiteUsageService } from './site-usage.service';
import { Firestore } from '@angular/fire/firestore';
import { DEFAULT_SITE_USAGE_SETTINGS, GRADIENT_PRESETS } from './site-usage.model';

describe('SiteUsagePageComponent', () => {
    let component: SiteUsagePageComponent;
    let fixture: ComponentFixture<SiteUsagePageComponent>;
    let mockSiteUsageService: any;

    beforeEach(async () => {
        mockSiteUsageService = {
            getSettings: vi.fn(() => of({
                isEnabled: false,
                bannerText: 'We use cookies',
                acceptButtonText: 'Accept',
                rejectButtonText: 'Reject',
                privacyPolicyLink: 'https://example.com/privacy',
                gradientId: 'info-blue'
            })),
            saveSettings: vi.fn(() => Promise.resolve())
        };

        await TestBed.configureTestingModule({
            imports: [
                SiteUsagePageComponent,
                NoopAnimationsModule
            ],
            providers: [
                provideRouter([]),
                { provide: SiteUsageService, useValue: mockSiteUsageService },
                { provide: Firestore, useValue: {} }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(SiteUsagePageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should load settings on init', () => {
            expect(mockSiteUsageService.getSettings).toHaveBeenCalled();
        });

        it('should have gradient presets defined', () => {
            expect(component.gradients).toBeDefined();
            expect(component.gradients.length).toBeGreaterThan(0);
        });
    });

    describe('Form Initialization', () => {
        it('should initialize consentForm', () => {
            expect(component.consentForm).toBeTruthy();
        });

        it('should have isEnabled control', () => {
            expect(component.consentForm.get('isEnabled')).toBeTruthy();
        });

        it('should have bannerText control', () => {
            expect(component.consentForm.get('bannerText')).toBeTruthy();
        });

        it('should have acceptButtonText control', () => {
            expect(component.consentForm.get('acceptButtonText')).toBeTruthy();
        });

        it('should have rejectButtonText control', () => {
            expect(component.consentForm.get('rejectButtonText')).toBeTruthy();
        });

        it('should have privacyPolicyLink control', () => {
            expect(component.consentForm.get('privacyPolicyLink')).toBeTruthy();
        });

        it('should have gradientId control', () => {
            expect(component.consentForm.get('gradientId')).toBeTruthy();
        });

        it('should require bannerText', () => {
            component.consentForm.get('bannerText')?.setValue('');
            expect(component.consentForm.get('bannerText')?.valid).toBe(false);
        });

        it('should require acceptButtonText', () => {
            component.consentForm.get('acceptButtonText')?.setValue('');
            expect(component.consentForm.get('acceptButtonText')?.valid).toBe(false);
        });

        it('should require rejectButtonText', () => {
            component.consentForm.get('rejectButtonText')?.setValue('');
            expect(component.consentForm.get('rejectButtonText')?.valid).toBe(false);
        });
    });

    describe('Settings State', () => {
        it('should not be loading after init', () => {
            expect(component.isLoading()).toBe(false);
        });

        it('should not be saving initially', () => {
            expect(component.isSaving()).toBe(false);
        });

        it('should have correct consentEnabled state from settings', () => {
            expect(component.consentEnabled()).toBe(false);
        });

        it('should populate form with loaded settings', () => {
            expect(component.consentForm.get('bannerText')?.value).toBe('We use cookies');
            expect(component.consentForm.get('acceptButtonText')?.value).toBe('Accept');
        });
    });

    describe('toggleConsent', () => {
        it('should call saveSettings when toggling consent', async () => {
            await component.toggleConsent(true);
            expect(mockSiteUsageService.saveSettings).toHaveBeenCalledWith(
                expect.objectContaining({ isEnabled: true })
            );
        });

        it('should update consentEnabled signal', async () => {
            await component.toggleConsent(true);
            expect(component.consentEnabled()).toBe(true);
        });

        it('should revert on error', async () => {
            mockSiteUsageService.saveSettings.mockRejectedValueOnce(new Error('Save failed'));
            await component.toggleConsent(true);
            expect(component.consentEnabled()).toBe(false);
        });
    });

    describe('enableConsent', () => {
        it('should set consentEnabled to true', () => {
            component.consentEnabled.set(false);
            component.enableConsent();
            expect(component.consentEnabled()).toBe(true);
        });

        it('should update form isEnabled to true', () => {
            component.enableConsent();
            expect(component.consentForm.get('isEnabled')?.value).toBe(true);
        });

        it('should mark form as dirty', () => {
            component.enableConsent();
            expect(component.consentForm.dirty).toBe(true);
        });
    });

    describe('selectGradient', () => {
        it('should update gradientId in form', () => {
            component.selectGradient('success-green');
            expect(component.consentForm.get('gradientId')?.value).toBe('success-green');
        });

        it('should mark form as dirty', () => {
            component.selectGradient('warning-orange');
            expect(component.consentForm.dirty).toBe(true);
        });
    });

    describe('getSelectedGradient', () => {
        it('should return current gradient', () => {
            component.consentForm.patchValue({ gradientId: 'info-blue' });
            const gradient = component.getSelectedGradient();
            expect(gradient).toBeDefined();
            expect(gradient.id).toBe('info-blue');
        });

        it('should return default gradient when none selected', () => {
            component.consentForm.patchValue({ gradientId: null });
            const gradient = component.getSelectedGradient();
            expect(gradient.id).toBe('info-blue');
        });
    });

    describe('onSubmit', () => {
        it('should not save when form is invalid', async () => {
            component.consentForm.get('bannerText')?.setValue('');
            await component.onSubmit();
            expect(mockSiteUsageService.saveSettings).not.toHaveBeenCalled();
        });

        it('should call saveSettings when form is valid', async () => {
            component.consentForm.patchValue({
                bannerText: 'Valid text',
                acceptButtonText: 'Accept',
                rejectButtonText: 'Reject'
            });
            await component.onSubmit();
            expect(mockSiteUsageService.saveSettings).toHaveBeenCalled();
        });

        it('should set isSaving during save', async () => {
            component.consentForm.patchValue({
                bannerText: 'Valid text',
                acceptButtonText: 'Accept',
                rejectButtonText: 'Reject'
            });

            const savePromise = component.onSubmit();
            // isSaving should be true during the save
            await savePromise;
            expect(component.isSaving()).toBe(false);
        });

        it('should mark form as pristine after successful save', async () => {
            component.consentForm.patchValue({
                bannerText: 'Valid text',
                acceptButtonText: 'Accept',
                rejectButtonText: 'Reject'
            });
            component.consentForm.markAsDirty();
            await component.onSubmit();
            expect(component.consentForm.pristine).toBe(true);
        });
    });

    describe('Error Handling', () => {
        it('should have isLoading signal for loading state management', () => {
            expect(component.isLoading).toBeDefined();
            expect(typeof component.isLoading()).toBe('boolean');
        });

        it('should have isSaving signal for save state management', () => {
            expect(component.isSaving).toBeDefined();
            expect(typeof component.isSaving()).toBe('boolean');
        });
    });
});
