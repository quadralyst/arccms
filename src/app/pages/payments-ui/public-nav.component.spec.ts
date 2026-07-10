import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import { PublicNavComponent } from './public-nav.component';
import { AuthState } from '../(auth)/auth.store';

describe('PublicNavComponent', () => {
    let fixture: ComponentFixture<PublicNavComponent>;
    let component: PublicNavComponent;

    const mockAuthState = {
        currentUser: vi.fn().mockReturnValue(null),
        logout: vi.fn().mockReturnValue(of(undefined)),
    };

    async function setup() {
        await TestBed.configureTestingModule({
            imports: [PublicNavComponent],
            providers: [
                provideRouter([]),
                provideNoopAnimations(),
                { provide: AuthState, useValue: mockAuthState },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(PublicNavComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    }

    beforeEach(() => vi.clearAllMocks());

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
