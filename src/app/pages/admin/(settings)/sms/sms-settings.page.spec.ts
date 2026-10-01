/**
 * Settings, SMS: the phone sign-in switch lives in User Settings, so this page says
 * whether phone sign-in is on and links there.
 */
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, vi } from 'vitest';
import { SmsSettingsPage } from './sms-settings.page';
import { DEFAULT_SMS_FORM, SmsSettingsService } from './sms-settings.service';
import { translocoTestingModule } from '../../../../../test/transloco-test-providers';

async function render(phoneSignIn: boolean) {
    const service = {
        load: vi.fn(async () => ({ form: { ...DEFAULT_SMS_FORM }, hasAuthKey: false, phoneSignIn })),
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
});
