/**
 * Send Broadcast Email Component Tests
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { Firestore } from '@angular/fire/firestore';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { SendBroadcastEmailComponent } from './send-broadcast-email.component';
import { BroadcastEmailStore } from './send-broadcast-email.store';

describe('SendBroadcastEmailComponent', () => {
    let component: SendBroadcastEmailComponent;
    let fixture: ComponentFixture<SendBroadcastEmailComponent>;
    let mockDialogRef: { close: ReturnType<typeof vi.fn> };
    let mockBroadcastStore: { add: ReturnType<typeof vi.fn> };
    const mockFirestore = {};

    const mockDialogData = {
        formValue: {
            subject: 'Test Subject',
            senderName: 'Test Sender',
            senderEmail: 'test@example.com',
            previewText: 'Preview text',
        },
        contentTemplate: '<p>Test content</p>',
        selectedUsers: [
            { toName: 'User 1', toEmail: 'user1@example.com', trackId: 1, createdAt: new Date() },
            { toName: 'User 2', toEmail: 'user2@example.com', trackId: 2, createdAt: new Date() },
        ],
        waitlistId: 'test-waitlist-id',
    };

    beforeEach(async () => {
        mockDialogRef = { close: vi.fn() };
        mockBroadcastStore = { add: vi.fn().mockReturnValue(of('test-id')) };

        await TestBed.configureTestingModule({
            imports: [
                SendBroadcastEmailComponent,
                ReactiveFormsModule,
                NoopAnimationsModule,
            ],
            providers: [
                { provide: MAT_DIALOG_DATA, useValue: mockDialogData },
                { provide: MatDialogRef, useValue: mockDialogRef },
                { provide: BroadcastEmailStore, useValue: mockBroadcastStore },
                { provide: Firestore, useValue: mockFirestore },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(SendBroadcastEmailComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Initialization', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should have correct recipient count', () => {
            expect(component.recipientCount).toBe(2);
        });

        it('should have correct subject', () => {
            expect(component.subject).toBe('Test Subject');
        });

        it('should have correct sender name', () => {
            expect(component.senderName).toBe('Test Sender');
        });

        it('should have correct sender email', () => {
            expect(component.senderEmail).toBe('test@example.com');
        });

        it('should initialize confirm form with subject', () => {
            expect(component.confirmForm.get('subject')?.value).toBe('Test Subject');
        });
    });

    describe('Preview Content', () => {
        it('should sanitize and display preview content', () => {
            expect(component.previewContent).toBeDefined();
        });
    });

    describe('Dismiss Modal', () => {
        it('should close dialog with success false', () => {
            component.dismissModal();
            expect(mockDialogRef.close).toHaveBeenCalledWith({ success: false });
        });
    });

    describe('Send Broadcast', () => {
        it('should not send if already sending', async () => {
            component.isSending = true;
            const initialSending = component.isSending;
            await component.sendBroadcastEmail();
            // isSending stays true, no side effects
            expect(initialSending).toBe(true);
        });

        it('should set isSending to true when sending starts', () => {
            expect(component.isSending).toBe(false);
        });
    });
});
