import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { PublicNavComponent } from './public-nav.component';
import { AuthState } from '../(auth)/auth.store';
import { signal } from '@angular/core';
import { SiteBrandService } from '../../core/brand/site-brand';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

describe('PublicNavComponent', () => {
    let fixture: ComponentFixture<PublicNavComponent>;
    let component: PublicNavComponent;

    const mockAuthState = {
        currentUser: vi.fn().mockReturnValue(null),
        logout: vi.fn().mockReturnValue(of(undefined)),
    };

    const siteName = signal('');
    const mockBrand = { name: siteName, load: vi.fn(async () => undefined) };

    async function setup() {
        await TestBed.configureTestingModule({
            imports: [PublicNavComponent, translocoTestingModule()],
            providers: [
                provideRouter([]),
                provideNoopAnimations(),
                { provide: AuthState, useValue: mockAuthState },
                { provide: SiteBrandService, useValue: mockBrand },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(PublicNavComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    }

    beforeEach(() => {
        vi.clearAllMocks();
        siteName.set('');
    });

    it('carries the site\'s own name, as the admin does, never ArcCMS (RF6 6.9)', async () => {
        siteName.set('Example Studio');
        await setup();
        const brand = fixture.nativeElement.querySelector('.brand') as HTMLElement;
        expect(brand.textContent?.trim()).toBe('Example Studio');
        expect(mockBrand.load).toHaveBeenCalled();
        expect(fixture.nativeElement.textContent).not.toContain('ArcCMS');
    });

    it('shows no name until the site\'s is known', async () => {
        await setup();
        expect((fixture.nativeElement.querySelector('.brand') as HTMLElement).textContent?.trim()).toBe('');
    });

    it('says its links in the member\'s words', async () => {
        await setup();
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('Pricing');
        expect(text).toContain('My account');
    });

    it('shows a Sign in button when no user is signed in', async () => {
        mockAuthState.currentUser.mockReturnValue(null);
        await setup();
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('Sign in');
        expect(text).not.toContain('Sign out');
    });

    it('shows the user email and Sign out when signed in', async () => {
        mockAuthState.currentUser.mockReturnValue({ uid: 'u1', email: 'qa@example.com' });
        await setup();
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('qa@example.com');
        expect(text).toContain('Sign out');
    });

    it('names a member with no email by their name, else their phone, never an empty "Signed in as" (RF6 review)', async () => {
        mockAuthState.currentUser.mockReturnValue({ uid: 'u1', email: '', name: 'Asha', phone: '+919800000000' });
        await setup();
        let label = fixture.nativeElement.querySelector('.email') as HTMLElement;
        expect(label.textContent?.trim()).toBe('Asha');
        expect(label.getAttribute('title')).toBe('Signed in as Asha');

        TestBed.resetTestingModule();
        mockAuthState.currentUser.mockReturnValue({ uid: 'u2', phone: '+919800000000' });
        await setup();
        label = fixture.nativeElement.querySelector('.email') as HTMLElement;
        expect(label.textContent?.trim()).toBe('+919800000000');
        expect(label.getAttribute('title')).toBe('Signed in as +919800000000');

        TestBed.resetTestingModule();
        mockAuthState.currentUser.mockReturnValue({ uid: 'u3' });
        await setup();
        expect(fixture.nativeElement.querySelector('.email')).toBeNull();
        expect(fixture.nativeElement.textContent).toContain('Sign out');
    });

    it('signOut logs out then navigates home', async () => {
        mockAuthState.currentUser.mockReturnValue({ uid: 'u1', email: 'qa@example.com' });
        await setup();
        const router = TestBed.inject(Router);
        const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        component.signOut();
        expect(mockAuthState.logout).toHaveBeenCalled();
        expect(navSpy).toHaveBeenCalledWith(['/']);
    });

    it('signIn navigates to /signup with a redirect back', async () => {
        await setup();
        const router = TestBed.inject(Router);
        const navSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);
        component.signIn();
        expect(navSpy).toHaveBeenCalledWith(['/signup'], expect.objectContaining({ queryParams: expect.any(Object) }));
    });
});
