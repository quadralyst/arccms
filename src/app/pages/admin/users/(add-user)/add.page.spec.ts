/**
 * Add User Component Tests
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { BrowserAnimationsModule } from '@angular/platform-browser/animations';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';

import AddUserComponent from './add.page';
import { UserStore } from '../user.store';
import { ToastService } from '../../../../../shared/services/toast.service';
import { GlobalService } from '../../../../../shared/services/global.service';

describe('AddUserComponent', () => {
    let component: AddUserComponent;
    let fixture: ComponentFixture<AddUserComponent>;

    const mockUserStore = {
        items: signal([
            { id: 'existing-user', email: 'existing@example.com', name: 'Existing User' },
        ]),
        add: vi.fn().mockReturnValue(of({ id: 'new-user-id' })),
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
            imports: [AddUserComponent, BrowserAnimationsModule],
            providers: [
                { provide: UserStore, useValue: mockUserStore },
                { provide: ToastService, useValue: mockToastService },
                { provide: GlobalService, useValue: mockGlobalService },
                { provide: Router, useValue: mockRouter },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(AddUserComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Initialization', () => {
        it('should create the component', () => {
            expect(component).toBeTruthy();
        });

        it('should initialize with empty form', () => {
            expect(component.addForm.get('name')?.value).toBe('');
            expect(component.addForm.get('email')?.value).toBe('');
            expect(component.addForm.get('password')?.value).toBe('');
        });

        it('should have empty error messages initially', () => {
            expect(component.errorMessages).toEqual([]);
        });
    });

    describe('Form Validation', () => {
        it('should require name field', () => {
            component.addForm.get('name')?.setValue('');
            component.addForm.get('name')?.markAsTouched();
            expect(component.addForm.get('name')?.errors?.['required']).toBeTruthy();
        });

        it('should require email field', () => {
            component.addForm.get('email')?.setValue('');
            component.addForm.get('email')?.markAsTouched();
            expect(component.addForm.get('email')?.errors?.['required']).toBeTruthy();
        });

        it('should require password field', () => {
            component.addForm.get('password')?.setValue('');
            component.addForm.get('password')?.markAsTouched();
            expect(component.addForm.get('password')?.errors?.['required']).toBeTruthy();
        });

        it('should require password minimum length of 8', () => {
            component.addForm.get('password')?.setValue('short');
            component.addForm.get('password')?.markAsTouched();
            expect(component.addForm.get('password')?.errors?.['minlength']).toBeTruthy();
        });

        it('should accept valid password', () => {
            component.addForm.get('password')?.setValue('validpassword123');
            expect(component.addForm.get('password')?.valid).toBe(true);
        });
    });

    describe('Form Submission', () => {
        it('should not submit invalid form', () => {
            component.onSubmit();
            expect(mockUserStore.add).not.toHaveBeenCalled();
            expect(component.errorMessages.length).toBeGreaterThan(0);
        });

        it('should submit valid form', () => {
            mockUserStore.add.mockClear();
            component.addForm.setValue({
                name: 'New User',
                email: 'newuser@example.com',
                password: 'password123',
            });

            component.onSubmit();

            expect(mockUserStore.add).toHaveBeenCalled();
        });

        it('should detect duplicate email', () => {
            component.addForm.setValue({
                name: 'Another User',
                email: 'existing@example.com', // Same as existing user
                password: 'password123',
            });

            component.onSubmit();

            expect(component.alreadyExist).toBeTruthy();
        });

        it('should show success toast on successful creation', () => {
            mockToastService.success.mockClear();
            mockUserStore.add.mockClear();
            component.addForm.setValue({
                name: 'New User',
                email: 'newuser2@example.com',
                password: 'password123',
            });

            component.onSubmit();

            expect(mockToastService.success).toHaveBeenCalledWith('User created successfully.');
        });
    });

    describe('Close Action', () => {
        it('should emit close event and reset form', () => {
            const closeSpy = vi.spyOn(component.close, 'emit');

            component.addForm.setValue({
                name: 'Test',
                email: 'test@test.com',
                password: 'password123',
            });

            component.closeAdd();

            expect(closeSpy).toHaveBeenCalled();
            expect(component.addForm.get('name')?.value).toBeNull();
        });
    });

    describe('Getters', () => {
        it('should return name control', () => {
            expect(component.name).toBe(component.addForm.get('name'));
        });

        it('should return email control', () => {
            expect(component.email).toBe(component.addForm.get('email'));
        });

        it('should return password control', () => {
            expect(component.password).toBe(component.addForm.get('password'));
        });
    });
});
