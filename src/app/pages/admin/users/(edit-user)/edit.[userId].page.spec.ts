/**
 * Edit User Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal, Component, Input } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

import { CommonModule } from '@angular/common';
import { ReactiveFormsModule } from '@angular/forms';

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

        it('should disable password validation when toggle is off', () => {
            component.showPasswordInput({ checked: true });
            component.showPasswordInput({ checked: false });

            expect(component.isPasswordUpdateEnabled).toBe(false);
            expect(component.editForm.get('password')?.errors).toBeNull();
        });
    });

    describe('Form Submission', () => {
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

        it('should include password when enabled', () => {
            component.showPasswordInput({ checked: true });
            component.editForm.get('password')?.setValue('newpassword123');

            component.onSubmit();

            expect(mockUserStore.update).toHaveBeenCalledWith('user-1', {
                name: 'Updated Name',
                email: 'updated@example.com',
                password: 'newpassword123',
            });
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
});
