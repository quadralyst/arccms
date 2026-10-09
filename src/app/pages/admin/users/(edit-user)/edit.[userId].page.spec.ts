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
import { UserStore } from '../user.store';
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
            ],
        })
            .overrideComponent(EditUserComponent, {
                set: {
                    imports: [MockMatSlideToggle, ReactiveFormsModule, CommonModule],
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
            expect(component.passwordError()).toBe('Your password should not contain your name or email. Choose another.');
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
            });
            mockUserStore.update.mockClear();
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

            component.onSubmit();
            await flush();

            expect(m.calls).toEqual([{ name: 'arccms-adminSetPassword', data: { id: 'user-1', password: 'Monsoon-Train-42' } }]);
            expect(mockUserStore.update).toHaveBeenCalledWith('user-1', { name: 'Updated Name', email: 'updated@example.com' });
            expect(JSON.stringify(mockUserStore.update.mock.calls)).not.toContain('password');
            expect(mockToastService.success).toHaveBeenCalledWith('User updated. Share the new password with them.');
        });

        it('saves nothing when the server refuses the password, and says why', async () => {
            m.calls.length = 0;
            m.result.value = Object.assign(new Error('That password is one of the most used, so it is easy to guess. Choose another.'), { code: 'functions/invalid-argument' });
            mockToastService.error.mockClear();
            component.showPasswordInput({ checked: true });
            component.editForm.get('password')?.setValue('Monsoon-Train-42');

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
            expect(mockToastService.success).toHaveBeenCalledWith('User updated successfully.');
        });
    });

    describe('Close Action', () => {
        it('should emit close event and reset form', () => {
            const closeSpy = vi.spyOn(component.close, 'emit');

            component.editForm.setValue({
                name: 'Test',
                email: 'test@test.com',
                password: '',
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
            expect(component.passwordElsewhere()).toContain('shared with another app');
            fill({ by: 'app' });
            expect(component.canSetPassword()).toBe(false);
            expect(component.passwordElsewhere()).toContain('managed by the app');
            fill({ email: '' });
            expect(component.canSetPassword()).toBe(false);
            expect(component.passwordElsewhere()).toBe('');
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
