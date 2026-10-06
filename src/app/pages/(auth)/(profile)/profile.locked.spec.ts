/**
 * The profile of a locked app account (docs/app/app-accounts.html) is read-only: no
 * photo or name change, no sign-in methods, no password, no delete. An ordinary
 * account, and an app account made with `selfService: true`, see it as before.
 */
import { Component } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { provideNoopAnimations } from '@angular/platform-browser/animations';
import { MatDialog } from '@angular/material/dialog';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ProfileComponent from './profile.page';
import { SignInMethodsComponent } from './sign-in-methods.component';
import { AuthState } from '../auth.store';
import { SignInService } from '../sign-in.service';
import { FileUploadService } from '../../../../shared/services/file-upload.service';
import { headerTestProviders } from '../../../../test/header-test-providers';
import { translocoTestingModule } from '../../../../test/transloco-test-providers';

@Component({ selector: 'arc-sign-in-methods', standalone: true, template: '<p>sign-in methods card</p>' })
class SignInMethodsStub {}

describe('ProfileComponent for a locked app account', () => {
    let fixture: ComponentFixture<ProfileComponent>;
    const user = vi.fn();
    const signIn = { hasPassword: vi.fn(() => true), deleteMyAccount: vi.fn() };

    async function render(record: Record<string, unknown>) {
        user.mockReturnValue({ id: 'doc-1', uid: 'uid-1', name: 'Anna', role: 'user', isActive: true, photo: 'https://example.com/a.png', ...record });
        TestBed.resetTestingModule();
        await TestBed.configureTestingModule({
            imports: [ProfileComponent, translocoTestingModule()],
            providers: [
                ...headerTestProviders(),
                provideRouter([]),
                provideNoopAnimations(),
                { provide: AuthState, useValue: { currentUser: user, isAdmin: () => false, updateUserProfile: vi.fn(), isSuccess: () => true, error: () => '' } },
                { provide: SignInService, useValue: signIn },
                { provide: MatDialog, useValue: { open: vi.fn() } },
                { provide: FileUploadService, useValue: { uploadAvatar: vi.fn() } },
            ],
        })
            .overrideComponent(ProfileComponent, { remove: { imports: [SignInMethodsComponent] }, add: { imports: [SignInMethodsStub] } })
            .compileComponents();
        fixture = TestBed.createComponent(ProfileComponent);
        fixture.detectChanges();
        return fixture.nativeElement as HTMLElement;
    }

    beforeEach(() => vi.clearAllMocks());

    it('shows every field read-only, with one line saying why', async () => {
        const page = await render({ by: 'app' });
        const text = page.textContent ?? '';
        expect(text).toContain('Anna');
        expect(text).toContain('This account is managed for you');
        expect(text).not.toContain('sign-in methods card');
        expect(text).not.toContain('Change Photo');
        expect(text).not.toContain('Delete my account');
        expect(page.querySelector('.avatar-overlay')).toBeNull();
        expect([...page.querySelectorAll('button')].map((b) => b.textContent?.trim())).not.toContain('Edit');
        // Even with a password on the sign-in account, there is no password form.
        expect(text).not.toContain('Change Password');
    });

    it('opens no photo picker and no name form, whatever is clicked', async () => {
        await render({ by: 'app' });
        const component = fixture.componentInstance;
        const click = vi.fn();
        component.openPhotoSelector({ click } as unknown as HTMLInputElement);
        component.editName();
        expect(click).not.toHaveBeenCalled();
        expect(component.isEditingName()).toBe(false);
        expect(component.canDeleteAccount()).toBe(false);
    });

    it.each([
        ['an ordinary account', { by: 'email' }],
        ['an app account made with selfService: true', { by: 'app', selfService: true }],
    ])('is unchanged for %s', async (_name, record) => {
        const page = await render(record);
        const text = page.textContent ?? '';
        expect(text).not.toContain('This account is managed for you');
        expect(text).toContain('sign-in methods card');
        expect(text).toContain('Delete my account');
        expect(page.querySelector('.avatar-overlay')).not.toBeNull();
        expect(fixture.componentInstance.canDeleteAccount()).toBe(true);
    });
});
