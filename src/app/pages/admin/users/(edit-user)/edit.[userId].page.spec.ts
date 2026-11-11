/**
 * Edit User Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, Component, Input } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { Functions } from '@angular/fire/functions';

import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';

const m = vi.hoisted(() => ({
    calls: [] as Array<{ name: string; data: any }>,
    result: { value: { updated: true } as any },
}));
vi.mock('@angular/fire/functions', () => ({
    Functions: class {},
    httpsCallable: vi.fn((_f: unknown, name: string) => async (data: any) => {
        m.calls.push({ name, data });
        if (m.result.value instanceof Error) throw m.result.value;
        return { data: m.result.value };
    }),
}));

import EditUserComponent from './edit.[userId].page';
import { UserSettingService } from '../../(settings)/user-setting/user-setting.service';

/** Settings, User Settings as this page reads it: passwords for email accounts unless a test says PIN. */
const userSettings = { readSettings: vi.fn(async () => ({ isSignupEnabled: true, defaultRole: 'user' } as Record<string, unknown>)) };
import { UserStore } from '../user.store';
import { UserService } from '../user.service';
import { AuthState } from '../../../(auth)/auth.store';

/** The signed-in admin: their own record is not user-1 unless a test says so. */
const mockAuthState = { currentUser: vi.fn(() => ({ id: 'me-doc', uid: 'me-uid' }) as Record<string, string> | null) };
import { TranslocoPipe } from '@jsverse/transloco';
import { ToastService } from '../../../../../shared/services/toast.service';
import { GlobalService } from '../../../../../shared/services/global.service';

// Create a stub component to replace mat-slide-toggle
@Component({
    selector: 'mat-slide-toggle',
    standalone: true,
    template: '<ng-content></ng-content>',
})
class MockMatSlideToggle {
    @Input() checked: any;
}

describe('EditUserComponent', () => {
    let component: EditUserComponent;
    let fixture: ComponentFixture<EditUserComponent>;

    const mockUser = {
        id: 'user-1',
        name: 'Test User',
        email: 'test@example.com',
        status: 'Active',
        role: 'user',
        isActive: true,
    };

    const mockUserStore = {
        items: signal([mockUser]),
        currentItem: signal(mockUser),
        getById: vi.fn(),
        update: vi.fn().mockReturnValue(of({})),
    };

    const mockToastService = {
        success: vi.fn(),
        error: vi.fn(),
    };

    const mockUserService = {
        setRole: vi.fn(async (_id: string, role: string) => ({ role, changed: true })),
        setPhone: vi.fn(async (_id: string, phone: string) => ({ updated: true, phone })),
    };

    const mockGlobalService = {
        emailValidator: () => () => null,
        debugMode: false,
        showCurrentYear: () => 2025,
        convertToNormalString: (s: string) => s.replace(/([A-Z])/g, ' $1').trim(),
    };

    const mockRouter = {
        navigate: vi.fn(),
    };

    const mockActivatedRoute = {
        params: of({}),
        paramMap: of({ get: () => null }),
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [BrowserAnimationsModule],
            providers: [
                { provide: UserStore, useValue: mockUserStore },
                { provide: ToastService, useValue: mockToastService },
                { provide: GlobalService, useValue: mockGlobalService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: Functions, useValue: {} },
                { provide: UserSettingService, useValue: userSettings },
                { provide: UserService, useValue: mockUserService },
                { provide: AuthState, useValue: mockAuthState },
            ],
        })
            .overrideComponent(EditUserComponent, {
                set: {
                    imports: [MockMatSlideToggle, ReactiveFormsModule, CommonModule, TranslocoPipe],
                },
            })
            .compileComponents();

        fixture = TestBed.createComponent(EditUserComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Initialization', () => {
        it('should create the component', () => {
            expect(component).toBeTruthy();
        });

        it('should not show password field initially', () => {
            expect(component.isPasswordUpdateEnabled).toBe(false);
        });

        it('should have form with name and email controls', () => {
            expect(component.editForm.get('name')).toBeTruthy();
            expect(component.editForm.get('email')).toBeTruthy();
            expect(component.editForm.get('password')).toBeTruthy();
        });
    });

    describe('ID Input', () => {
        it('should call getById when id is set', () => {
            component.id = 'user-123';
            expect(mockUserStore.getById).toHaveBeenCalledWith('user-123');
        });

        it('should not call getById for empty id', () => {
            mockUserStore.getById.mockClear();
            component.id = '';
            expect(mockUserStore.getById).not.toHaveBeenCalled();
        });
    });

    describe('Form Validation', () => {
        it('should require name field', () => {
            component.editForm.get('name')?.setValue('');
            component.editForm.get('name')?.markAsTouched();
            expect(component.editForm.get('name')?.errors?.['required']).toBeTruthy();
        });

        it('should require email field', () => {
            component.editForm.get('email')?.setValue('');
            component.editForm.get('email')?.markAsTouched();
            expect(component.editForm.get('email')?.errors?.['required']).toBeTruthy();
        });

        it('should not require password by default', () => {
            component.editForm.get('password')?.setValue('');
            expect(component.editForm.get('password')?.errors).toBeNull();
        });
    });

    describe('Password Toggle', () => {
        it('should enable password validation when toggle is on', () => {
            component.showPasswordInput({ checked: true });

            expect(component.isPasswordUpdateEnabled).toBe(true);

            component.editForm.get('password')?.setValue('');
            component.editForm.get('password')?.markAsTouched();
            expect(component.editForm.get('password')?.errors?.['required']).toBeTruthy();
        });

        it('holds a new password to the password rule, with the person\'s name and email', () => {
            component.editForm.patchValue({ name: 'Asha Rao', email: 'asha@example.com' });
            component.showPasswordInput({ checked: true });
            for (const [password, problem] of [['short', 'short'], ['12345678', 'sequence'], ['password123', 'common'], ['Asha@2024', 'personal']]) {
                component.editForm.get('password')?.setValue(password);
                expect(component.editForm.get('password')?.errors?.['password']).toBe(problem);
            }
            expect(component.passwordError()).toBe('The password should not contain their name or email. Choose another.');
            component.editForm.get('password')?.setValue('Monsoon-Train-42');
            expect(component.editForm.get('password')?.errors).toBeNull();
        });

        it('should disable password validation when toggle is off', () => {
            component.showPasswordInput({ checked: true });
            component.showPasswordInput({ checked: false });

            expect(component.isPasswordUpdateEnabled).toBe(false);
            expect(component.editForm.get('password')?.errors).toBeNull();
        });
    });

    describe('Form Submission', () => {
        const flush = () => new Promise((r) => setTimeout(r));
        beforeEach(() => {
            component.id = 'user-1';
            component.editForm.setValue({
                name: 'Updated Name',
                email: 'updated@example.com',
                password: '',
                confirmPassword: '',
                role: 'user',
            });
            mockUserStore.update.mockClear();
            mockUserService.setRole.mockClear();
        });

        it('should not submit invalid form', () => {
            component.editForm.get('name')?.setValue('');
            component.onSubmit();
            expect(mockUserStore.update).not.toHaveBeenCalled();
        });

        it('should submit valid form without password', () => {
            component.onSubmit();
            expect(mockUserStore.update).toHaveBeenCalledWith('user-1', {
                name: 'Updated Name',
                email: 'updated@example.com',
            });
        });

        it('sets a new password through adminSetPassword, never in the record', async () => {
            m.calls.length = 0;
            m.result.value = { updated: true };
            mockToastService.success.mockClear();
            component.showPasswordInput({ checked: true });
            component.editForm.get('password')?.setValue('Monsoon-Train-42');
            component.editForm.get('confirmPassword')?.setValue('Monsoon-Train-42');

            component.onSubmit();
            await flush();

            expect(m.calls).toEqual([{ name: 'arccms-adminSetPassword', data: { id: 'user-1', password: 'Monsoon-Train-42' } }]);
            expect(mockUserStore.update).toHaveBeenCalledWith('user-1', { name: 'Updated Name', email: 'updated@example.com' });
            expect(JSON.stringify(mockUserStore.update.mock.calls)).not.toContain('password');
            expect(mockToastService.success).toHaveBeenCalledWith('User updated. Share the new password with them.');
        });

        it('sends no password while the two typed differ', async () => {
            m.calls.length = 0;
            component.showPasswordInput({ checked: true });
            component.editForm.get('password')?.setValue('Monsoon-Train-42');
            component.editForm.get('confirmPassword')?.setValue('Monsoon-Train-24');

            component.onSubmit();
            await flush();

            expect(m.calls).toHaveLength(0);
            expect(mockUserStore.update).not.toHaveBeenCalled();
            expect(component.errorMessages.join(' ')).toMatch(/confirm ?password does not match\./i);
        });

        it('saves nothing when the server refuses the password, and says why', async () => {
            m.calls.length = 0;
            // The server's English never shows: the reason and the problem pick the admin's words.
            m.result.value = Object.assign(new Error('Server English'), { code: 'functions/invalid-argument', details: { reason: 'weak-password', problem: 'common', min: 8 } });
            mockToastService.error.mockClear();
            component.showPasswordInput({ checked: true });
            component.editForm.get('password')?.setValue('Monsoon-Train-42');
            component.editForm.get('confirmPassword')?.setValue('Monsoon-Train-42');

            component.onSubmit();
            await flush();

            expect(m.calls).toHaveLength(1);
            expect(mockUserStore.update).not.toHaveBeenCalled();
            expect(mockToastService.error).toHaveBeenCalledWith('That password is one of the most used, so it is easy to guess. Choose another.');
            expect(component.saving()).toBe(false);
            m.result.value = { updated: true };
        });

        it('says the password is set when only the other changes fail', async () => {
            m.calls.length = 0;
            mockToastService.error.mockClear();
            mockUserStore.update.mockReturnValueOnce(throwError(() => new Error('denied')));
            component.showPasswordInput({ checked: true });
            component.editForm.get('password')?.setValue('Monsoon-Train-42');
            component.editForm.get('confirmPassword')?.setValue('Monsoon-Train-42');

            component.onSubmit();
            await flush();

            expect(mockToastService.error).toHaveBeenCalledWith('The password is set, but the other changes were not saved.');
        });

        it('does not call adminSetPassword without the toggle', async () => {
            m.calls.length = 0;
            component.onSubmit();
            await flush();
            expect(m.calls).toEqual([]);
        });

        it('should show success toast on successful update', () => {
            mockToastService.success.mockClear();
            component.onSubmit();
            expect(mockToastService.success).toHaveBeenCalledWith('User updated.');
            expect(mockUserService.setRole).not.toHaveBeenCalled();
        });

        it('makes a second admin through adminSetUserRole, never in the record (RF4)', async () => {
            component.editForm.get('role')?.setValue('admin');
            component.onSubmit();
            await flush();
            expect(mockUserService.setRole).toHaveBeenCalledWith('user-1', 'admin');
            expect(mockUserStore.update).toHaveBeenCalledWith('user-1', { name: 'Updated Name', email: 'updated@example.com' });
            expect(JSON.stringify(mockUserStore.update.mock.calls)).not.toContain('role');
        });

        it('saves nothing when the server refuses the role, and says why', async () => {
            mockToastService.error.mockClear();
            mockUserService.setRole.mockRejectedValueOnce(Object.assign(new Error('x'), { details: { reason: 'unverified-account' } }));
            component.editForm.get('role')?.setValue('admin');
            component.onSubmit();
            await flush();
            expect(mockUserStore.update).not.toHaveBeenCalled();
            expect(mockToastService.error).toHaveBeenCalledWith(expect.stringContaining('never verified'));
            expect(component.saving()).toBe(false);
            mockUserService.setRole.mockRejectedValueOnce(Object.assign(new Error('x'), { details: { reason: 'last-admin' } }));
            component.onSubmit();
            await flush();
            expect(mockToastService.error).toHaveBeenLastCalledWith('This is the only active admin. Make someone else an admin first.');
        });

        it('sets the password before the role, so a raise the password makes safe goes through (RF4, H2)', async () => {
            m.calls.length = 0;
            m.result.value = { updated: true };
            const order: string[] = [];
            mockUserService.setRole.mockImplementationOnce(async (_id: string, role: string) => {
                order.push(`role:${m.calls.map((c) => c.name).join(',')}`);
                return { role, changed: true };
            });
            component.showPasswordInput({ checked: true });
            component.editForm.get('password')?.setValue('Monsoon-Train-42');
            component.editForm.get('confirmPassword')?.setValue('Monsoon-Train-42');
            component.editForm.get('role')?.setValue('admin');
            component.onSubmit();
            await flush();
            expect(order).toEqual(['role:arccms-adminSetPassword']);
            expect(mockUserStore.update).toHaveBeenCalled();
        });

        it('says the password is set when the role is then refused (L6)', async () => {
            m.calls.length = 0;
            m.result.value = { updated: true };
            mockToastService.error.mockClear();
            mockUserService.setRole.mockRejectedValueOnce(Object.assign(new Error('x'), { details: { reason: 'last-admin' } }));
            component.showPasswordInput({ checked: true });
            component.editForm.get('password')?.setValue('Monsoon-Train-42');
            component.editForm.get('confirmPassword')?.setValue('Monsoon-Train-42');
            component.editForm.get('role')?.setValue('admin');
            component.onSubmit();
            await flush();
            expect(mockToastService.error).toHaveBeenCalledWith('The password is set, but the role was not changed. This is the only active admin. Make someone else an admin first.');
            expect(mockUserStore.update).not.toHaveBeenCalled();
        });
    });

    describe('Role and phone number (RF4, 4.8 and 4.16)', () => {
        const fill = (record: Record<string, unknown>) =>
            (component as unknown as { updateFormData: (u: unknown) => void }).updateFormData({ ...mockUser, ...record });
        const flush = () => new Promise((r) => setTimeout(r));

        it('offers the known roles, keeping one the record has outside them, and none for a locked app account', () => {
            fill({ role: 'admin' });
            expect(component.roleOptions()).toEqual(['admin', 'user']);
            expect(component.editForm.get('role')?.value).toBe('admin');
            expect(component.roleName('admin')).toBe('Admin');
            fill({ role: 'propertyOwner' });
            expect(component.roleOptions()).toEqual(['admin', 'user', 'propertyOwner']);
            expect(component.canSetRole()).toBe(true);
            fill({ by: 'app' });
            expect(component.canSetRole()).toBe(false);
        });

        it('offers no role choice on your own record, and says why (M4)', () => {
            fill({ uid: 'me-uid' });
            expect(component.ownRecord()).toBe(true);
            expect(component.canSetRole()).toBe(false);
            fixture.detectChanges();
            expect(fixture.nativeElement.querySelector('select#role')).toBeNull();
            expect(fixture.nativeElement.textContent).toContain('Another admin can change your role.');
            // Saving your own record never sends a role.
            component.editForm.get('role')?.setValue('user');
            mockUserService.setRole.mockClear();
            component.onSubmit();
            expect(mockUserService.setRole).not.toHaveBeenCalled();
            fill({ uid: 'someone' });
            expect(component.ownRecord()).toBe(false);
        });

        it('names a role it has no translation for in plain words (L5)', () => {
            expect(component.roleName('propertyOwner')).toBe('Property owner');
            expect(component.roleName('facilityManager')).toBe('Facility manager');
        });

        it('shows the role choice in the form', () => {
            fill({});
            fixture.detectChanges();
            const select = fixture.nativeElement.querySelector('select#role') as HTMLSelectElement;
            expect(select).toBeTruthy();
            expect([...select.options].map((o) => o.textContent?.trim())).toEqual(['Admin', 'User']);
        });

        it('offers a new number for a member with one and a sign-in of Arc CMS\'s own', () => {
            fill({ uid: 'uid-1', phone: '+919876543210' });
            expect(component.canSetPhone()).toBe(true);
            expect(component.currentPhone()).toBe('+919876543210');
            fill({ uid: 'uid-1', phone: '' });
            expect(component.canSetPhone()).toBe(false);
            fill({ uid: 'uid-1', phone: '+919876543210', authOwner: 'shared' });
            expect(component.canSetPhone()).toBe(false);
            fill({ uid: 'uid-1', phone: '+919876543210', by: 'app' });
            expect(component.canSetPhone()).toBe(false);
        });

        it('changes the number through adminSetPhone and says what happens next', async () => {
            component.id = 'user-1';
            fill({ uid: 'uid-1', phone: '+919876543210' });
            mockToastService.success.mockClear();
            component.openPhone();
            component.newPhone.setValue('98765 11111');
            await component.savePhone();
            expect(mockUserService.setPhone).toHaveBeenCalledWith('user-1', '98765 11111');
            expect(component.currentPhone()).toBe('98765 11111');
            expect(component.phoneOpen()).toBe(false);
            expect(mockToastService.success).toHaveBeenCalledWith(expect.stringContaining('code'));
        });

        it('keeps the box open with the reason when the server refuses the number', async () => {
            component.id = 'user-1';
            fill({ uid: 'uid-1', phone: '+919876543210' });
            component.openPhone();
            component.newPhone.setValue('98765 11111');
            mockUserService.setPhone.mockRejectedValueOnce(Object.assign(new Error('x'), { details: { reason: 'number-taken' } }));
            await component.savePhone();
            expect(component.phoneOpen()).toBe(true);
            expect(component.phoneError()).toBe('This number is already on another account.');
            mockUserService.setPhone.mockRejectedValueOnce(Object.assign(new Error('x'), { details: { reason: 'country-not-allowed', codes: '+91' } }));
            await component.savePhone();
            expect(component.phoneError()).toBe('Only numbers starting +91 can be used here.');
            component.newPhone.setValue('');
            mockUserService.setPhone.mockClear();
            await component.savePhone();
            expect(mockUserService.setPhone).not.toHaveBeenCalled();
            await flush();
        });
    });

    describe('Close Action', () => {
        it('should emit close event and reset form', () => {
            const closeSpy = vi.spyOn(component.close, 'emit');

            component.editForm.setValue({
                name: 'Test',
                email: 'test@test.com',
                password: '',
                confirmPassword: '',
                role: 'user',
            });

            component.closeEdit();

            expect(closeSpy).toHaveBeenCalled();
        });
    });

    describe('Filling the form', () => {
        it('fills the form when this user\'s record arrives', () => {
            component.id = 'user-1';
            mockUserStore.currentItem.set({ ...mockUser, name: 'Fresh Name' });
            fixture.detectChanges();
            expect(component.editForm.value.name).toBe('Fresh Name');
            expect(component.editForm.value.email).toBe('test@example.com');
        });

        it('ignores another user\'s record still in the store', () => {
            component.id = 'user-9';
            mockUserStore.currentItem.set({ ...mockUser, name: 'Someone Else' });
            fixture.detectChanges();
            expect(component.editForm.value.name).not.toBe('Someone Else');
        });
    });

    describe('Who can be given a password here', () => {
        const fill = (record: Record<string, unknown>) =>
            (component as unknown as { updateFormData: (u: unknown) => void }).updateFormData({ ...mockUser, ...record });

        it('offers it for a person with an email whose sign-in is Arc CMS\'s own', () => {
            fill({});
            expect(component.canSetPassword()).toBe(true);
            fill({ authOwner: 'arccms' });
            expect(component.canSetPassword()).toBe(true);
            fill({ by: 'app', selfService: true });
            expect(component.canSetPassword()).toBe(true);
        });

        it('says why not for a shared sign-in or a locked app account, and hides it with no email', () => {
            fill({ authOwner: 'shared' });
            expect(component.canSetPassword()).toBe(false);
            expect(component.passwordElsewhere()).toBe('admin.users.password_elsewhere.shared');
            fill({ by: 'app' });
            expect(component.canSetPassword()).toBe(false);
            expect(component.passwordElsewhere()).toBe('admin.users.password_elsewhere.app_managed');
            fill({ email: '' });
            expect(component.canSetPassword()).toBe(false);
            expect(component.passwordElsewhere()).toBe('');
        });

        it('says why not for a member while the site signs email accounts in with a PIN; an admin keeps one (specs/sign-in-pin-spec.md)', () => {
            (component as unknown as { emailPin: { set: (v: boolean) => void } }).emailPin.set(true);
            fill({ role: 'user' });
            expect(component.canSetPassword()).toBe(false);
            expect(component.passwordElsewhere()).toBe('admin.users.password_elsewhere.pin');
            fill({ role: 'admin' });
            expect(component.canSetPassword()).toBe(true);
        });
    });

    describe('Duplicate Email Detection', () => {
        it('should detect duplicate email excluding current user', () => {
            // Add another user with different id
            mockUserStore.items.set([
                mockUser,
                { id: 'user-2', email: 'other@example.com', name: 'Other User' },
            ]);

            component.id = 'user-1';
            component.editForm.get('email')?.setValue('other@example.com');

            // Trigger value change
            fixture.detectChanges();

            // The alreadyExist should be set
            expect(component.alreadyExist).toBeTruthy();
        });
    });

    describe('A person with no email (an app account, docs/app/app-accounts.html)', () => {
        const appAccount = { id: 'user-2', name: 'Anna', email: '', phone: '', by: 'app', status: 'Active', role: 'user', isActive: true };

        it('saves without an email, and never calls an empty email a duplicate', () => {
            mockUserStore.items.set([mockUser, appAccount, { ...appAccount, id: 'user-3', name: 'Ben' }] as never);
            (component as unknown as { updateFormData: (u: unknown) => void }).updateFormData(appAccount);
            expect(component.emailRequired()).toBe(false);
            component.editForm.patchValue({ name: 'Anna K', email: '' });
            expect(component.editForm.valid).toBe(true);
            expect(component.alreadyExist).toBeUndefined();
        });

        it('still needs an email for a person who has one', () => {
            (component as unknown as { updateFormData: (u: unknown) => void }).updateFormData(mockUser);
            expect(component.emailRequired()).toBe(true);
            component.editForm.patchValue({ email: '' });
            expect(component.editForm.get('email')?.errors?.['required']).toBe(true);
        });
    });
});
