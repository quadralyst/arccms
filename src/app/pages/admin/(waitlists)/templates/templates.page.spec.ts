/**
 * Templates Page Tests
 * 
 * Tests for the email templates page including:
 * - OTP and Welcome template editing
 * - Placeholder dropdown functionality
 * - Broadcast history display
 */

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ReactiveFormsModule, FormsModule, FormBuilder } from '@angular/forms';
import { RouterTestingModule } from '@angular/router/testing';
import { NoopAnimationsModule } from '@angular/platform-browser/animations';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import { ActivatedRoute, Router } from '@angular/router';
import { of } from 'rxjs';
import { Firestore } from '@angular/fire/firestore';
import { Functions } from '@angular/fire/functions';
import { MatDialog } from '@angular/material/dialog';
import TemplatesComponent from './templates.page';
import { BroadcastEmailStore } from '../../../../../shared/components/broadcast-email-editor/send-broadcast-email/send-broadcast-email.store';
import { EmailConfigStatusService } from '../../../../../shared/services/email-config-status.service';
import { EmailSettingService } from '../../(settings)/email-setting/email-setting.service';
import { ToastService } from '../../../../../shared/services/toast.service';

describe('TemplatesComponent', () => {
    let component: TemplatesComponent;
    let fixture: ComponentFixture<TemplatesComponent>;

    const mockFirestore = {
        collection: vi.fn(),
    };

    const mockDialog = {
        open: vi.fn().mockReturnValue({
            componentInstance: {
                close: of(),
                broadcastSent: of(),
            },
            close: vi.fn(),
        }),
    };

    const mockActivatedRoute = {
        snapshot: {
            paramMap: {
                get: vi.fn().mockReturnValue(null), // Return null to skip Firebase calls
            },
        },
    };

    const mockRouter = {
        navigate: vi.fn(),
    };

    const mockBroadcastStore = {
        entities: vi.fn().mockReturnValue([]),
        isLoading: vi.fn().mockReturnValue(false),
    };

    const mockEmailConfigService = {
        isEmailConfigured: vi.fn().mockReturnValue(true),
        isLoading: vi.fn().mockReturnValue(false),
        bannerDismissed: vi.fn().mockReturnValue(false),
        shouldShowBanner: vi.fn().mockReturnValue(false),
        dismissBanner: vi.fn()
    };

    const mockToastService = {
        success: vi.fn(),
        error: vi.fn(),
        warning: vi.fn(),
        info: vi.fn(),
        openCustomSnackbar: vi.fn()
    };

    const mockEmailSettingsService = {
        getEmailSettings: vi.fn().mockReturnValue(of({
            senderName: 'Test Sender',
            senderEmail: 'test@example.com'
        }))
    };

    beforeEach(async () => {
        await TestBed.configureTestingModule({
            imports: [
                TemplatesComponent,
                ReactiveFormsModule,
                FormsModule,
                RouterTestingModule,
                NoopAnimationsModule,
            ],
            providers: [
                { provide: Firestore, useValue: mockFirestore },
                // U5.5: the page fetches the default templates from the server
                // (`getWaitlistTemplateDefaults`) instead of keeping its own copy.
                { provide: Functions, useValue: {} },
                { provide: MatDialog, useValue: mockDialog },
                { provide: ActivatedRoute, useValue: mockActivatedRoute },
                { provide: Router, useValue: mockRouter },
                { provide: BroadcastEmailStore, useValue: mockBroadcastStore },
                { provide: EmailConfigStatusService, useValue: mockEmailConfigService },
                { provide: ToastService, useValue: mockToastService },
                { provide: EmailSettingService, useValue: mockEmailSettingsService },
            ],
        }).compileComponents();

        fixture = TestBed.createComponent(TemplatesComponent);
        component = fixture.componentInstance;
        // Don't call fixture.detectChanges() to avoid ngOnInit Firebase calls
    });

    describe('Initialization', () => {
        it('should create', () => {
            expect(component).toBeTruthy();
        });

        it('should have OTP as default active tab', () => {
            expect(component.activeTab()).toBe('waitlist_verify_otp_email');
        });

        it('should have tabs defined', () => {
            expect(component.tabs.length).toBe(3);
            expect(component.tabs[0].key).toBe('waitlist_verify_otp_email');
            expect(component.tabs[1].key).toBe('waitlist_welcome_email');
            expect(component.tabs[2].key).toBe('waitlist_broadcast_email');
        });
    });

    describe('Form Initialization', () => {
        beforeEach(() => {
            component.initForm();
        });

        it('should initialize form with required fields', () => {
            expect(component.templateForm).toBeDefined();
            expect(component.templateForm.get('senderName')).toBeDefined();
            expect(component.templateForm.get('senderEmail')).toBeDefined();
            expect(component.templateForm.get('subject')).toBeDefined();
            expect(component.templateForm.get('template')).toBeDefined();
        });

        it('should require sender name', () => {
            const senderName = component.templateForm.get('senderName');
            senderName?.setValue('');
            expect(senderName?.valid).toBe(false);
            senderName?.setValue('Test Sender');
            expect(senderName?.valid).toBe(true);
        });

        it('should require sender email', () => {
            const senderEmail = component.templateForm.get('senderEmail');
            senderEmail?.setValue('');
            expect(senderEmail?.valid).toBe(false);
        });

        it('should require valid email format', () => {
            const senderEmail = component.templateForm.get('senderEmail');
            senderEmail?.setValue('invalid-email');
            expect(senderEmail?.valid).toBe(false);
            senderEmail?.setValue('valid@email.com');
            expect(senderEmail?.valid).toBe(true);
        });

        it('should require subject', () => {
            const subject = component.templateForm.get('subject');
            subject?.setValue('');
            expect(subject?.valid).toBe(false);
            subject?.setValue('Test Subject');
            expect(subject?.valid).toBe(true);
        });

        it('should require template', () => {
            const template = component.templateForm.get('template');
            template?.setValue('');
            expect(template?.valid).toBe(false);
            template?.setValue('<p>Test</p>');
            expect(template?.valid).toBe(true);
        });
    });

    describe('Tab Switching', () => {
        beforeEach(() => {
            component.initForm();
        });

        it('should switch to welcome tab', () => {
            component.setActiveTab('waitlist_welcome_email');
            expect(component.activeTab()).toBe('waitlist_welcome_email');
        });

        it('should switch to broadcast tab', () => {
            component.setActiveTab('waitlist_broadcast_email');
            expect(component.activeTab()).toBe('waitlist_broadcast_email');
        });

        it('should switch back to OTP tab', () => {
            component.setActiveTab('waitlist_welcome_email');
            component.setActiveTab('waitlist_verify_otp_email');
            expect(component.activeTab()).toBe('waitlist_verify_otp_email');
        });
    });

    describe('Placeholder Methods', () => {
        beforeEach(() => {
            component.initForm();
        });

        it('should return placeholders for OTP tab', () => {
            component.setActiveTab('waitlist_verify_otp_email');
            const placeholders = component.getPlaceholders();
            expect(placeholders).toContain('##OTP##');
        });

        it('should return placeholders for welcome tab', () => {
            component.setActiveTab('waitlist_welcome_email');
            const placeholders = component.getPlaceholders();
            expect(placeholders).toContain('##NAME##');
        });

        it('should return placeholders array', () => {
            const placeholders = component.getPlaceholders();
            expect(Array.isArray(placeholders)).toBe(true);
            expect(placeholders.length).toBeGreaterThan(0);
        });
    });

    describe('Subject Placeholder Dropdown', () => {
        beforeEach(() => {
            component.initForm();
        });

        it('should have insertPlaceholderToSubject method', () => {
            expect(typeof component.insertPlaceholderToSubject).toBe('function');
        });

        it('should insert placeholder into subject by appending to end', () => {
            component.templateForm.patchValue({ subject: 'Hello ' });
            // Since there's no DOM element in tests, it should use fallback
            component.insertPlaceholderToSubject('##NAME##');
            const value = component.templateForm.get('subject')?.value;
            expect(value).toBe('Hello ##NAME##');
        });

        it('should handle onSubjectPlaceholderSelect event', () => {
            const insertSpy = vi.spyOn(component, 'insertPlaceholderToSubject');
            const mockSelect = { value: '##EMAIL##' };
            const mockEvent = { target: mockSelect } as unknown as Event;

            component.onSubjectPlaceholderSelect(mockEvent);
            expect(insertSpy).toHaveBeenCalledWith('##EMAIL##');
            expect(mockSelect.value).toBe(''); // Should reset
        });

        it('should not insert when dropdown value is empty', () => {
            const insertSpy = vi.spyOn(component, 'insertPlaceholderToSubject');
            const mockEvent = {
                target: { value: '' }
            } as unknown as Event;

            component.onSubjectPlaceholderSelect(mockEvent);
            expect(insertSpy).not.toHaveBeenCalled();
        });
    });

    describe('Body Placeholder Dropdown', () => {
        beforeEach(() => {
            component.initForm();
        });

        it('should have onBodyPlaceholderSelect method', () => {
            expect(typeof component.onBodyPlaceholderSelect).toBe('function');
        });

        it('should call insertPlaceholder on email template editor when available', () => {
            // Mock the email template editor
            const mockEditor = {
                insertPlaceholder: vi.fn()
            };
            component.emailTemplateEditor = mockEditor as any;

            const mockSelect = { value: '##NAME##' };
            const mockEvent = { target: mockSelect } as unknown as Event;

            component.onBodyPlaceholderSelect(mockEvent);

            expect(mockEditor.insertPlaceholder).toHaveBeenCalledWith('##NAME##');
            expect(mockSelect.value).toBe(''); // Should reset dropdown
        });

        it('should reset dropdown value after selection', () => {
            const mockSelect = { value: '##EMAIL##' };
            const mockEvent = { target: mockSelect } as unknown as Event;

            component.onBodyPlaceholderSelect(mockEvent);
            expect(mockSelect.value).toBe(''); // Should reset
        });

        it('should not insert when dropdown value is empty', () => {
            const mockEditor = {
                insertPlaceholder: vi.fn()
            };
            component.emailTemplateEditor = mockEditor as any;

            const initialValue = '<p>Initial</p>';
            component.templateForm.patchValue({ template: initialValue });
            const mockEvent = {
                target: { value: '' }
            } as unknown as Event;

            component.onBodyPlaceholderSelect(mockEvent);
            expect(mockEditor.insertPlaceholder).not.toHaveBeenCalled();
        });

        it('should handle case when email template editor is not available', () => {
            component.emailTemplateEditor = undefined;

            const mockSelect = { value: '##NAME##' };
            const mockEvent = { target: mockSelect } as unknown as Event;

            // Should not throw
            expect(() => component.onBodyPlaceholderSelect(mockEvent)).not.toThrow();
            expect(mockSelect.value).toBe(''); // Should still reset
        });
    });

    describe('Template Content Handler', () => {
        beforeEach(() => {
            component.initForm();
        });

        it('should have onTemplateContentChange method', () => {
            expect(typeof component.onTemplateContentChange).toBe('function');
        });

        it('should update template form value', () => {
            component.onTemplateContentChange('<p>New content</p>');
            expect(component.templateForm.get('template')?.value).toBe('<p>New content</p>');
        });
    });

    describe('Broadcast History', () => {
        it('should have broadcast history signal', () => {
            expect(component.broadcastHistory).toBeDefined();
        });

        it('should have loading broadcasts signal', () => {
            expect(component.loadingBroadcasts).toBeDefined();
        });

        it('should have getStatusClass method', () => {
            expect(component.getStatusClass('sent')).toBe('status-sent');
            expect(component.getStatusClass('sending')).toBe('status-sending');
            expect(component.getStatusClass('failed')).toBe('status-failed');
            expect(component.getStatusClass('draft')).toBe('status-draft');
            expect(component.getStatusClass('unknown')).toBe('');
        });
    });

    describe('Broadcast Editor Management', () => {
        it('should have isComposingBroadcast signal defaulting to false', () => {
            expect(component.isComposingBroadcast()).toBe(false);
        });

        it('should set isComposingBroadcast to true when openBroadcastEditor is called', () => {
            component.openBroadcastEditor();
            expect(component.isComposingBroadcast()).toBe(true);
        });

        it('should set isComposingBroadcast to false when closeBroadcastEditor is called', () => {
            component.isComposingBroadcast.set(true);
            component.closeBroadcastEditor();
            expect(component.isComposingBroadcast()).toBe(false);
        });

        it('should handle onBroadcastSent correctly', () => {
            const historySpy = vi.spyOn(component, 'loadBroadcastHistory');
            component.isComposingBroadcast.set(true);

            component.onBroadcastSent();

            expect(component.isComposingBroadcast()).toBe(false);
            expect(historySpy).toHaveBeenCalled();
        });
    });

    describe('Reset to Default', () => {
        beforeEach(() => {
            component.initForm();
        });

        it('should have resetToDefault method', () => {
            expect(typeof component.resetToDefault).toBe('function');
        });
    });

    describe('Navigation', () => {
        it('should have goBack method', () => {
            expect(typeof component.goBack).toBe('function');
        });
    });

    describe('Date Formatting', () => {
        it('should format date correctly', () => {
            const testDate = new Date('2024-01-15T10:30:00');
            const formatted = component.formatDate(testDate);
            expect(formatted).toContain('Jan');
            expect(formatted).toContain('15');
            expect(formatted).toContain('2024');
        });

        it('should handle null date', () => {
            const formatted = component.formatDate(null);
            expect(formatted).toBe('-');
        });

        it('should handle undefined date', () => {
            const formatted = component.formatDate(undefined);
            expect(formatted).toBe('-');
        });

        it('should handle Firestore timestamp object', () => {
            const mockTimestamp = {
                toDate: () => new Date('2024-01-15T10:30:00')
            };
            const formatted = component.formatDate(mockTimestamp);
            expect(formatted).toContain('Jan');
        });
    });

    describe('Template Enable/Disable', () => {
        beforeEach(() => {
            component.initForm();
        });

        it('should have enableTemplate method', () => {
            expect(typeof component.enableTemplate).toBe('function');
        });

        it('should have enableTemplateAndSave method', () => {
            expect(typeof component.enableTemplateAndSave).toBe('function');
        });

        describe('onTemplateActiveChange — confirmation before an immediate write', () => {
            // Unchecking persists straight away; there is no Save step. Turning the OTP
            // template off stops every new signup on this form being verified, and it
            // also writes `otpEnabled`, which is what the public page reads. So it must
            // ask first — an accidental click should not be able to do that silently.
            const uncheck = () => ({ target: { checked: false } } as unknown as Event);
            const check = () => ({ target: { checked: true } } as unknown as Event);

            // The component is standalone and imports MatDialogModule, so its own
            // injector supplies the real MatDialog and the TestBed provider never wins.
            // Spy on the instance the component actually holds.
            function dialogReturning(confirmed: boolean) {
                return vi.spyOn((component as any).dialog, 'open').mockReturnValue({
                    afterClosed: () => of(confirmed),
                } as any);
            }

            it('asks for confirmation instead of saving straight away', () => {
                const open = dialogReturning(false);
                const save = vi.spyOn(component, 'saveTemplate').mockResolvedValue(undefined);

                component.onTemplateActiveChange(uncheck());

                expect(open).toHaveBeenCalled();
                expect(save).not.toHaveBeenCalled();
            });

            it('restores the checkbox and writes nothing when declined', () => {
                dialogReturning(false);
                const save = vi.spyOn(component, 'saveTemplate').mockResolvedValue(undefined);
                component.templateForm.patchValue({ isActive: false });

                component.onTemplateActiveChange(uncheck());

                expect(component.templateForm.get('isActive')?.value).toBe(true);
                expect(save).not.toHaveBeenCalled();
            });

            it('saves once confirmed', () => {
                dialogReturning(true);
                const save = vi.spyOn(component, 'saveTemplate').mockResolvedValue(undefined);

                component.onTemplateActiveChange(uncheck());

                expect(save).toHaveBeenCalledTimes(1);
            });

            it('does not prompt when enabling — that still needs an explicit Save', () => {
                const open = dialogReturning(false);
                const save = vi.spyOn(component, 'saveTemplate').mockResolvedValue(undefined);

                component.onTemplateActiveChange(check());

                expect(open).not.toHaveBeenCalled();
                expect(save).not.toHaveBeenCalled();
            });

            it('names the consequence for the tab being turned off', () => {
                const open = dialogReturning(false);
                component.activeTab.set('waitlist_verify_otp_email');

                component.onTemplateActiveChange(uncheck());

                const msg = (open.mock.calls[0][1] as any).data.dialogMessage as string;
                expect(msg).toMatch(/verification/i);
                // The immediacy is the part that surprised a reader of the old code.
                expect(msg).toMatch(/immediately/i);
            });
        });

        it('should have onTemplateActiveChange method', () => {
            expect(typeof component.onTemplateActiveChange).toBe('function');
        });

        it('should enable template when enableTemplate is called', () => {
            component.templateForm.patchValue({ isActive: false });
            expect(component.templateForm.get('isActive')?.value).toBe(false);

            component.enableTemplate();

            expect(component.templateForm.get('isActive')?.value).toBe(true);
        });

        it('should have isActive form control defaulting to true', () => {
            expect(component.templateForm.get('isActive')?.value).toBe(true);
        });

        it('should allow setting isActive to false', () => {
            component.templateForm.patchValue({ isActive: false });
            expect(component.templateForm.get('isActive')?.value).toBe(false);
        });
    });

    describe('loadWaitlistUsers — Firestore collection path', () => {
        /**
         * Regression: loadWaitlistUsers previously queried a non-existent
         * top-level 'WaitlistUsers' collection instead of the subcollection
         * 'Waitlists/{waitlistId}/users'. This caused the Recipients tab
         * in the Broadcast Email editor to always show "No users".
         */
        it('should query the Waitlists/{id}/users subcollection, not a top-level WaitlistUsers collection', () => {
            const fs = require('fs');
            const source = fs.readFileSync(
                'src/app/pages/admin/(waitlists)/templates/templates.page.ts',
                'utf8',
            );
            // Must use the subcollection path
            expect(source).toContain('`Waitlists/${waitlistId}/users`');
            // Must NOT use the old top-level collection
            expect(source).not.toContain("'WaitlistUsers'");
        });

        it('should map firstName to name for broadcast editor compatibility', () => {
            const fs = require('fs');
            const source = fs.readFileSync(
                'src/app/pages/admin/(waitlists)/templates/templates.page.ts',
                'utf8',
            );
            // The broadcast editor template expects user.name, but subcollection uses firstName
            expect(source).toContain("data['firstName']");
        });
    });

    describe('Test Email Dialog', () => {
        beforeEach(() => {
            component.initForm();
        });

        it('should have openTestEmailDialog method', () => {
            expect(typeof component.openTestEmailDialog).toBe('function');
        });

        it('should show error toast when template content is empty', () => {
            component.templateForm.patchValue({ template: '' });

            component.openTestEmailDialog();

            expect(mockToastService.error).toHaveBeenCalledWith('Please add template content before sending a test email.');
        });

        // Skip this test as it triggers Firestore in the TestEmailComponent initialization
        // The openTestEmailDialog logic is covered by the empty template test
        it.skip('should open dialog when template has content', () => {
            component.templateForm.patchValue({
                template: '<p>Test content</p>',
                senderName: 'Test Sender',
                senderEmail: 'test@example.com',
                subject: 'Test Subject',
                previewText: 'Preview'
            });

            component.openTestEmailDialog();

            expect(mockDialog.open).toHaveBeenCalledWith(
                expect.anything(),
                expect.objectContaining({
                    panelClass: 'test-email-dialog',
                    maxWidth: '1000px'
                })
            );
        });
    });
});
