/**
 * Tests for AboutSettingsPage
 */
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import AboutSettingsPage from './about-settings.page';
import { AboutSettingsService } from './about-settings.service';
import { IAboutSettings, parseSameAs, formatSameAs, DEFAULT_ABOUT_SETTINGS } from './about-settings.model';
import { MatDialog } from '@angular/material/dialog';
import { of } from 'rxjs';
import { SiteIdentityService } from '../../../../core/services/site-identity.service';

describe('AboutSettingsPage', () => {
    let component: AboutSettingsPage;
    let fixture: ComponentFixture<AboutSettingsPage>;
    let mockService: any;
    let dialogResult: unknown;
    const mockDialog = { open: vi.fn(() => ({ afterClosed: () => of(dialogResult) })) };

    const mockSettings: IAboutSettings = {
        ...DEFAULT_ABOUT_SETTINGS,
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
                { provide: MatDialog, useValue: mockDialog },
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

    describe('the logo (specs/admin-brand-spec.md AB-D11)', () => {
        it('takes the logo picked in the media library', () => {
            dialogResult = { type: 'submit', mediaUrl: 'https://x.test/logo.png' };
            component.chooseLogo();
            expect(component.settings().logoUrl).toBe('https://x.test/logo.png');
        });

        it('keeps the logo when the media library is closed without a pick', () => {
            component.updateField('logoUrl', 'https://x.test/old.png');
            dialogResult = { type: 'close' };
            component.chooseLogo();
            expect(component.settings().logoUrl).toBe('https://x.test/old.png');
        });

        it('shows the saved name and logo everywhere at once, with no reload', async () => {
            component.updateField('name', 'Tapout POS');
            component.updateField('logoUrl', 'https://x.test/logo.png');
            await component.saveSettings();
            const identity = TestBed.inject(SiteIdentityService);
            expect(identity.loaded()).toBe(true);
            expect(identity.identity().name).toBe('Tapout POS');
            expect(identity.identity().logoUrl).toBe('https://x.test/logo.png');
        });
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

    // ─── Identity fields (specs/discoverability-spec.md, D-D4) ──────────────

    describe('identity fields', () => {
        it('renders the identity inputs', () => {
            const el: HTMLElement = fixture.nativeElement;
            expect(el.querySelector('#organizationType')).toBeTruthy();
            expect(el.querySelector('#logoUrl')).toBeTruthy();
            expect(el.querySelector('#description')).toBeTruthy();
            expect(el.querySelector('#sameAs')).toBeTruthy();
            expect(el.querySelector('#contactEmail')).toBeTruthy();
            expect(el.querySelector('#phone')).toBeTruthy(); // SS3
        });

        it('parses the sameAs textarea into a URL list, dropping junk lines', () => {
            component.updateSameAs('https://x.com/acme\n  https://www.linkedin.com/company/acme \nnot a url\n\n');
            expect(component.settings().sameAs).toEqual([
                'https://x.com/acme',
                'https://www.linkedin.com/company/acme',
            ]);
            expect(component.sameAsText()).toContain('not a url');
        });

        it('narrows the publisher type to the two allowed values', () => {
            component.updateField('organizationType', (component as any).asOrganizationType('Person'));
            expect(component.settings().organizationType).toBe('Person');
            component.updateField('organizationType', (component as any).asOrganizationType('Anything'));
            expect(component.settings().organizationType).toBe('Organization');
        });

        it('saves the identity fields with the rest', async () => {
            component.updateField('logoUrl', 'https://test.com/logo.png');
            component.updateField('description', 'A test site.');
            component.updateField('contactEmail', 'hi@test.com');
            component.updateField('phone', '+91 98765 43210');
            component.updateSameAs('https://x.com/test');
            await component.saveSettings();
            expect(mockService.save).toHaveBeenCalledWith(expect.objectContaining({
                logoUrl: 'https://test.com/logo.png',
                description: 'A test site.',
                contactEmail: 'hi@test.com',
                phone: '+91 98765 43210',
                sameAs: ['https://x.com/test'],
                organizationType: 'Organization',
            }));
        });
    });
});

describe('about-settings.model helpers', () => {
    it('parseSameAs splits on newlines and commas and keeps only http(s) URLs', () => {
        expect(parseSameAs('https://a.com, http://b.com\r\nftp://c.com\nplain')).toEqual(['https://a.com', 'http://b.com']);
        expect(parseSameAs('')).toEqual([]);
    });

    it('formatSameAs joins one per line', () => {
        expect(formatSameAs(['https://a.com', 'https://b.com'])).toBe('https://a.com\nhttps://b.com');
        expect(formatSameAs(undefined)).toBe('');
    });
});
