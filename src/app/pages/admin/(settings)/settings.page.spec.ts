import { ComponentFixture, TestBed } from '@angular/core/testing';
import { headerTestProviders } from '../../../../test/header-test-providers';
import { describe, it, expect, beforeEach } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter, Router } from '@angular/router';
import { Component } from '@angular/core';
import SettingsPageComponent, { SETTING_GROUPS } from './settings.page';
import { featureOfPath, isCorePath } from '../../../core/features/feature-routes';
import { Firestore } from '@angular/fire/firestore';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

@Component({ standalone: true, template: '' })
class BlankComponent {}

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
                provideRouter([{ path: '**', component: BlankComponent }]),
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

    it('has sixteen settings, AI included (on by default), none lost to the grouping', () => {
        expect(component.settingCategories().length).toBe(16);
        const grouped = component.settingGroups().flatMap((g) => g.items.map((c) => c.id));
        expect(grouped).toEqual(component.settingCategories().map((c) => c.id));
        expect(new Set(grouped).size).toBe(16);
    });

    it('groups them as agreed: Site, Sign-in and members, Email and texts, Payments, Connections, Data', () => {
        const groups = Object.fromEntries(component.settingGroups().map((g) => [g.id, g.items.map((c) => c.id)]));
        expect(Object.keys(groups)).toEqual([...SETTING_GROUPS]);
        expect(groups).toEqual({
            site: ['about', 'localization', 'misc', 'message', 'site-usage', 'discoverability'],
            members: ['user', 'app-audience'],
            email: ['email', 'sms', 'automations'],
            payments: ['payments'],
            connections: ['analytics', 'ai', 'integrations'],
            data: ['search'],
        });
    });

    it('opens on Site details, the first setting', () => {
        expect(component.settingCategories()[0].id).toBe('about');
        expect(component.settingCategories()[0].route).toBe('/admin/settings/about');
    });

    it('routes every setting to /admin/settings/<page>', () => {
        const routes = Object.fromEntries(component.settingCategories().map((c) => [c.id, c.route]));
        expect(routes).toEqual({
            about: '/admin/settings/about',
            localization: '/admin/settings/localization',
            misc: '/admin/settings/misc',
            message: '/admin/settings/message',
            'site-usage': '/admin/settings/site-usage',
            discoverability: '/admin/settings/discoverability',
            user: '/admin/settings/user',
            'app-audience': '/admin/settings/app-audience',
            email: '/admin/settings/email',
            sms: '/admin/settings/sms',
            automations: '/admin/settings/automations',
            payments: '/admin/settings/payments',
            analytics: '/admin/settings/analytics',
            ai: '/admin/settings/ai',
            integrations: '/admin/settings/integrations',
            search: '/admin/settings/search',
        });
    });

    it('uses plain names: Email sending, not SMTP configuration', () => {
        const hub = JSON.parse(readFileSync(join(__dirname, '../../../../assets/i18n/en.json'), 'utf8')).admin.settings.hub;
        expect(hub.email.label).toBe('Email sending');
        const text = JSON.stringify(hub);
        expect(text).not.toMatch(/SMTP|OAuth|Miscellaneous|Localization|Global Messages/);
    });

    it('shows a heading for each group and a link for each setting', () => {
        const el: HTMLElement = fixture.nativeElement;
        const headings = [...el.querySelectorAll('.setting-group-title')].map((h) => h.textContent?.trim());
        expect(headings.length).toBe(6);
        expect(el.querySelectorAll('a.setting-item').length).toBe(16);
        // Each group's list is named by its heading.
        for (const list of el.querySelectorAll('.setting-group ul')) {
            const id = list.getAttribute('aria-labelledby');
            expect(id && el.querySelector('#' + id)).toBeTruthy();
        }
    });

    it('folds the phone menu under one button that says where you are', async () => {
        const el: HTMLElement = fixture.nativeElement;
        const toggle = el.querySelector<HTMLButtonElement>('.settings-menu-toggle')!;
        expect(toggle.getAttribute('aria-controls')).toBe('settings-menu');
        expect(toggle.getAttribute('aria-expanded')).toBe('false');
        toggle.click();
        fixture.detectChanges();
        expect(toggle.getAttribute('aria-expanded')).toBe('true');
        expect(el.querySelector('.settings-sidebar')!.classList).toContain('open');
        // Choosing a setting folds it away again.
        el.querySelector<HTMLAnchorElement>('a[data-setting="email"]')!.click();
        fixture.detectChanges();
        expect(component.menuOpen()).toBe(false);
    });

    it('names the setting on screen on the phone menu button', async () => {
        await TestBed.inject(Router).navigateByUrl('/admin/settings/email');
        fixture.detectChanges();
        expect(component.current()?.id).toBe('email');
        expect(fixture.nativeElement.querySelector('.toggle-current')?.textContent).toBeTruthy();
    });

    it('names each setting in the browser tab by its hub name (app.routes.ts titleKey)', () => {
        const routes = readFileSync(join(__dirname, '../../../app.routes.ts'), 'utf8');
        const block = routes.slice(routes.indexOf('// Admin Settings Routes'), routes.indexOf('// Admin Data Routes'));
        const en = JSON.parse(readFileSync(join(__dirname, '../../../../assets/i18n/en.json'), 'utf8')).admin.settings.hub;
        for (const c of component.settingCategories()) {
            const path = c.route.split('/').pop()!;
            const entry = new RegExp(`path: '${path}',\\n\\s*title: '([^']+)',\\n\\s*data: \\{ titleKey: 'admin\\.settings\\.hub\\.${path}\\.label' \\}`).exec(block);
            expect(entry, path).toBeTruthy();
            expect(entry![1], path).toBe(en[path].label);
        }
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
    });

    // Up to 992px wide the menu folds under a button and opens as a list: no
    // sideways scrolling row of chips, which hid most settings on a phone.
    it('has no sideways scrolling row on a phone', () => {
        const source = readFileSync(join(__dirname, 'settings.page.ts'), 'utf8');
        const narrow = source.slice(source.indexOf('@media (max-width: 992px)'));
        expect(narrow).not.toMatch(/overflow-x: auto/);
        expect(narrow).not.toMatch(/white-space: nowrap;\s*\n\s*overflow: hidden/);
        expect(narrow).toMatch(/\.settings-menu-toggle \{[^}]*display: flex/);
        expect(narrow).toMatch(/\.settings-sidebar\.open \.settings-menu \{[^}]*display: block/);
        expect(narrow).toMatch(/grid-template-columns: repeat\(auto-fill, minmax\(150px, 1fr\)\)/);
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
