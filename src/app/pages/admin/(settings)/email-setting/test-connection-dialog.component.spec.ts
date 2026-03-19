import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Auth } from '@angular/fire/auth';
import { MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { TestConnectionDialogComponent } from './test-connection-dialog.component';
import { describe, it, expect, beforeEach, vi } from 'vitest';

describe('TestConnectionDialogComponent', () => {
    let component: TestConnectionDialogComponent;
    let fixture: ComponentFixture<TestConnectionDialogComponent>;
    let mockDialogRef: any;
    let mockAuth: any;

    beforeEach(async () => {
        mockDialogRef = {
            close: vi.fn(),
        };

        mockAuth = {
            currentUser: { email: 'test@example.com' }
        };

        await TestBed.configureTestingModule({
            imports: [TestConnectionDialogComponent, NoopAnimationsModule],
            providers: [
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: Auth, useValue: mockAuth }
            ]
        }).compileComponents();

        fixture = TestBed.createComponent(TestConnectionDialogComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    it('should create', () => {
        expect(component).toBeTruthy();
    });

    it('should pre-populate email, subject and message', () => {
        expect(component.emailControl.value).toBe('test@example.com');
        expect(component.subjectControl.value).toBe('It works! 🎉 - Arc CMS Connection Test');
        expect(component.messageControl.value).toContain('Hey there!');
    });

    it('should close dialog with all fields when valid', () => {
        component.emailControl.setValue('valid@test.com');
        // keep default subject/message
        component.onSend();
        expect(mockDialogRef.close).toHaveBeenCalledWith({
            testEmail: 'valid@test.com',
            subject: 'It works! 🎉 - Arc CMS Connection Test',
            message: component.messageControl.value
        });
    });

    it('should not close dialog when email is invalid', () => {
        component.emailControl.setValue('invalid-email');
        component.onSend();
        expect(mockDialogRef.close).not.toHaveBeenCalled();
    });
});
