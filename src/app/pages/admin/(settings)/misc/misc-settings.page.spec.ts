/**
 * Tests for MiscSettingsPage
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MiscSettingsPage } from './misc-settings.page';
import { Firestore, doc, getDoc, setDoc } from '@angular/fire/firestore';
import { IMiscSettings, DEFAULT_MISC_SETTINGS } from './misc-settings.model';

describe('MiscSettingsPage', () => {
    let component: MiscSettingsPage;
    let fixture: ComponentFixture<MiscSettingsPage>;
    let firestoreMock: any;

    const mockSettings: IMiscSettings = {
        showPoweredBy: true,
        mediaMaxFileSize: 10,
        mediaMaxWidth: 2560,
        mediaMaxHeight: 1440,
        mediaConvertToWebp: true,
    };

    beforeEach(async () => {
        firestoreMock = {};

        await TestBed.configureTestingModule({
            imports: [MiscSettingsPage],
            providers: [
                { provide: Firestore, useValue: firestoreMock },
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(MiscSettingsPage);
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

    it('should update field', () => {
        component.updateField('showPoweredBy', false);
        expect(component.settings().showPoweredBy).toBe(false);
        expect(component.brandingSaveMessage()).toBe('');
        expect(component.mediaSaveMessage()).toBe('');
    });

    it('should update media field', () => {
        component.updateField('mediaMaxFileSize', 20);
        expect(component.settings().mediaMaxFileSize).toBe(20);
    });

    describe('saveBranding', () => {
        it('should save branding settings', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await component.saveBranding();

            expect(component.isSavingBranding()).toBe(false);
            consoleSpy.mockRestore();
        });
    });

    describe('saveMediaSettings', () => {
        it('should save media settings', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

            await component.saveMediaSettings();

            expect(component.isSavingMedia()).toBe(false);
            consoleSpy.mockRestore();
        });
    });
});
