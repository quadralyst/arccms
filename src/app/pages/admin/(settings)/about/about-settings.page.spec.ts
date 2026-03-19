/**
 * Tests for AboutSettingsPage
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import AboutSettingsPage from './about-settings.page';
import { AboutSettingsService } from './about-settings.service';
import { IAboutSettings } from './about-settings.model';

describe('AboutSettingsPage', () => {
    let component: AboutSettingsPage;
    let fixture: ComponentFixture<AboutSettingsPage>;
    let mockService: any;

    const mockSettings: IAboutSettings = {
        name: 'Test Site',
        finalUrl: 'https://test.com',
        address: '123 Test St',
    };

    beforeEach(async () => {
        mockService = {
            load: vi.fn().mockResolvedValue(mockSettings),
            save: vi.fn().mockResolvedValue(undefined),
        };

        await TestBed.configureTestingModule({
            imports: [AboutSettingsPage],
            providers: [
                { provide: AboutSettingsService, useValue: mockService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AboutSettingsPage);
        component = fixture.componentInstance;

        // Mock loadSettings to avoid actual Firestore call in ngOnInit
        vi.spyOn(component, 'loadSettings').mockImplementation(async () => {
            component.settings.set(mockSettings);
        });

        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should load settings on init', () => {
        expect(component.loadSettings).toHaveBeenCalled();
        expect(component.settings()).toEqual(mockSettings);
    });

    it('should update name field', () => {
        component.updateField('name', 'New Name');
        expect(component.settings().name).toBe('New Name');
        expect(component.saveMessage()).toBe('');
    });

    it('should update finalUrl field', () => {
        component.updateField('finalUrl', 'https://new-url.com');
        expect(component.settings().finalUrl).toBe('https://new-url.com');
    });

    it('should update address field', () => {
        component.updateField('address', '456 New St');
        expect(component.settings().address).toBe('456 New St');
    });

    describe('saveSettings', () => {
        it('should call service.save with current settings', async () => {
            // Restore loadSettings to use the mock service
            vi.restoreAllMocks();
            vi.spyOn(component, 'loadSettings').mockImplementation(async () => {
                component.settings.set(mockSettings);
            });

            await component.saveSettings();

            expect(mockService.save).toHaveBeenCalledWith(mockSettings);
        });

        it('should show success message after save', async () => {
            await component.saveSettings();

            expect(component.saveMessage()).toBe('Settings saved successfully');
            expect(component.saveError()).toBe(false);
            expect(component.isSaving()).toBe(false);
        });

        it('should set isSaving to true during save', async () => {
            let savingDuringCall = false;
            mockService.save.mockImplementation(async () => {
                savingDuringCall = component.isSaving();
            });

            await component.saveSettings();

            expect(savingDuringCall).toBe(true);
            expect(component.isSaving()).toBe(false);
        });

        it('should handle save errors', async () => {
            mockService.save.mockRejectedValue(new Error('Save failed'));
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await component.saveSettings();

            expect(component.saveMessage()).toBe('Failed to save settings');
            expect(component.saveError()).toBe(true);
            expect(component.isSaving()).toBe(false);
            consoleSpy.mockRestore();
        });

        it('should clear save error when field is updated', async () => {
            mockService.save.mockRejectedValue(new Error('Save failed'));
            vi.spyOn(console, 'error').mockImplementation(() => {});

            await component.saveSettings();
            expect(component.saveError()).toBe(true);

            component.updateField('name', 'Changed');
            expect(component.saveError()).toBe(false);
            expect(component.saveMessage()).toBe('');
        });
    });
});
