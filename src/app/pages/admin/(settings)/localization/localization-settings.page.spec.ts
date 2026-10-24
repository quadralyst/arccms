/**
 * Tests for LocalizationSettingsPage
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
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
        saveTimeZone: ReturnType<typeof vi.fn>;
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
            saveTimeZone: vi.fn().mockResolvedValue(undefined),
            settings: vi.fn().mockReturnValue(enGb),
        };

        await TestBed.configureTestingModule({
            imports: [LocalizationSettingsPage],
            providers: [
                { provide: LocalizationService, useValue: localizationMock },
                // Addresses pages already use: an app's /pos, and /de/... for a page in German.
                provideRouter([{ path: 'pay', children: [] }, { path: 'de/impressum', children: [] }]),
            ],
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

    it('does not offer a language whose code is an address a page uses', () => {
        expect(component.availableToAdd().map((l) => l.code)).not.toContain('de');
    });

    it('refuses a custom code that is an address a page uses', () => {
        component.languageToAdd.set('__custom__');
        component.customCode.set('pay');
        component.customLabel.set('Point of sale');
        component.addLanguage();

        expect(component.enabledLanguages()).toHaveLength(2);
        expect(component.addError()).toContain('/pay is already a page');
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
    describe("the site's time zone (specs/clock-and-zones-spec.md, T-D9)", () => {
        const page = () => fixture.nativeElement as HTMLElement;

        it('says the site has none yet, and offers this browser\'s zone in one click', async () => {
            expect(page().querySelector('.no-zone')?.textContent).toContain('no time zone yet');
            const zoned = { ...enGb, timeZone: component.deviceZone };
            localizationMock.settings.mockReturnValue(zoned);
            (page().querySelector('.use-device-zone') as HTMLButtonElement).click();
            await fixture.whenStable();
            expect(localizationMock.saveTimeZone).toHaveBeenCalledWith(component.deviceZone);
            expect(component.settings().timeZone).toBe(component.deviceZone);
            fixture.detectChanges();
            expect(page().querySelector('.no-zone')).toBeNull();
            expect(component.zoneMessage()).toBe('Time zone saved');
        });

        it('saves a picked zone without touching the languages on screen', async () => {
            component.languageToAdd.set('fr');
            component.addLanguage();
            component.pickZone('Asia/Kolkata');
            localizationMock.settings.mockReturnValue({ ...enGb, timeZone: 'Asia/Kolkata' });
            await component.saveZone(component.zoneDraft());
            expect(localizationMock.saveTimeZone).toHaveBeenCalledWith('Asia/Kolkata');
            expect(localizationMock.save).not.toHaveBeenCalled();
            // The unsaved French stays on screen, and a later language save carries the new zone.
            expect(component.enabledLanguages().map((l) => l.code)).toEqual(['en', 'hi', 'fr']);
            expect(component.settings().timeZone).toBe('Asia/Kolkata');
        });

        it('keeps the picked zone when saving it fails, and says so', async () => {
            const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
            localizationMock.saveTimeZone.mockRejectedValue(new Error('permission-denied'));
            component.pickZone('Europe/Zurich');
            await component.saveZone('Europe/Zurich');
            expect(component.zoneError()).toContain('could not be saved');
            expect(component.zoneDraft()).toBe('Europe/Zurich');
            expect(component.isSavingZone()).toBe(false);
            consoleSpy.mockRestore();
        });

        it('starts from the saved zone and hides the prompt', async () => {
            localizationMock.load.mockResolvedValue({ ...enGb, timeZone: 'America/Phoenix' });
            await component.ngOnInit();
            fixture.detectChanges();
            expect(component.zoneDraft()).toBe('America/Phoenix');
            expect(page().querySelector('.no-zone')).toBeNull();
            expect(page().querySelector('arc-zone-picker')?.textContent).toContain('Phoenix');
        });
    });
});
