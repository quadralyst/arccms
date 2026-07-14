import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { TestSendDialogComponent } from './test-send-dialog.component';

describe('TestSendDialogComponent', () => {
    let component: TestSendDialogComponent;
    let mockDialogRef: { close: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        mockDialogRef = { close: vi.fn() };
        await TestBed.configureTestingModule({
            imports: [TestSendDialogComponent, NoopAnimationsModule],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: { subject: 'Hello world' } },
                { provide: MatDialogRef, useValue: mockDialogRef },
            ],
        }).compileComponents();
        component = TestBed.createComponent(TestSendDialogComponent).componentInstance;
    });

    it('creates and exposes the subject from dialog data', () => {
        expect(component).toBeTruthy();
        expect(component.data.subject).toBe('Hello world');
    });

    it('does not close and marks the field touched when the email is invalid', () => {
        component.email.setValue('not-an-email');
        component.confirm();
        expect(mockDialogRef.close).not.toHaveBeenCalled();
        expect(component.email.touched).toBe(true);
    });

    it('does not close when the email is empty (required)', () => {
        component.email.setValue('');
        component.confirm();
        expect(mockDialogRef.close).not.toHaveBeenCalled();
    });

    it('closes with the recipient email on a valid confirm', () => {
        component.email.setValue('person@example.com');
        component.confirm();
        expect(mockDialogRef.close).toHaveBeenCalledWith('person@example.com');
    });

    it('closes with undefined on cancel', () => {
        component.cancel();
        expect(mockDialogRef.close).toHaveBeenCalledWith(undefined);
    });
});
