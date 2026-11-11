import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import NotificationsPageComponent from './notifications.page';
import { AuthState } from '../(auth)/auth.store';
import { NotificationService } from '../../../shared/services/notification.service';
import { ToastService } from '../../../shared/services/toast.service';
import { headerTestProviders } from '../../../test/header-test-providers';
import { translocoTestingModule } from '../../../test/transloco-test-providers';
import { Component } from '@angular/core';
import { UserShellComponent } from '../user/user-shell.component';

@Component({ selector: 'app-user-shell', standalone: true, template: '<ng-content></ng-content>' })
class UserShellStub {}

/** The notifications page as a member sees it, in their language (RF6 6.9); the member menu around it is a stub. */
async function render(lang: string) {
    TestBed.resetTestingModule();
    // With no member languages declared, member pages follow the person's chosen language on this device.
    localStorage.setItem('arc-admin-lang', lang);
    const toast = { success: vi.fn(), error: vi.fn() };
    const service = {
        watch: () => of([{ id: 'n1', title: 'Your order shipped', body: 'It arrives Friday.', read: false, link: '/orders/1' }]),
        markRead: vi.fn(async () => undefined),
        markAllRead: vi.fn(async () => undefined),
        getMyPrefs: async () => ({ data: { types: [{ key: 'orders', label: 'Orders', description: 'When an order changes' }], prefs: {} } }),
        updatePrefs: vi.fn(async () => undefined),
    };
    await TestBed.configureTestingModule({
        imports: [NotificationsPageComponent, translocoTestingModule({ lang })],
        providers: [
            ...headerTestProviders(),
            provideRouter([]),
            provideNoopAnimations(),
            { provide: AuthState, useValue: { currentUser: () => ({ uid: 'u1', role: 'user' }), isAdmin: () => false } },
            { provide: NotificationService, useValue: service },
            { provide: ToastService, useValue: toast },
        ],
    })
        .overrideComponent(NotificationsPageComponent, { remove: { imports: [UserShellComponent] }, add: { imports: [UserShellStub] } })
        .compileComponents();
    const fixture = TestBed.createComponent(NotificationsPageComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return { fixture, toast, text: () => fixture.nativeElement.textContent as string };
}

describe('NotificationsPageComponent', () => {
    it('says its own words in the reader\'s language, and the notifications as written', async () => {
        const { text } = await render('hi');
        expect(text()).toContain('सभी को पढ़ा हुआ करें');
        expect(text()).toContain('ईमेल प्राथमिकताएँ');
        expect(text()).toContain('Your order shipped');
        expect(text()).not.toMatch(/Mark all|Email preferences|Save preferences/);
    });

    it('confirms in words, not a code', async () => {
        const { fixture, toast } = await render('en');
        await fixture.componentInstance.markAllRead();
        expect(toast.success).toHaveBeenCalledWith('All notifications marked as read.');
        await fixture.componentInstance.savePrefs();
        expect(toast.success).toHaveBeenLastCalledWith('Preferences saved.');
    });
});
