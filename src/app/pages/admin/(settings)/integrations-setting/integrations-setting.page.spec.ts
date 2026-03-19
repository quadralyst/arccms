import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { Firestore } from '@angular/fire/firestore';
import IntegrationsSettingPageComponent from './integrations-setting.page';
import { IntegrationsSettingService } from './integrations-setting.service';
import { of } from 'rxjs';
import { DEFAULT_INTEGRATIONS_SETTINGS } from './integrations-setting.model';

describe('IntegrationsSettingPageComponent', () => {
    let component: IntegrationsSettingPageComponent;
    let fixture: ComponentFixture<IntegrationsSettingPageComponent>;
    let mockIntegrationsSettingService: any;

    beforeEach(async () => {
        mockIntegrationsSettingService = {
            getIntegrationsSettings: vi.fn().mockReturnValue(of(DEFAULT_INTEGRATIONS_SETTINGS)),
            saveIntegrationsSettings: vi.fn().mockResolvedValue(undefined),
        };

        await TestBed.configureTestingModule({
            imports: [
                IntegrationsSettingPageComponent,
                NoopAnimationsModule,
            ],
            providers: [
                provideRouter([]),
                { provide: Firestore, useValue: {} },
                { provide: IntegrationsSettingService, useValue: mockIntegrationsSettingService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(IntegrationsSettingPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Component creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should load settings on init', () => {
            expect(mockIntegrationsSettingService.getIntegrationsSettings).toHaveBeenCalled();
        });

        it('should not be loading after settings load', () => {
            expect(component.isLoading()).toBe(false);
        });
    });

    describe('Form structure', () => {
        it('should have an unsplashForm', () => {
            expect(component.unsplashForm).toBeDefined();
        });

        it('should have a geoForm', () => {
            expect(component.geoForm).toBeDefined();
        });

        it('should have unsplash accessKey control', () => {
            expect(component.unsplashForm.get('accessKey')).toBeDefined();
        });

        it('should have unsplash secretKey control', () => {
            expect(component.unsplashForm.get('secretKey')).toBeDefined();
        });

        it('should have geoEnabled control', () => {
            expect(component.geoForm.get('geoEnabled')).toBeDefined();
        });

        it('should have geoApiProvider control', () => {
            expect(component.geoForm.get('geoApiProvider')).toBeDefined();
        });

        it('should be pristine after loading', () => {
            expect(component.unsplashForm.pristine).toBe(true);
            expect(component.geoForm.pristine).toBe(true);
        });
    });

    describe('Signal initial states', () => {
        it('should start with showAccessKey false', () => {
            expect(component.showAccessKey()).toBe(false);
        });

        it('should start with showSecretKey false', () => {
            expect(component.showSecretKey()).toBe(false);
        });

        it('should start with isSavingUnsplash false', () => {
            expect(component.isSavingUnsplash()).toBe(false);
        });

        it('should start with isSavingGeo false', () => {
            expect(component.isSavingGeo()).toBe(false);
        });
    });

    describe('resetUnsplash', () => {
        it('should restore original values and mark form pristine', () => {
            component.unsplashForm.get('accessKey')!.setValue('changed-key');
            component.unsplashForm.markAsDirty();

            component.resetUnsplash();

            expect(component.unsplashForm.get('accessKey')!.value).toBe('');
            expect(component.unsplashForm.pristine).toBe(true);
        });
    });

    describe('resetGeo', () => {
        it('should restore original values and mark form pristine', () => {
            component.geoForm.get('geoEnabled')!.setValue(true);
            component.geoForm.markAsDirty();

            component.resetGeo();

            expect(component.geoForm.get('geoEnabled')!.value).toBe(false);
            expect(component.geoForm.pristine).toBe(true);
        });
    });

    describe('saveUnsplash', () => {
        it('should call saveIntegrationsSettings with unsplash form values', async () => {
            component.unsplashForm.get('accessKey')!.setValue('my-access-key');
            component.unsplashForm.get('secretKey')!.setValue('my-secret-key');
            component.unsplashForm.markAsDirty();

            await component.saveUnsplash();

            expect(mockIntegrationsSettingService.saveIntegrationsSettings).toHaveBeenCalledWith({
                unsplash: { accessKey: 'my-access-key', secretKey: 'my-secret-key' },
                geo: { geoEnabled: false, geoApiProvider: 'ipapi', geoApiKey: '', geoApiEndpoint: '' },
            });
        });

        it('should mark unsplash form as pristine after successful save', async () => {
            component.unsplashForm.get('accessKey')!.setValue('my-access-key');
            component.unsplashForm.markAsDirty();

            await component.saveUnsplash();

            expect(component.unsplashForm.pristine).toBe(true);
        });

        it('should set isSavingUnsplash to false after save completes', async () => {
            component.unsplashForm.get('accessKey')!.setValue('key');
            component.unsplashForm.markAsDirty();

            await component.saveUnsplash();

            expect(component.isSavingUnsplash()).toBe(false);
        });

        it('should set isSavingUnsplash to false even if save throws', async () => {
            mockIntegrationsSettingService.saveIntegrationsSettings.mockRejectedValueOnce(new Error('Save failed'));
            component.unsplashForm.get('accessKey')!.setValue('key');
            component.unsplashForm.markAsDirty();

            await component.saveUnsplash();

            expect(component.isSavingUnsplash()).toBe(false);
        });
    });

    describe('saveGeo', () => {
        it('should call saveIntegrationsSettings with geo form values', async () => {
            component.geoForm.get('geoEnabled')!.setValue(true);
            component.geoForm.get('geoApiProvider')!.setValue('ipapi');
            component.geoForm.markAsDirty();

            await component.saveGeo();

            expect(mockIntegrationsSettingService.saveIntegrationsSettings).toHaveBeenCalledWith({
                unsplash: { accessKey: '', secretKey: '' },
                geo: { geoEnabled: true, geoApiProvider: 'ipapi', geoApiKey: '', geoApiEndpoint: '' },
            });
        });

        it('should mark geo form as pristine after successful save', async () => {
            component.geoForm.get('geoEnabled')!.setValue(true);
            component.geoForm.markAsDirty();

            await component.saveGeo();

            expect(component.geoForm.pristine).toBe(true);
        });

        it('should set isSavingGeo to false even if save throws', async () => {
            mockIntegrationsSettingService.saveIntegrationsSettings.mockRejectedValueOnce(new Error('Save failed'));
            component.geoForm.get('geoEnabled')!.setValue(true);
            component.geoForm.markAsDirty();

            await component.saveGeo();

            expect(component.isSavingGeo()).toBe(false);
        });
    });

    describe('Setup guide auto-collapse', () => {
        it('should collapse unsplash guide when accessKey is present', async () => {
            mockIntegrationsSettingService.getIntegrationsSettings.mockReturnValue(of({
                ...DEFAULT_INTEGRATIONS_SETTINGS,
                unsplash: { accessKey: 'existing-key', secretKey: '' },
            }));

            fixture = TestBed.createComponent(IntegrationsSettingPageComponent);
            component = fixture.componentInstance;
            fixture.detectChanges();

            expect(component.showUnsplashGuide()).toBe(false);
        });

        it('should collapse geo guide when geoEnabled is true', async () => {
            mockIntegrationsSettingService.getIntegrationsSettings.mockReturnValue(of({
                ...DEFAULT_INTEGRATIONS_SETTINGS,
                geo: { geoEnabled: true, geoApiProvider: 'ipapi', geoApiKey: '', geoApiEndpoint: '' },
            }));

            fixture = TestBed.createComponent(IntegrationsSettingPageComponent);
            component = fixture.componentInstance;
            fixture.detectChanges();

            expect(component.showGeoGuide()).toBe(false);
        });

        it('should show both guides by default when nothing configured', () => {
            expect(component.showUnsplashGuide()).toBe(true);
            expect(component.showGeoGuide()).toBe(true);
        });
    });
});
