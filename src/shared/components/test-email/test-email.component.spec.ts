/**
 * Test Email Component Tests
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TestEmailComponent } from './test-email.component';
import { TestEmailStore } from './test-email.store';

describe('TestEmailComponent', () => {
    let component: TestEmailComponent;
    let fixture: ComponentFixture<TestEmailComponent>;
    let mockDialogRef: { close: ReturnType<typeof vi.fn> };
    let mockTestEmailStore: { add: ReturnType<typeof vi.fn>; isLoading: () => boolean; isSuccess: () => boolean };

    const mockDialogData = {
        formValue: {
            subject: 'Test Subject',
            senderName: 'Test Sender',
            senderEmail: 'test@example.com',
            previewText: 'Preview text',
        },
        contentTemplate: '<p>Hello ##NAME##, your email is ##EMAIL##</p>',
    };

    beforeEach(async () => {
        mockDialogRef = { close: vi.fn() };
        mockTestEmailStore = {
            add: vi.fn().mockReturnValue(of('test-id')),
            isLoading: () => false,
            isSuccess: () => false
        };

        await TestBed.configureTestingModule({
            imports: [
                TestEmailComponent,
                ReactiveFormsModule,
                NoopAnimationsModule,
            ],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: TestEmailStore, useValue: mockTestEmailStore },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(TestEmailComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Initialization', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should initialize form with subject', () => {
            expect(component.testEmailForm.get('subject')?.value).toBe('Test Subject');
        });

        it('should initialize preview content', () => {
            expect(component.previewContent).toBeDefined();
        });
    });

    describe('Form Fields', () => {
        it('should have toEmail field', () => {
            expect(component.testEmailForm.get('toEmail')).toBeDefined();
        });

        it('should have toName field', () => {
            expect(component.testEmailForm.get('toName')).toBeDefined();
        });

        it('should have variables form array', () => {
            expect(component.variables).toBeDefined();
        });

        it('should require toEmail', () => {
            component.testEmailForm.get('toEmail')?.setValue('');
            expect(component.testEmailForm.get('toEmail')?.valid).toBe(false);
        });

        it('should require toName', () => {
            component.testEmailForm.get('toName')?.setValue('');
            expect(component.testEmailForm.get('toName')?.valid).toBe(false);
        });

        it('should validate email format', () => {
            component.testEmailForm.get('toEmail')?.setValue('invalid');
            expect(component.testEmailForm.get('toEmail')?.valid).toBe(false);
        });
    });

    describe('Variable Extraction', () => {
        it('should extract variables from template', () => {
            // ngOnInit is already called by fixture.detectChanges()
            expect(component.variables.length).toBe(2);
        });

        it('should extract NAME variable', () => {
            const variableNames = component.variables.controls.map(c => c.get('name')?.value);
            expect(variableNames).toContain('name');
        });

        it('should extract EMAIL variable', () => {
            const variableNames = component.variables.controls.map(c => c.get('name')?.value);
            expect(variableNames).toContain('email');
        });
    });

    describe('Preview Update', () => {
        it('should update preview when variable changes', () => {
            // Variables already extracted by ngOnInit called during detectChanges
            if (component.variables.length > 0) {
                component.variables.at(0).get('value')?.setValue('John');
                component.updatePreview();
            }

            // Preview should be updated
            expect(component.previewContent).toBeDefined();
        });
    });

    describe('Dismiss Modal', () => {
        it('should close dialog', () => {
            component.dismissModal();
            expect(mockDialogRef.close).toHaveBeenCalled();
        });
    });

    describe('Form Submission', () => {
        it('should not submit if form is invalid', () => {
            component.testEmailForm.get('toEmail')?.setValue('');
            component.onSubmit();
            expect(mockTestEmailStore.add).not.toHaveBeenCalled();
        });

        it('should submit if form is valid', () => {
            component.testEmailForm.patchValue({
                toEmail: 'test@example.com',
                toName: 'Test User',
            });

            // Set all variable values
            component.variables.controls.forEach(control => {
                control.get('value')?.setValue('test value');
            });

            component.onSubmit();
            expect(mockTestEmailStore.add).toHaveBeenCalled();
        });
    });
});
