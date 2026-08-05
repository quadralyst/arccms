import { ComponentFixture, TestBed } from '@angular/core/testing';
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

    /**
     * The settings nav in the order it renders. Asserted as one list rather than
     * per-index: the previous style pinned each category to a hard-coded position,
     * so inserting Payments in the middle failed three tests that had nothing to do
     * with payments. Adding a category now means editing exactly this array.
     */
    const EXPECTED_CATEGORIES = [
        { id: 'about', label: 'About', route: '/admin/settings/about' },
        { id: 'email', label: 'Email Settings', route: '/admin/settings/email' },
        { id: 'integrations', label: 'Integrations', route: '/admin/settings/integrations' },
        { id: 'analytics', label: 'Analytics', route: '/admin/settings/analytics' },
        { id: 'payments', label: 'Payments', route: '/admin/settings/payments' },
        { id: 'user', label: 'User Settings', route: '/admin/settings/user' },
        { id: 'message', label: 'Global Messages', route: '/admin/settings/message' },
        { id: 'site-usage', label: 'Site Usage', route: '/admin/settings/site-usage' },
        { id: 'misc', label: 'Miscellaneous', route: '/admin/settings/misc' },
    ];

    it('should expose every setting category, in order', () => {
        const actual = component.settingCategories().map(({ id, label, route }) => ({ id, label, route }));
        expect(actual).toEqual(EXPECTED_CATEGORIES);
    });

    it('should give every category a route under /admin/settings', () => {
        for (const category of component.settingCategories()) {
            expect(category.route).toBe(`/admin/settings/${category.id}`);
        }
    });
});
