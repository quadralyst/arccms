/**
 * Tests for LocalizationSettingsPage
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LocalizationSettingsPage } from './localization-settings.page';
import { LocalizationService } from '../../../../core/services/localization.service';
import {
    DEFAULT_LOCALIZATION_SETTINGS,
    ILocalizationSettings,
    normalizeLocalizationSettings,
} from '../../../../../shared/models/localization.model';

describe('LocalizationSettingsPage', () => {
    let component: LocalizationSettingsPage;
    let fixture: ComponentFixture<LocalizationSettingsPage>;
    let localizationMock: {
        load: ReturnType<typeof vi.fn>;
        save: ReturnType<typeof vi.fn>;
        settings: ReturnType<typeof vi.fn>;
    };

    const enGb: ILocalizationSettings = {
        defaultLanguage: 'en',
        enabledLanguages: [
            { code: 'en', label: 'English', nativeLabel: 'English' },
            { code: 'hi', label: 'Hindi', nativeLabel: 'हिन्दी' },
        ],
    };

    beforeEach(async () => {
        localizationMock = {
            load: vi.fn().mockResolvedValue(enGb),
            save: vi.fn().mockResolvedValue(undefined),
            settings: vi.fn().mockReturnValue(enGb),
        };

        await TestBed.configureTestingModule({
            imports: [LocalizationSettingsPage],
            providers: [{ provide: LocalizationService, useValue: localizationMock }],
        }).compileComponents();

        fixture = TestBed.createComponent(LocalizationSettingsPage);
        component = fixture.componentInstance;
        await component.ngOnInit();
        fixture.detectChanges();
    });

    it('should create and load settings on init', () => {
        expect(component).toBeTruthy();
        expect(localizationMock.load).toHaveBeenCalledWith(true);
        expect(component.settings()).toEqual(enGb);
        expect(component.isLoading()).toBe(false);
    });

    it('offers only languages that are not already enabled', () => {
        const codes = component.availableToAdd().map((l) => l.code);
        expect(codes).not.toContain('en');
        expect(codes).not.toContain('hi');
        expect(codes).toContain('fr');
    });

    it('adds a catalogue language', () => {
        component.languageToAdd.set('fr');
        component.addLanguage();

        expect(component.enabledLanguages().map((l) => l.code)).toEqual(['en', 'hi', 'fr']);
        expect(component.languageToAdd()).toBe('');
        expect(component.addError()).toBe('');
    });

    it('refuses to add a language twice', () => {
        component.languageToAdd.set('hi');
        component.addLanguage();

        expect(component.enabledLanguages()).toHaveLength(2);
        expect(component.addError()).toContain('already enabled');
    });

    it('adds a custom language code', () => {
        component.languageToAdd.set('__custom__');
        component.customCode.set('SW');
        component.customLabel.set('Swahili');
        component.addLanguage();

        const added = component.enabledLanguages().find((l) => l.code === 'sw');
        expect(added).toEqual({ code: 'sw', label: 'Swahili', nativeLabel: 'Swahili' });
    });

    it('rejects an invalid custom code', () => {
        component.languageToAdd.set('__custom__');
        component.customCode.set('not a code!');
        component.customLabel.set('Nope');
        component.addLanguage();

        expect(component.enabledLanguages()).toHaveLength(2);
        expect(component.addError()).toContain('valid language code');
    });

    it('canAdd requires a custom code and label', () => {
        expect(component.canAdd()).toBe(false);
        component.languageToAdd.set('__custom__');
        expect(component.canAdd()).toBe(false);
        component.customCode.set('sw');
        expect(component.canAdd()).toBe(false);
        component.customLabel.set('Swahili');
        expect(component.canAdd()).toBe(true);
    });

    it('removes a non-default language', () => {
        component.removeLanguage('hi');
        expect(component.enabledLanguages().map((l) => l.code)).toEqual(['en']);
    });

    it('never removes the default language', () => {
        component.removeLanguage('en');
        expect(component.enabledLanguages().map((l) => l.code)).toEqual(['en', 'hi']);
    });

    it('changes the default language', () => {
        component.setDefaultLanguage('hi');
        expect(component.defaultLanguage()).toBe('hi');
    });

    it('reorders languages and ignores out-of-range moves', () => {
        component.move(0, 1);
        expect(component.enabledLanguages().map((l) => l.code)).toEqual(['hi', 'en']);

        component.move(0, -1);
        expect(component.enabledLanguages().map((l) => l.code)).toEqual(['hi', 'en']);
    });

    it('saves and reflects the normalized result', async () => {
        const normalized = normalizeLocalizationSettings({
            defaultLanguage: 'hi',
            enabledLanguages: enGb.enabledLanguages,
        });
        localizationMock.settings.mockReturnValue(normalized);

        component.setDefaultLanguage('hi');
        await component.save();

        expect(localizationMock.save).toHaveBeenCalled();
        expect(component.settings()).toEqual(normalized);
        expect(component.enabledLanguages()[0].code).toBe('hi');
        expect(component.saveMessage()).toContain('saved');
        expect(component.isSaving()).toBe(false);
    });

    it('surfaces a save failure without clearing the working copy', async () => {
        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        localizationMock.save.mockRejectedValue(new Error('permission-denied'));

        component.languageToAdd.set('fr');
        component.addLanguage();
        await component.save();

        expect(component.saveError()).toContain('Could not save');
        expect(component.saveMessage()).toBe('');
        expect(component.enabledLanguages().map((l) => l.code)).toEqual(['en', 'hi', 'fr']);
        expect(component.isSaving()).toBe(false);
        consoleSpy.mockRestore();
    });

    it('falls back to defaults when the service returns them', async () => {
        localizationMock.load.mockResolvedValue(DEFAULT_LOCALIZATION_SETTINGS);
        await component.ngOnInit();
        expect(component.enabledLanguages().map((l) => l.code)).toEqual(['en']);
    });
});
