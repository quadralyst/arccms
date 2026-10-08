import { ComponentFixture, TestBed } from '@angular/core/testing';
import { headerTestProviders } from '../../../../test/header-test-providers';
import { describe, it, expect, beforeEach } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import SettingsPageComponent from './settings.page';
import { featureOfPath, isCorePath } from '../../../core/features/feature-routes';
import { Firestore } from '@angular/fire/firestore';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

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

    it('should have fifteen setting categories', () => {
        expect(component.settingCategories().length).toBe(15);
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
        expect(categories[6].route).toBe('/admin/settings/sms');
        expect(categories[7].route).toBe('/admin/settings/message');
        expect(categories[8].route).toBe('/admin/settings/site-usage');
        expect(categories[9].route).toBe('/admin/settings/localization');
        expect(categories[10].route).toBe('/admin/settings/search');
        expect(categories[11].route).toBe('/admin/settings/discoverability');
        expect(categories[12].route).toBe('/admin/settings/app-audience');
        expect(categories[13].route).toBe('/admin/settings/automations');
        expect(categories[14].route).toBe('/admin/settings/misc');
    });

    it('should have SMS right after user settings (phone sign-in)', () => {
        expect(component.settingCategories()[6].id).toBe('sms');
    });

    it('should have discoverability as twelfth category (D3)', () => {
        expect(component.settingCategories()[11].id).toBe('discoverability');
        expect(component.settingCategories()[11].label).toBe('Discoverability');
    });

    it('should have search as eleventh category', () => {
        expect(component.settingCategories()[10].id).toBe('search');
        expect(component.settingCategories()[10].label).toBe('Search');
    });

    it('should have localization as tenth category', () => {
        expect(component.settingCategories()[9].id).toBe('localization');
        expect(component.settingCategories()[9].label).toBe('Localization');
    });

    it('gives every tab the feature of its page, or none for core (specs/feature-flags-spec.md 8)', () => {
        for (const tab of component.settingCategories()) {
            const path = tab.route.split('/').filter(Boolean);
            expect(tab.feature, tab.id).toBe(featureOfPath(path));
            if (!tab.feature) expect(isCorePath(path), tab.id).toBe(true);
        }
    });

    // jsdom does no layout, so read the styles: a long menu must scroll inside
    // its card instead of spilling below it (items used to be flex: 1, which
    // let them overflow the fixed-height card).
    it('scrolls the menu inside its card when it is taller than the panel', () => {
        const source = readFileSync(join(__dirname, 'settings.page.ts'), 'utf8');
        const rule = (selector: string) =>
            source.match(new RegExp(`\\n {8}${selector.replace('.', '\\.')} \\{([^}]*)\\}`))?.[1] ?? '';
        expect(rule('.settings-sidebar')).toMatch(/overflow-y: auto/);
        expect(rule('.settings-sidebar')).toMatch(/min-height: 0/);
        expect(rule('.settings-sidebar mat-nav-list')).toMatch(/flex: 1 0 auto/);
        expect(rule('.setting-item')).toMatch(/flex: 1 0 auto/);
    });
});

describe('the settings panes', () => {
    it('never repeat the page header: Settings already has the search, language and bell', async () => {
        const { readdirSync, readFileSync, statSync } = await import('node:fs');
        const { join } = await import('node:path');
        const offenders: string[] = [];
        const walk = (dir: string) => {
            for (const name of readdirSync(dir)) {
                const path = join(dir, name);
                if (statSync(path).isDirectory()) walk(path);
                else if (/\.(ts|html)$/.test(name) && !name.endsWith('.spec.ts') && readFileSync(path, 'utf8').includes('<arc-page-header')) offenders.push(path);
            }
        };
        // Every pane is in a folder of its own; the hub itself (settings.page.ts) has the one header.
        for (const name of readdirSync(__dirname)) {
            if (statSync(join(__dirname, name)).isDirectory()) walk(join(__dirname, name));
        }
        expect(offenders).toEqual([]);
    });
});
