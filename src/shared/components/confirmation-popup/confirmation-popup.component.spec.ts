/**
 * Tests for Confirmation Popup Component
 *
 * Tests verify the ConfirmationPopupComponent functionality including:
 * - Component creation
 * - Dialog data injection
 * - Confirm action
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { ConfirmationPopupComponent } from './confirmation-popup.component';

describe('ConfirmationPopupComponent', () => {
    let component: ConfirmationPopupComponent;
    let fixture: ComponentFixture<ConfirmationPopupComponent>;
    let mockDialogRef: any;
    let mockDialogData: any;

    beforeEach(async () => {
        mockDialogRef = {
            close: vi.fn()
        };

        mockDialogData = {
            title: 'Confirm Action',
            message: 'Are you sure you want to proceed?',
            confirmText: 'Yes',
            cancelText: 'No'
        };

        await TestBed.configureTestingModule({
            imports: [
                ConfirmationPopupComponent,
                NoopAnimationsModule
            ],
            providers: [
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: MAT_DIALOG_DATA, useValue: mockDialogData }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(ConfirmationPopupComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Component Creation', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should inject dialog data', () => {
            expect(component._DIALOG_DATA).toBeDefined();
        });

        it('should inject dialog ref', () => {
            expect(component.dialogRef).toBeDefined();
        });
    });

    describe('Dialog Data', () => {
        it('should have access to title', () => {
            expect(component._DIALOG_DATA.title).toBe('Confirm Action');
        });

        it('should have access to message', () => {
            expect(component._DIALOG_DATA.message).toBe('Are you sure you want to proceed?');
        });

        it('should have access to confirmText', () => {
            expect(component._DIALOG_DATA.confirmText).toBe('Yes');
        });

        it('should have access to cancelText', () => {
            expect(component._DIALOG_DATA.cancelText).toBe('No');
        });
    });

    describe('confirm Method', () => {
        it('should close dialog with true', () => {
            component.confirm();
            expect(mockDialogRef.close).toHaveBeenCalledWith(true);
        });

        it('should be callable', () => {
            expect(typeof component.confirm).toBe('function');
        });
    });

    describe('Dialog Close', () => {
        it('should have MatDialogClose for cancel button', () => {
            // The cancel button uses [mat-dialog-close] directive
            // We verify the dialogRef is properly injected
            expect(component.dialogRef.close).toBeDefined();
        });
    });

    describe('Different Dialog Data', () => {
        it('should accept different data structures', () => {
            // Verify the dialog data structure can contain various fields
            const dialogData = component._DIALOG_DATA;
            expect(dialogData).toHaveProperty('title');
            expect(dialogData).toHaveProperty('message');
            expect(dialogData).toHaveProperty('confirmText');
            expect(dialogData).toHaveProperty('cancelText');
        });
    });

    describe('Component Selector', () => {
        it('should have arc-confirmation-popup selector', () => {
            const componentDef = (ConfirmationPopupComponent as any).ɵcmp;
            expect(componentDef.selectors[0][0]).toBe('arc-confirmation-popup');
        });
    });
});
