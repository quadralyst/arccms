import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import UnauthorizedComponent from './unauthorized.page';
import { AuthState } from '../(auth)/auth.store';
import { CUSTOM_HOME } from '../../../custom/home';

/** The 403 page as `person` sees it (null: signed out). */
function render(person: { role?: string } | null) {
    TestBed.configureTestingModule({
        imports: [UnauthorizedComponent],
        providers: [provideRouter([]), { provide: AuthState, useValue: { currentUser: signal(person) } }],
    });
    const fixture = TestBed.createComponent(UnauthorizedComponent);
    fixture.detectChanges();
    const root = fixture.nativeElement as HTMLElement;
    return { text: root.textContent!, links: [...root.querySelectorAll('a')].map((a) => ({ text: a.textContent!.trim(), href: a.getAttribute('href') })) };
}

describe('the 403 page (F26)', () => {
    afterEach(() => {
        for (const key of Object.keys(CUSTOM_HOME)) delete CUSTOM_HOME[key];
    });

    it('offers a signed-in member their home, not sign-up', () => {
        const { links, text } = render({ role: 'user' });
        expect(links).toEqual([{ text: 'Go to your home page', href: '/user/dashboard' }]);
        expect(text).not.toMatch(/sign\s?up/i);
    });

    it('offers a signed-in person the home their app set for their role', () => {
        CUSTOM_HOME['user'] = '/app/today';
        expect(render({ role: 'user' }).links).toEqual([{ text: 'Go to your home page', href: '/app/today' }]);
    });

    it('offers someone signed out the way to sign in', () => {
        expect(render(null).links).toEqual([{ text: 'Sign in', href: '/signup' }]);
    });

    it('says what happened, in the person\'s language, with no typo', () => {
        const { text } = render(null);
        expect(text).toContain('No access');
        expect(text).toContain("You don't have access to this page.");
        // Plain words for a member: no status code (RF6 6.9).
        expect(text).not.toContain('403');
        expect(text).not.toContain('Opps');
    });
});

describe('public/403.html, the plain page the hosting serves', () => {
    const html = readFileSync(resolve(__dirname, '../../../../public/403.html'), 'utf8');

    it('says "No access" in plain words, and keeps a side margin so its button never touches a phone\'s edges', () => {
        expect(html).toContain('<h1 class="display-5 fw-bold">No access</h1>');
        expect(html).toContain('<title>No access</title>');
        expect(html).not.toMatch(/>403<|Access Denied|Oops|Opps/);
        expect(html).toMatch(/class="text-center px-3"/);
    });
});
