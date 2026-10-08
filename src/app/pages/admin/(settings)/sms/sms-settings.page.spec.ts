/**
 * Settings, SMS: the phone sign-in switch lives in User Settings, so this page says
 * whether phone sign-in is on and links there. With the Test provider it also has the
 * "Show PIN reset codes on screen" switch, off unless the admin turns it on.
 */
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { SmsSettingsPage } from './sms-settings.page';
import { DEFAULT_SMS_FORM, SmsSettingsForm, SmsSettingsService } from './sms-settings.service';
import { translocoTestingModule } from '../../../../../test/transloco-test-providers';

async function render(phoneSignIn: boolean, form: Partial<SmsSettingsForm> = {}) {
    const service = {
        load: vi.fn(async () => ({ form: { ...DEFAULT_SMS_FORM, ...form }, hasAuthKey: false, phoneSignIn })),
        save: vi.fn(),
        sendTest: vi.fn(),
    };
    await TestBed.configureTestingModule({
        imports: [SmsSettingsPage, translocoTestingModule()],
        providers: [provideRouter([]), { provide: SmsSettingsService, useValue: service }],
    }).compileComponents();
    const fixture = TestBed.createComponent(SmsSettingsPage);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
}

describe('SmsSettingsPage', () => {
    it('says phone sign-in is on, and links to its switch in User Settings', async () => {
        const page = await render(true);
        const status = page.querySelector('.phone-status');
        expect(status?.textContent).toContain('Phone sign-in is on.');
        expect(status?.querySelector('a')?.getAttribute('href')).toBe('/admin/settings/user');
    });

    it('says phone sign-in is off', async () => {
        const page = await render(false);
        expect(page.querySelector('.phone-status')?.textContent).toContain('Phone sign-in is off.');
    });

    it('offers to show PIN reset codes in test mode, off by default, with the risk spelled out', async () => {
        const page = await render(true);
        const toggle = page.querySelector<HTMLInputElement>('#smsShowResetCodes');
        expect(toggle?.checked).toBe(false);
        expect(page.querySelector('.reset-codes')?.textContent).toContain('Show PIN reset codes on screen');
        expect(page.querySelector('.reset-codes')?.textContent).toContain('take over the account');
    });

    it('shows the saved choice', async () => {
        const page = await render(true, { showResetCodes: true });
        await new Promise((r) => setTimeout(r));
        expect(page.querySelector<HTMLInputElement>('#smsShowResetCodes')?.checked).toBe(true);
    });

    it('has no reset code switch with a real provider', async () => {
        const page = await render(true, { provider: 'msg91' });
        expect(page.querySelector('#smsShowResetCodes')).toBeNull();
    });

    it('lists the allowed countries, with no default to choose when there is one', async () => {
        const page = await render(true);
        expect([...page.querySelectorAll('.countries .picked-country')].map((li) => li.getAttribute('data-iso'))).toEqual(['IN']);
        expect(page.querySelector('.countries .picked-country button')).toBeNull();
        expect(page.querySelector('#smsDefaultCountry')).toBeNull();
    });

    it('offers the allowed countries as the default when there are several', async () => {
        const page = await render(true, { allowedCountries: ['IN', 'GB'], defaultCountry: 'GB' });
        const options = [...page.querySelectorAll<HTMLOptionElement>('#smsDefaultCountry option')].map((o) => o.textContent?.trim());
        expect(options).toEqual(['India (+91)', 'United Kingdom (+44)']);
    });

    it('moves the default to the first country left when the admin removes it', async () => {
        TestBed.resetTestingModule();
        const service = { load: vi.fn(async () => ({ form: { ...DEFAULT_SMS_FORM, allowedCountries: ['IN', 'GB'], defaultCountry: 'GB' }, hasAuthKey: false, phoneSignIn: true })), save: vi.fn(), sendTest: vi.fn() };
        await TestBed.configureTestingModule({
            imports: [SmsSettingsPage, translocoTestingModule()],
            providers: [provideRouter([]), { provide: SmsSettingsService, useValue: service }],
        }).compileComponents();
        const fixture = TestBed.createComponent(SmsSettingsPage);
        fixture.detectChanges();
        await fixture.whenStable();
        fixture.detectChanges();
        const page = fixture.nativeElement as HTMLElement;
        page.querySelector<HTMLButtonElement>('.picked-country[data-iso="GB"] button')!.click();
        fixture.detectChanges();
        expect(fixture.componentInstance.form()).toMatchObject({ allowedCountries: ['IN'], defaultCountry: 'IN' });
        expect(page.querySelector('#smsDefaultCountry')).toBeNull();
        page.querySelector<HTMLButtonElement>('.btn-primary')!.click();
        expect(service.save).toHaveBeenCalledWith(expect.objectContaining({ allowedCountries: ['IN'], defaultCountry: 'IN' }));
    });
});
