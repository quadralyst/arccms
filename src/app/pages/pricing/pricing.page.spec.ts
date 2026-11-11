import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { signal } from '@angular/core';
import { Functions } from '@angular/fire/functions';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import PricingPageComponent from './pricing.page';
import { AuthState } from '../(auth)/auth.store';
import { ProductsService } from '../admin/(products)/products.service';
import { SiteIdentityService } from '../../core/services/site-identity.service';
import { SiteBrandService } from '../../core/brand/site-brand';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

const { callable } = vi.hoisted(() => ({ callable: vi.fn() }));
vi.mock('../../core/config/arc-functions', () => ({ arcCallable: () => callable }));

const plan = {
    id: 'p1', name: 'Studio', type: 'subscription', interval: 'month', price: 10, currency: 'USD',
    description: 'For a small team.', features: ['Ten seats'], trialDays: 14,
};

/** The pricing page, in the member's language (RF6 6.9). */
async function render(lang = 'en', user: unknown = { uid: 'u1', email: 'member@example.com' }) {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
        imports: [PricingPageComponent, translocoTestingModule({ lang })],
        providers: [
            provideRouter([]),
            provideNoopAnimations(),
            { provide: ProductsService, useValue: { listActive: () => of({ collectionData: [plan] }) } },
            { provide: AuthState, useValue: { currentUser: vi.fn(() => user), logout: vi.fn(() => of(undefined)) } },
            { provide: Functions, useValue: {} },
            { provide: SiteIdentityService, useValue: { load: () => new Promise(() => undefined) } },
            { provide: SiteBrandService, useValue: { name: signal('Example Studio'), load: async () => undefined } },
        ],
    }).compileComponents();
    const fixture = TestBed.createComponent(PricingPageComponent);
    fixture.detectChanges();
    return fixture;
}

describe('PricingPageComponent', () => {
    it('says its plans in plain words, with nothing about a CMS', async () => {
        const fixture = await render();
        const text = fixture.nativeElement.textContent as string;
        expect(text).toContain('Plans and pricing');
        expect(text).toContain('Billed monthly');
        expect(text).toContain('14-day free trial');
        expect(text).toContain('Get started');
        expect(text).not.toMatch(/CMS|Get Started|RECOMMENDED/);
    });

    it('speaks Hindi to a member who chose it', async () => {
        const text = (await render('hi')).nativeElement.textContent as string;
        expect(text).toContain('प्लान और मूल्य');
        expect(text).toContain('14 दिन का मुफ़्त ट्रायल');
        expect(text).not.toContain('Billed monthly');
    });

    it('says so when checkout does not open, so the member can try again', async () => {
        callable.mockRejectedValueOnce(new Error('down'));
        const fixture = await render();
        await fixture.componentInstance.buy(plan as never);
        fixture.detectChanges();
        const alert = fixture.nativeElement.querySelector('[role="alert"]') as HTMLElement;
        expect(alert.textContent).toContain('Checkout could not open. Try again.');
        expect(fixture.componentInstance.buyingId()).toBeNull();
    });
});
