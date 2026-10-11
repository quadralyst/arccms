import { describe, expect, it, vi, beforeEach } from 'vitest';
import { Component, EventEmitter, Input, Output, provideZonelessChangeDetection, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { provideRouter } from '@angular/router';
import { BreakpointObserver, type BreakpointState } from '@angular/cdk/layout';
import { BehaviorSubject } from 'rxjs';
import * as fs from 'fs';
import * as path from 'path';
import AdminComponent from './admin.page';
import SideNavbarComponent from '../../shared/components/side-navbar/side-navbar.component';
import { SiteBrandService } from '../core/brand/site-brand';

@Component({ selector: 'arc-side-navbar', standalone: true, template: '' })
class NavbarStub {
    @Input() isExpanded: boolean | undefined;
    @Input() drawerMode: string | undefined;
    @Output() toggleMenu = new EventEmitter();
}

/**
 * The admin's layout (admin.page.ts): the side panel and, on a phone, the bar with the
 * menu button. The app runs without zone.js, so these run without it too.
 */
describe('AdminComponent: the side panel and its button', () => {
    let screen: BehaviorSubject<BreakpointState>;

    beforeEach(() => {
        localStorage.clear();
        screen = new BehaviorSubject<BreakpointState>({ matches: false, breakpoints: {} });
    });

    async function render() {
        TestBed.configureTestingModule({
            imports: [AdminComponent, NoopAnimationsModule],
            providers: [
                provideZonelessChangeDetection(),
                provideRouter([]),
                { provide: BreakpointObserver, useValue: { observe: () => screen } },
                { provide: SiteBrandService, useValue: { name: signal('Acme Studio') } },
            ],
        });
        TestBed.overrideComponent(AdminComponent, { remove: { imports: [SideNavbarComponent] }, add: { imports: [NavbarStub] } });
        const fixture = TestBed.createComponent(AdminComponent);
        fixture.autoDetectChanges();
        await fixture.whenStable();
        return fixture;
    }

    const phoneBar = (fixture: any) => fixture.nativeElement.querySelector('.arc-mobile-bar') as HTMLElement | null;

    it('shows the phone bar, with its menu button, as soon as the window is phone width, and hides it again', async () => {
        const fixture = await render();
        expect(phoneBar(fixture)).toBeNull();

        screen.next({ matches: true, breakpoints: {} });
        await fixture.whenStable();
        expect(phoneBar(fixture)?.querySelector('button')?.getAttribute('aria-label')).toBe('Open menu');

        screen.next({ matches: false, breakpoints: {} });
        await fixture.whenStable();
        expect(phoneBar(fixture)).toBeNull();
    });

    it('closes the panel on a phone without changing the wider screen\'s open or collapsed panel', async () => {
        localStorage.setItem('isExpanded', 'true');
        const fixture = await render();
        screen.next({ matches: true, breakpoints: {} });
        await fixture.whenStable();
        const component = fixture.componentInstance;
        const toggle = vi.spyOn(component.drawer, 'toggle');

        component.toggleMenu();

        expect(toggle).toHaveBeenCalled();
        expect(component.isExpanded).toBe(true);
        expect(localStorage.getItem('isExpanded')).toBe('true');
    });

    it('opens with the panel open in a browser that has never collapsed it', async () => {
        const fixture = await render();
        expect(fixture.componentInstance.isExpanded).toBe(true);
    });

    it('opens collapsed in a browser that last collapsed it', async () => {
        localStorage.setItem('isExpanded', 'false');
        const fixture = await render();
        expect(fixture.componentInstance.isExpanded).toBe(false);
    });

    it('collapses and expands the panel on a wider screen, and remembers it', async () => {
        localStorage.setItem('isExpanded', 'true');
        const fixture = await render();
        const component = fixture.componentInstance;

        component.toggleMenu();
        expect(component.isExpanded).toBe(false);
        expect(localStorage.getItem('isExpanded')).toBe('false');

        component.toggleMenu();
        expect(localStorage.getItem('isExpanded')).toBe('true');
    });

    it('keeps the phone bar at the top while the page scrolls, and the page\'s own sticky bars below it', () => {
        const page = fs.readFileSync(path.resolve(__dirname, 'admin.page.ts'), 'utf8');
        const bar = page.slice(page.indexOf('.arc-mobile-bar {'));
        expect(bar.slice(0, bar.indexOf('}'))).toMatch(/position: sticky;\s*top: 0;/);
        expect(page).toMatch(/\.arc-admin\.is-phone \{\s*--arc-admin-sticky-top: 48px;/);
        const styles = fs.readFileSync(path.resolve(__dirname, '../../styles.css'), 'utf8');
        expect(styles).toMatch(/\.composer-topbar \{[^}]*top: var\(--arc-admin-sticky-top, 0px\)/);
    });
});
