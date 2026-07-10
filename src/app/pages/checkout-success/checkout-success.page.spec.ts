import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';
import CheckoutSuccessPageComponent from './checkout-success.page';
import { AuthState } from '../(auth)/auth.store';
import { MembershipService } from '../payments-ui/membership.service';

describe('CheckoutSuccessPageComponent', () => {
    let fixture: ComponentFixture<CheckoutSuccessPageComponent>;
    let component: CheckoutSuccessPageComponent;

    const mockAuthState = { currentUser: vi.fn().mockReturnValue(null), logout: vi.fn().mockReturnValue(of(undefined)) };
    const mockMembership = { getById: vi.fn() };

    async function setup() {
        await TestBed.configureTestingModule({
            imports: [CheckoutSuccessPageComponent],
            providers: [
                provideRouter([]),
                provideNoopAnimations(),
                { provide: AuthState, useValue: mockAuthState },
                { provide: MembershipService, useValue: mockMembership },
            ],
        }).compileComponents();
        fixture = TestBed.createComponent(CheckoutSuccessPageComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    }

    beforeEach(() => {
        vi.clearAllMocks();
        mockMembership.getById.mockReturnValue(of(null));
    });

    it('confirms immediately when the user is already Pro', async () => {
        mockAuthState.currentUser.mockReturnValue({ uid: 'u1', email: 'qa@example.com' });
        mockMembership.getById.mockReturnValue(of({ uid: 'u1', isPro: true, premiumType: 'gold', premiumStatus: 'active' }));
        await setup();

        expect(component.phase()).toBe('confirmed');
        expect(component.entitlement()?.premiumType).toBe('gold');
    });

    it('shows the timeout state when no user is signed in (cannot verify)', async () => {
        mockAuthState.currentUser.mockReturnValue(null);
        await setup();

        expect(component.phase()).toBe('timeout');
        expect(mockMembership.getById).not.toHaveBeenCalled();
    });
});
