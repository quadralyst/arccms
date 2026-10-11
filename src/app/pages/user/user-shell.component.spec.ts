import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { BehaviorSubject, of } from 'rxjs';
import { BreakpointObserver, type BreakpointState } from '@angular/cdk/layout';
import { UserShellComponent } from './user-shell.component';
import { AuthState } from '../(auth)/auth.store';
import { EntitlementService } from './entitlement.service';
import { SiteBrandService } from '../../core/brand/site-brand';
import { FEATURES } from '../../core/features/features';
import { CUSTOM_HOME } from '../../../custom/home';
import { CUSTOM_APP_ACCOUNTS } from '../../../custom/app-accounts';
import { CUSTOM_NAV_CHANGES } from '../../../custom/nav';

@Component({ standalone: true, template: '' })
class Blank {}

type Person = { name?: string; role?: string; by?: string };

/** The member menu as a person sees it on `url`: each link's text, address, icon and whether it shows as the current page. */
async function memberMenu(person: Person, url = '/user/dashboard') {
    TestBed.configureTestingModule({
        imports: [UserShellComponent],
        providers: [
            provideRouter([{ path: '**', component: Blank }]),
            { provide: AuthState, useValue: { currentUser: signal(person), logout: vi.fn(() => of(null)) } },
            { provide: EntitlementService, useValue: { isPro: signal(false), premiumType: signal(null), creditBalance: signal(0), load: () => of(null) } },
            { provide: SiteBrandService, useValue: { name: signal('Site'), load: () => Promise.resolve() } },
        ],
    });
    await TestBed.inject(Router).navigateByUrl(url);
    const fixture = TestBed.createComponent(UserShellComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return {
        links: [...root.querySelectorAll('nav.menu a')].map((a) => ({
            text: a.textContent!.trim(),
            href: a.getAttribute('href'),
            icon: [...(a.querySelector('i')?.classList ?? [])].sort().join(' '),
            active: a.classList.contains('active'),
        })),
        signOut: root.querySelector('.foot button')?.textContent?.trim(),
    };
}

const link = (text: string, href: string, icon: string, active = false) => ({ text, href, icon: [icon, 'fa-solid'].sort().join(' '), active });

describe('UserShellComponent: the member menu as Arc CMS ships it', () => {
    afterEach(() => {
        for (const key of Object.keys(CUSTOM_HOME)) delete CUSTOM_HOME[key];
        delete CUSTOM_APP_ACCOUNTS.memberPages;
        FEATURES.add('payments');
    });

    it('lists Dashboard, Payments, Account, Premium, Profile and Plans, marking the current page', async () => {
        const { links, signOut } = await memberMenu({ name: 'Asha', role: 'user' }, '/user/profile');
        expect(links).toEqual([
            link('Dashboard', '/user/dashboard', 'fa-gauge'),
            link('Payments', '/user/payments', 'fa-coins'),
            link('Account & Billing', '/account', 'fa-receipt'),
            link('Premium', '/user/premium', 'fa-star'),
            link('Profile', '/user/profile', 'fa-user', true),
            link('Plans', '/pricing', 'fa-tag'),
        ]);
        expect(signOut).toBe('Sign out');
    });

    it('leaves out the payment pages when payments is off', async () => {
        FEATURES.delete('payments');
        const { links } = await memberMenu({ role: 'user' });
        expect(links).toEqual([
            link('Dashboard', '/user/dashboard', 'fa-gauge', true),
            link('Profile', '/user/profile', 'fa-user'),
        ]);
    });

    it("puts Home first when the role's home is an app page, never marked as the current page", async () => {
        CUSTOM_HOME['user'] = '/learn';
        const { links } = await memberMenu({ role: 'user' }, '/learn');
        expect(links[0]).toEqual(link('Home', '/learn', 'fa-house'));
        expect(links.map((l) => l.text)).toEqual(['Home', 'Dashboard', 'Payments', 'Account & Billing', 'Premium', 'Profile', 'Plans']);
    });

    it('keeps a locked app account out of the member pages when the app says so, leaving Home and Plans', async () => {
        CUSTOM_HOME['user'] = '/learn';
        CUSTOM_APP_ACCOUNTS.memberPages = false;
        const { links, signOut } = await memberMenu({ role: 'user', by: 'app' }, '/learn');
        expect(links.map((l) => l.text)).toEqual(['Home', 'Plans']);
        expect(signOut).toBe('Sign out');
    });
});

describe("UserShellComponent: the app's member menu changes (src/custom/nav.ts)", () => {
    afterEach(() => {
        delete CUSTOM_NAV_CHANGES.member;
        FEATURES.add('payments');
    });

    const changes = () => {
        CUSTOM_NAV_CHANGES.member = [
            { id: 'premium', hide: true, roles: ['user'] },
            { id: 'dashboard', label: 'My week', icon: 'fa-solid fa-calendar' },
            { add: { id: 'lessons', label: 'Lessons', icon: 'fa-solid fa-book', route: '/learn', queryParams: { level: '1' } }, before: 'profile' },
            { add: { id: 'staff', label: 'Staff room', icon: 'fa-solid fa-users', route: '/staff', allowRoles: ['teacher'] } },
            { add: { id: 'help', label: 'Help', icon: 'fa-solid fa-circle-question', externalUrl: 'https://example.com/help' } },
            { id: 'plans', after: 'dashboard' },
        ];
    };

    it('hides, rewords, adds and moves items', async () => {
        changes();
        const member = await memberMenu({ role: 'user' }, '/learn?level=1');
        expect(member.links).toEqual([
            link('My week', '/user/dashboard', 'fa-calendar'),
            link('Plans', '/pricing', 'fa-tag'),
            link('Payments', '/user/payments', 'fa-coins'),
            link('Account & Billing', '/account', 'fa-receipt'),
            link('Lessons', '/learn?level=1', 'fa-book', true),
            link('Profile', '/user/profile', 'fa-user'),
            link('Help', 'https://example.com/help', 'fa-circle-question'),
        ]);
        expect(member.signOut).toBe('Sign out');
    });

    it('applies a change only to the roles it names, and shows an added item only to its allowRoles', async () => {
        changes();
        const teacher = await memberMenu({ role: 'teacher' });
        expect(teacher.links.map((l) => l.text)).toEqual(['My week', 'Plans', 'Payments', 'Account & Billing', 'Premium', 'Lessons', 'Profile', 'Staff room', 'Help']);
    });

    it("keeps an item of a feature that is off gone, and ignores a change to an id the menu does not have", async () => {
        FEATURES.delete('payments');
        CUSTOM_NAV_CHANGES.member = [
            { id: 'premium', label: 'Go Pro', before: 'dashboard' },
            { id: 'no-such-item', hide: true },
        ];
        const { links } = await memberMenu({ role: 'user' });
        expect(links.map((l) => l.text)).toEqual(['Dashboard', 'Profile']);
    });
});

/**
 * The button at the top of the member menu: always in reach. On a wider screen it
 * collapses the menu to its icons (remembered in this browser); on a phone, where the menu
 * folds into a bar at the top, it opens and closes it, and a page change closes it.
 */
describe('UserShellComponent: the button at the top of the menu', () => {
    afterEach(() => localStorage.clear());

    async function render(phone = false) {
        TestBed.configureTestingModule({
            imports: [UserShellComponent],
            providers: [
                provideRouter([{ path: '**', component: Blank }]),
                { provide: BreakpointObserver, useValue: { observe: () => new BehaviorSubject<BreakpointState>({ matches: phone, breakpoints: {} }) } },
                { provide: AuthState, useValue: { currentUser: signal({ name: 'Asha', role: 'user' }), logout: vi.fn(() => of(null)) } },
                { provide: EntitlementService, useValue: { isPro: signal(false), premiumType: signal(null), creditBalance: signal(0), load: () => of(null) } },
                { provide: SiteBrandService, useValue: { name: signal('Site'), load: () => Promise.resolve() } },
            ],
        });
        await TestBed.inject(Router).navigateByUrl('/user/dashboard');
        const fixture = TestBed.createComponent(UserShellComponent);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const root = fixture.nativeElement as HTMLElement;
        const button = root.querySelector('button.menu-toggle') as HTMLButtonElement;
        const shell = root.querySelector('.shell') as HTMLElement;
        const press = () => { button.click(); fixture.detectChanges(); };
        return { fixture, root, button, shell, press };
    }

    it('sits in the top row, outside the part that scrolls', async () => {
        const { root, button } = await render();
        expect(button.closest('.top')).not.toBeNull();
        expect(button.closest('.body')).toBeNull();
        expect(root.querySelector('.body nav.menu')).not.toBeNull();
        expect(button.getAttribute('aria-label')).toBe('Collapse menu');
        expect(button.getAttribute('aria-expanded')).toBe('true');
    });

    it('collapses the menu to its icons, each naming itself, and opens it again; this browser remembers', async () => {
        const { root, button, shell, press } = await render();
        press();
        expect(shell.classList).toContain('collapsed');
        expect(button.getAttribute('aria-label')).toBe('Expand menu');
        expect(button.getAttribute('aria-expanded')).toBe('false');
        expect(root.querySelector('nav.menu a')?.getAttribute('title')).toBe('Dashboard');
        expect(localStorage.getItem('memberMenuCollapsed')).toBe('true');

        press();
        expect(shell.classList).not.toContain('collapsed');
        expect(root.querySelector('nav.menu a')?.getAttribute('title')).toBeNull();
        expect(localStorage.getItem('memberMenuCollapsed')).toBe('false');
    });

    it('opens collapsed when this browser last left it so', async () => {
        localStorage.setItem('memberMenuCollapsed', 'true');
        const { shell, button } = await render();
        expect(shell.classList).toContain('collapsed');
        expect(button.getAttribute('aria-label')).toBe('Expand menu');
    });

    it('on a phone, opens and closes the menu, and a page change closes it', async () => {
        localStorage.setItem('memberMenuCollapsed', 'true');
        const { fixture, shell, button, press } = await render(true);
        expect(shell.classList).toContain('phone');
        expect(shell.classList).not.toContain('collapsed');
        expect(shell.classList).not.toContain('phone-open');
        expect(button.getAttribute('aria-label')).toBe('Open menu');
        expect(button.getAttribute('aria-expanded')).toBe('false');

        press();
        expect(shell.classList).toContain('phone-open');
        expect(button.getAttribute('aria-label')).toBe('Close menu');

        await TestBed.inject(Router).navigateByUrl('/user/profile');
        fixture.detectChanges();
        expect(shell.classList).not.toContain('phone-open');
        // The wider screen's choice is left as it was.
        expect(localStorage.getItem('memberMenuCollapsed')).toBe('true');
    });
});
