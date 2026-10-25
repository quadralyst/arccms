/**
 * Changing the password on the profile (F22): the new one meets the password rule
 * (src/shared/utils/password-rule.ts) and the page says why one is refused.
 */
import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { describe, expect, it, vi } from 'vitest';
import ProfileComponent from './profile.page';
import { SignInMethodsComponent } from './sign-in-methods.component';
import { AuthState } from '../auth.store';
import { SignInService } from '../sign-in.service';
import { UserSettingService } from '../../admin/(settings)/user-setting/user-setting.service';
import { FileUploadService } from '../../../../shared/services/file-upload.service';
import { headerTestProviders } from '../../../../test/header-test-providers';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';

@Component({ selector: 'arc-sign-in-methods', standalone: true, template: '' })
class SignInMethodsStub {}

async function render(settings: Record<string, unknown> = {}, role = 'user'): Promise<ProfileComponent> {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
        imports: [ProfileComponent, translocoTestingModule()],
        providers: [
            ...headerTestProviders(),
            provideRouter([]),
            provideNoopAnimations(),
            { provide: AuthState, useValue: {
                currentUser: () => ({ id: 'doc-1', uid: 'uid-1', name: 'Anna Berg', email: 'anna.berg@example.com', role, isActive: true }),
                isAdmin: () => false, updateUserProfile: vi.fn(), isSuccess: () => true, error: () => '',
            } },
            { provide: SignInService, useValue: { hasPassword: () => true, deleteMyAccount: vi.fn() } },
            // Settings, User Settings as read by the page: passwords for email accounts.
            { provide: UserSettingService, useValue: { readSettings: vi.fn(async () => ({ isSignupEnabled: true, defaultRole: 'user', ...settings })) } },
            { provide: MatDialog, useValue: { open: vi.fn() } },
            { provide: FileUploadService, useValue: { uploadAvatar: vi.fn() } },
        ],
    })
        .overrideComponent(ProfileComponent, { remove: { imports: [SignInMethodsComponent] }, add: { imports: [SignInMethodsStub] } })
        .compileComponents();
    const fixture = TestBed.createComponent(ProfileComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
}

describe('ProfileComponent: a new password (F22)', () => {
    it('refuses one too easy to guess, saying why', async () => {
        const page = await render();
        const field = page.passwordForm.get('newPassword')!;
        for (const [password, problem] of [['short', 'short'], ['abcdefgh', 'sequence'], ['Password1', 'common'], ['AnnaBerg77', 'personal']]) {
            field.setValue(password);
            expect(field.errors?.['password'], password).toBe(problem);
            expect(page.newPasswordErrorKey()).toBe(`member.auth.password_error.${problem}`);
        }
        field.setValue('Monsoon-Train-42');
        expect(field.valid).toBe(true);
    });
});

describe('ProfileComponent: the password section with email PIN sign-in (specs/sign-in-pin-spec.md)', () => {
    // Firebase keeps the email's password entry on an account whose password was taken
    // off, so the browser alone would still offer Change password.
    it('hides it for a member while the site signs email accounts in with a PIN', async () => {
        const page = await render({ emailSignIn: 'pin' });
        await vi.waitFor(() => expect(page.hasPassword()).toBe(false));
    });

    it('keeps it for an admin, and for everyone while the site uses passwords', async () => {
        const admin = await render({ emailSignIn: 'pin' }, 'admin');
        await new Promise((r) => setTimeout(r));
        expect(admin.hasPassword()).toBe(true);
        const member = await render({ emailSignIn: 'password' });
        await new Promise((r) => setTimeout(r));
        expect(member.hasPassword()).toBe(true);
    });
});
