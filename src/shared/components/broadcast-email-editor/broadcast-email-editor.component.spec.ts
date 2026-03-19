/**
 * Broadcast Email Editor Component Tests
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule } from '@angular/forms';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { of } from 'rxjs';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { BroadcastEmailEditorComponent } from './broadcast-email-editor.component';
import { EmailSettingService } from '../../../app/pages/admin/(settings)/email-setting/email-setting.service';

describe('BroadcastEmailEditorComponent', () => {
    let component: BroadcastEmailEditorComponent;
    let fixture: ComponentFixture<BroadcastEmailEditorComponent>;
    let mockDialog: { open: ReturnType<typeof vi.fn> };
    let mockEmailSettingService: { getEmailSettings: ReturnType<typeof vi.fn> };

    beforeEach(async () => {
        mockDialog = {
            open: vi.fn().mockReturnValue({
                afterClosed: () => of({ success: true }),
                componentInstance: { close: of(), broadcastSent: of() },
            }),
        };

        mockEmailSettingService = {
            getEmailSettings: vi.fn().mockReturnValue(of({
                senderName: 'Arc CMS',
                senderEmail: 'noreply@arccms.com',
            })),
        };

        await TestBed.configureTestingModule({
            imports: [
                BroadcastEmailEditorComponent,
                ReactiveFormsModule,
                MatDialogModule,
                NoopAnimationsModule,
            ],
            providers: [
                { provide: MatDialog, useValue: mockDialog },
                { provide: EmailSettingService, useValue: mockEmailSettingService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(BroadcastEmailEditorComponent);
        component = fixture.componentInstance;
        fixture.detectChanges();
    });

    describe('Initialization', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should initialize form with default values', () => {
            expect(component.broadcastForm).toBeDefined();
            expect(component.broadcastForm.get('senderName')?.value).toBe('Arc CMS');
            expect(component.broadcastForm.get('senderEmail')?.value).toBe('noreply@arccms.com');
        });

        it('should have empty subject initially', () => {
            expect(component.broadcastForm.get('subject')?.value).toBe('');
        });

        it('should have empty sendTo initially', () => {
            expect(component.broadcastForm.get('sendTo')?.value).toBe('');
        });
    });

    describe('Email Placeholders', () => {
        it('should have default email placeholders', () => {
            expect(component.emailPlaceholders).toBeDefined();
            expect(component.emailPlaceholders.length).toBeGreaterThan(0);
        });

        it('should include NAME placeholder', () => {
            expect(component.emailPlaceholders).toContain('##NAME##');
        });

        it('should include EMAIL placeholder', () => {
            expect(component.emailPlaceholders).toContain('##EMAIL##');
        });

        it('should include UNSUBSCRIBE_LINK placeholder', () => {
            expect(component.emailPlaceholders).toContain('##UNSUBSCRIBE_LINK##');
        });
    });

    describe('Tab Switching', () => {
        it('should start with editor tab active', () => {
            expect(component.activeTab()).toBe('editor');
        });

        it('should switch to html tab', () => {
            component.setActiveTab('html');
            expect(component.activeTab()).toBe('html');
        });

        it('should switch back to editor tab', () => {
            component.setActiveTab('html');
            component.setActiveTab('editor');
            expect(component.activeTab()).toBe('editor');
        });
    });

    describe('Form Validation', () => {
        it('should require subject', () => {
            component.broadcastForm.get('subject')?.setValue('');
            expect(component.broadcastForm.get('subject')?.valid).toBe(false);
        });

        it('should accept valid subject', () => {
            component.broadcastForm.get('subject')?.setValue('Test Subject');
            expect(component.broadcastForm.get('subject')?.valid).toBe(true);
        });

        it('should require sender name', () => {
            component.broadcastForm.get('senderName')?.setValue('');
            expect(component.broadcastForm.get('senderName')?.valid).toBe(false);
        });

        it('should validate sender email format', () => {
            component.broadcastForm.get('senderEmail')?.setValue('invalid-email');
            expect(component.broadcastForm.get('senderEmail')?.valid).toBe(false);
        });

        it('should accept valid sender email', () => {
            component.broadcastForm.get('senderEmail')?.setValue('test@example.com');
            expect(component.broadcastForm.get('senderEmail')?.valid).toBe(true);
        });
    });

    describe('canSubmit', () => {
        it('should return false when form is invalid', () => {
            expect(component.canSubmit()).toBe(false);
        });

        it('should return false when no content', () => {
            component.broadcastForm.patchValue({
                sendTo: 'all',
                subject: 'Test',
                senderName: 'Test',
                senderEmail: 'test@example.com',
            });
            component.htmlContent = '';
            expect(component.canSubmit()).toBe(false);
        });
    });

    describe('Close Modal', () => {
        it('should emit close event', () => {
            const emitSpy = vi.spyOn(component.close, 'emit');
            component.closeModal();
            expect(emitSpy).toHaveBeenCalled();
        });
    });

    describe('Editor Content', () => {
        it('should update htmlContent on editor changes', () => {
            const testContent = '<p>Test content</p>';
            component.onEditorChanges(testContent);
            expect(component.htmlContent).toBe(testContent);
        });

        it('should format HTML content for display', () => {
            const testContent = '<div><p>Test</p></div>';
            component.setActiveTab('html');
            component.onEditorChanges(testContent);
            expect(component.formattedHtmlContent).toBeDefined();
        });
    });

    describe('Send To Options', () => {
        it('should show email input when sendTo is new', () => {
            component.broadcastForm.get('sendTo')?.setValue('new');
            expect(component.showEmailInput()).toBe(true);
        });

        it('should hide email input when sendTo is all', () => {
            component.broadcastForm.get('sendTo')?.setValue('all');
            expect(component.showEmailInput()).toBe(false);
        });

        it('should hide email input when sendTo is some', () => {
            component.broadcastForm.get('sendTo')?.setValue('some');
            expect(component.showEmailInput()).toBe(false);
        });
    });
});
