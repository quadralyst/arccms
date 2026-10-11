import { afterEach, describe, expect, it, vi } from 'vitest';
import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { of } from 'rxjs';
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
