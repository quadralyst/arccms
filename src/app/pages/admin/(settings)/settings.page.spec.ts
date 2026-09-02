import { ComponentFixture, TestBed } from '@angular/core/testing';
import { headerTestProviders } from '../../../../test/header-test-providers';
import { describe, it, expect, beforeEach } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import SettingsPageComponent from './settings.page';
import { Firestore } from '@angular/fire/firestore';

describe('SettingsPageComponent', () => {
    let component: SettingsPageComponent;
    let fixture: ComponentFixture<SettingsPageComponent>;

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                SettingsPageComponent,
                NoopAnimationsModule,
            ],
            providers: [
                ...headerTestProviders(),
                provideRouter([]),
                { provide: Firestore, useValue: {} },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SettingsPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should have ten setting categories', () => {
        expect(component.settingCategories().length).toBe(10);
    });

    it('should have about as first category', () => {
        expect(component.settingCategories()[0].id).toBe('about');
        expect(component.settingCategories()[0].label).toBe('About');
    });

    it('should have email settings as second category', () => {
        expect(component.settingCategories()[1].id).toBe('email');
        expect(component.settingCategories()[1].label).toBe('Email Settings');
    });

    it('should have integrations as third category', () => {
        expect(component.settingCategories()[2].id).toBe('integrations');
        expect(component.settingCategories()[2].label).toBe('Integrations');
    });

    it('should have analytics as fourth category', () => {
        expect(component.settingCategories()[3].id).toBe('analytics');
        expect(component.settingCategories()[3].label).toBe('Analytics');
    });

    it('should have payments as fifth category', () => {
        expect(component.settingCategories()[4].id).toBe('payments');
        expect(component.settingCategories()[4].label).toBe('Payments');
    });

    it('should have user settings as sixth category', () => {
        expect(component.settingCategories()[5].id).toBe('user');
        expect(component.settingCategories()[5].label).toBe('User Settings');
    });

    it('should have correct routes for all categories', () => {
        const categories = component.settingCategories();
        expect(categories[0].route).toBe('/admin/settings/about');
        expect(categories[1].route).toBe('/admin/settings/email');
        expect(categories[2].route).toBe('/admin/settings/integrations');
        expect(categories[3].route).toBe('/admin/settings/analytics');
        expect(categories[4].route).toBe('/admin/settings/payments');
        expect(categories[5].route).toBe('/admin/settings/user');
        expect(categories[6].route).toBe('/admin/settings/message');
        expect(categories[7].route).toBe('/admin/settings/site-usage');
        expect(categories[8].route).toBe('/admin/settings/localization');
        expect(categories[9].route).toBe('/admin/settings/misc');
    });

    it('should have localization as ninth category', () => {
        expect(component.settingCategories()[8].id).toBe('localization');
        expect(component.settingCategories()[8].label).toBe('Localization');
    });
});
