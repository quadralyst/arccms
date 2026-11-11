import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi, describe, beforeEach, it, expect } from 'vitest';

const { memberLocale } = vi.hoisted(() => ({ memberLocale: vi.fn<() => string | undefined>(() => undefined) }));
vi.mock('../../core/i18n/member-language-now', () => ({ memberLocaleNow: memberLocale }));
import CheckoutSuccessPageComponent from './checkout-success.page';
import { AuthState } from '../(auth)/auth.store';
import { MembershipService } from '../payments-ui/membership.service';
import { SiteBrandService } from '../../core/brand/site-brand';
import { signal } from '@angular/core';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

describe('CheckoutSuccessPageComponent', () => {
    let fixture: ComponentFixture<CheckoutSuccessPageComponent>;
    let component: CheckoutSuccessPageComponent;

    const mockAuthState = { currentUser: vi.fn().mockReturnValue(null), logout: vi.fn().mockReturnValue(of(undefined)) };
    const mockMembership = { getById: vi.fn() };

    async function setup(lang = 'en') {
        await TestBed.configureTestingModule({
            imports: [CheckoutSuccessPageComponent, translocoTestingModule({ lang })],
            providers: [
                { provide: SiteBrandService, useValue: { name: signal('Example Studio'), load: async () => undefined } },
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
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain("You're all set");
        expect(text).toContain('Your gold is ready to use.');
    });

    it('writes the renewal date in the member\'s locale now, not the one the app started in (RF6 review)', async () => {
        memberLocale.mockReturnValue('de-DE');
        const when = new Date('2027-03-04T12:00:00Z');
        mockAuthState.currentUser.mockReturnValue({ uid: 'u1', email: 'qa@example.com' });
        mockMembership.getById.mockReturnValue(of({ uid: 'u1', isPro: true, premiumType: 'gold', premiumExpiresAt: when }));
        await setup();
        expect(component.expiresAt()).toBe(when.toLocaleDateString('de-DE'));
        expect(component.expiresAt()).toBe('4.3.2027');
        memberLocale.mockReturnValue(undefined);
    });

    it('speaks the member\'s language (RF6 6.9)', async () => {
        mockAuthState.currentUser.mockReturnValue(null);
        await setup('hi');
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('भुगतान मिल गया');
        expect(text).toContain('मेरे खाते पर जाएँ');
        expect(text).not.toMatch(/Payment received|Go to my account/);
    });

    it('shows the timeout state when no user is signed in (cannot verify)', async () => {
        mockAuthState.currentUser.mockReturnValue(null);
        await setup();

        expect(component.phase()).toBe('timeout');
        expect(mockMembership.getById).not.toHaveBeenCalled();
    });
});
