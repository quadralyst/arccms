import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { signal } from '@angular/core';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import CheckoutCancelPageComponent from './checkout-cancel.page';
import { AuthState } from '../(auth)/auth.store';
import { SiteBrandService } from '../../core/brand/site-brand';
import { translocoTestingModule } from '../../../test/transloco-test-providers';

/** The page a buyer lands on after leaving checkout, in the member's language (RF6 6.9). */
async function render(lang: string): Promise<string> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
        imports: [CheckoutCancelPageComponent, translocoTestingModule({ lang })],
        providers: [
            provideRouter([]),
            { provide: AuthState, useValue: { currentUser: vi.fn(() => null), logout: vi.fn(() => of(undefined)) } },
            { provide: SiteBrandService, useValue: { name: signal('Example Studio'), load: async () => undefined } },
        ],
    }).compileComponents();
    const fixture = TestBed.createComponent(CheckoutCancelPageComponent);
    fixture.detectChanges();
    return fixture.nativeElement.textContent as string;
}

describe('CheckoutCancelPageComponent', () => {
    it('says no payment was taken and offers the way back, in sentence case', async () => {
        const text = await render('en');
        expect(text).toContain('Checkout cancelled');
        expect(text).toContain('No payment was taken.');
        expect(text).toContain('Back to pricing');
        expect(text).toContain('My account');
        expect(text).toContain('Example Studio');
    });

    it('speaks Hindi to a member who chose it', async () => {
        const text = await render('hi');
        expect(text).toContain('चेकआउट रद्द हुआ');
        expect(text).not.toContain('Checkout cancelled');
    });
});
