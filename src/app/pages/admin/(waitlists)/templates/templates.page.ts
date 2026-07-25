/**
 * Email Templates Page
 * 
 * Admin page for managing email templates per waitlist.
 * Supports OTP, Welcome templates and Broadcast history with creation.
 */

import { RouteMeta } from '@analogjs/router';
import { CommonModule } from '@angular/common';
import { Component, OnInit, Injector, inject, runInInjectionContext, signal, ViewChild } from '@angular/core';
import { FormBuilder, FormGroup, FormsModule, ReactiveFormsModule, Validators } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router'
import { Firestore, collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, orderBy } from '@angular/fire/firestore';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import {
    IEmailTemplate,
    DEFAULT_OTP_TEMPLATE,
    DEFAULT_WELCOME_TEMPLATE,
    DEFAULT_BROADCAST_TEMPLATE
} from '../email-template.model';
import { BroadcastEmailEditorComponent } from '../../../../../shared/components/broadcast-email-editor/broadcast-email-editor.component';
import { IBroadcastEmail } from '../../../../../shared/components/broadcast-email-editor/send-broadcast-email/send-broadcast-email.model';
import { BroadcastEmailStore } from '../../../../../shared/components/broadcast-email-editor/send-broadcast-email/send-broadcast-email.store';
import { EmailTemplateEditorComponent } from '../../../../../shared/components/email-template-editor/email-template-editor.component';
import { PageHeaderComponent } from '../../../../../shared/components/page-header/page-header.component';
import { MatChipsModule } from '@angular/material/chips';
import { EmailConfigStatusService } from '../../../../../shared/services/email-config-status.service';
import { ToastService } from '../../../../../shared/services/toast.service';
import { TestEmailComponent } from '../../../../../shared/components/test-email/test-email.component';
import { roleGuard } from '../../../../guards/role.guard';
import { EmailSettingService } from '../../(settings)/email-setting/email-setting.service';
import { HashtagAutocompleteDirective } from '../../../../../shared/directives/hashtag-autocomplete/hashtag-autocomplete.directive';
import { getEmailTags } from '../../../../../shared/constants/email-tags';

export const routeMeta: RouteMeta = {
    title: 'Email Templates | Arc CMS',
    canActivate: [roleGuard],
    data: { allowedRoles: ['admin'] },
};

type TemplateType = 'waitlist_verify_otp_email' | 'waitlist_welcome_email' | 'waitlist_broadcast_email';

@Component({
    selector: 'arc-templates',
    templateUrl: './templates.page.html',
    styleUrls: ['./templates.page.scss'],
    standalone: true,
    imports: [CommonModule, FormsModule, ReactiveFormsModule, RouterLink, MatDialogModule, EmailTemplateEditorComponent, MatChipsModule, BroadcastEmailEditorComponent, PageHeaderComponent, HashtagAutocompleteDirective],
})
export default class TemplatesComponent implements OnInit {
    private readonly route = inject(ActivatedRoute);
    private readonly router = inject(Router);
    private readonly fb = inject(FormBuilder);
    private readonly firestore = inject(Firestore);
    private readonly dialog = inject(MatDialog);
    private readonly injector = inject(Injector);
    private readonly broadcastStore = inject(BroadcastEmailStore);
    private readonly toastService = inject(ToastService);
    private emailSettingService = inject(EmailSettingService);

    // Email configuration status
    emailConfigService = inject(EmailConfigStatusService);

    waitlistId = signal<string>('');
    waitlistName = signal<string>('');
    loading = signal(false);
    saving = signal(false);
    activeTab = signal<TemplateType>('waitlist_verify_otp_email');

    // For template editing (OTP, Welcome)
    templateForm!: FormGroup;
    templates: Record<TemplateType, IEmailTemplate | null> = {
        waitlist_verify_otp_email: null,
        waitlist_welcome_email: null,
        waitlist_broadcast_email: null,
    };

    // For broadcast history
    broadcastHistory = signal<IBroadcastEmail[]>([]);
    loadingBroadcasts = signal(false);
    waitlistUsers = signal<any[]>([]);

    // Show broadcast editor modal
    showBroadcastEditor = signal(false);

    // ViewChild reference to email template editor
    @ViewChild(EmailTemplateEditorComponent) emailTemplateEditor?: EmailTemplateEditorComponent;

    tabs: { key: TemplateType; label: string; icon: string }[] = [
        { key: 'waitlist_verify_otp_email', label: 'OTP Verification', icon: 'fa-key' },
        { key: 'waitlist_welcome_email', label: 'Welcome Email', icon: 'fa-envelope-open-text' },
        { key: 'waitlist_broadcast_email', label: 'Broadcast', icon: 'fa-bullhorn' },
    ];

    ngOnInit(): void {
        this.initForm();

        const id = this.route.snapshot.paramMap.get('waitlistId');
        if (id) {
            this.waitlistId.set(id);
            this.loadWaitlist(id);
            this.loadTemplates(id);
            this.loadBroadcastHistory(id);
            this.loadWaitlistUsers(id);
            this.loadSettings();
        }
    }

    initForm(): void {
        this.templateForm = this.fb.group({
            senderName: ['', Validators.required],
            senderEmail: ['', [Validators.required, Validators.email]],
            subject: ['', Validators.required],
            template: ['', Validators.required],
            previewText: [''],
            isActive: [true],
        });
    }

    async loadWaitlist(waitlistId: string): Promise<void> {
        try {
            const waitlistDoc = await runInInjectionContext(this.injector, () => getDoc(doc(this.firestore, 'Waitlists', waitlistId)));
            if (waitlistDoc.exists()) {
                this.waitlistName.set(waitlistDoc.data()?.['name'] || 'Unknown Waitlist');
            }
        } catch (error) {
            console.error('Error loading waitlist:', error);
        }
    }

    async loadTemplates(waitlistId: string): Promise<void> {
        this.loading.set(true);
        try {
            const templatesRef = runInInjectionContext(this.injector, () => collection(this.firestore, 'EmailTemplate'));
            const q = runInInjectionContext(this.injector, () => query(templatesRef, where('waitlistId', '==', waitlistId)));
            const snapshot = await runInInjectionContext(this.injector, () => getDocs(q));

            snapshot.forEach((doc) => {
                const data = doc.data() as IEmailTemplate;
                if (data.type && this.templates.hasOwnProperty(data.type)) {
                    this.templates[data.type as TemplateType] = { id: doc.id, ...data };
                }
            });

            // Load the active tab's template
            this.loadTemplateIntoForm(this.activeTab());
        } catch (error) {
            console.error('Error loading templates:', error);
        } finally {
            this.loading.set(false);
        }
    }

    async loadBroadcastHistory(waitlistId: string): Promise<void> {
        this.loadingBroadcasts.set(true);
        try {
            const broadcastsRef = runInInjectionContext(this.injector, () => collection(this.firestore, 'BroadcastEmails'));
            const q = runInInjectionContext(this.injector, () => query(
                broadcastsRef,
                where('waitlistId', '==', waitlistId),
                orderBy('createdAt', 'desc')
            ));
            const snapshot = await runInInjectionContext(this.injector, () => getDocs(q));

            const broadcasts: IBroadcastEmail[] = [];
            snapshot.forEach((doc) => {
                broadcasts.push({ id: doc.id, ...doc.data() } as IBroadcastEmail);
            });

            this.broadcastHistory.set(broadcasts);
        } catch (error) {
            console.error('Error loading broadcast history:', error);
        } finally {
            this.loadingBroadcasts.set(false);
        }
    }

    async loadWaitlistUsers(waitlistId: string): Promise<void> {
        try {
            const usersRef = runInInjectionContext(this.injector, () => collection(this.firestore, `Waitlists/${waitlistId}/users`));
            const q = runInInjectionContext(this.injector, () => query(usersRef, orderBy('signupTimestamp', 'desc')));
            const snapshot = await runInInjectionContext(this.injector, () => getDocs(q));

            const users: any[] = [];
            snapshot.forEach((doc) => {
                const data = doc.data();
                users.push({
                    id: doc.id,
                    name: data['firstName'] || data['email']?.split('@')[0] || '',
                    email: data['email'] || '',
                    ...data,
                });
            });

            this.waitlistUsers.set(users);
        } catch (error) {
            console.error('Error loading waitlist users:', error);
        }
    }

    private loadSettings(): void {
        this.loading.set(true);
        this.emailSettingService.getEmailSettings().subscribe({
            next: (settings) => {
                this.templateForm.patchValue({
                    senderName: settings.senderName,
                    senderEmail: settings.senderEmail,
                });
                this.loading.set(false);
            },
            error: (error) => {
                console.error('Failed to load email settings:', error);
                this.toastService.openCustomSnackbar('Failed to load settings', 'error', 'error');
                this.loading.set(false);
            },
        });
    }

    setActiveTab(tab: TemplateType): void {
        this.activeTab.set(tab);
        if (tab !== 'waitlist_broadcast_email') {
            this.loadTemplateIntoForm(tab);
        }
    }

    /**
     * Send the admin to this form's list hub, which owns broadcasts now (U4).
     * The list id mirrors the form id — see `waitlistListId()` on the server.
     */
    goToListHub(): void {
        this.router.navigate(['/admin/lists', `waitlist-${this.waitlistId()}`]);
    }

    loadTemplateIntoForm(type: TemplateType): void {
        if (type === 'waitlist_broadcast_email') return; // Broadcast tab shows history, not form

        const template = this.templates[type];

        if (template) {
            this.templateForm.patchValue({
                // senderName: template.senderName,
                // senderEmail: template.senderEmail,
                subject: template.subject,
                template: template.template,
                previewText: template.previewText || '',
                isActive: template.isActive,
            });
        } else {
            // Set defaults
            const defaults = this.getDefaultTemplate(type);
            this.templateForm.patchValue({
                senderName: this.templateForm.get('senderName')?.value || '',
                senderEmail: this.templateForm.get('senderEmail')?.value || '',
                subject: defaults.subject,
                template: defaults.template,
                previewText: '',
                isActive: true,
            });
        }
    }

    getDefaultTemplate(type: TemplateType): { subject: string; template: string } {
        switch (type) {
            case 'waitlist_verify_otp_email':
                return { subject: 'Verify your email', template: DEFAULT_OTP_TEMPLATE };
            case 'waitlist_welcome_email':
                return { subject: 'Welcome to the waitlist!', template: DEFAULT_WELCOME_TEMPLATE };
            case 'waitlist_broadcast_email':
                return { subject: 'Update from the team', template: DEFAULT_BROADCAST_TEMPLATE };
        }
    }

    async saveTemplate(): Promise<void> {
        if (this.templateForm.invalid) return;

        this.saving.set(true);
        try {
            const type = this.activeTab();
            const formValue = this.templateForm.value;
            const existingTemplate = this.templates[type];

            const templateData: Partial<IEmailTemplate> = {
                waitlistId: this.waitlistId(),
                type,
                senderName: formValue.senderName,
                senderEmail: formValue.senderEmail,
                subject: formValue.subject,
                template: formValue.template,
                previewText: formValue.previewText,
                isActive: formValue.isActive,
                updatedAt: new Date(),
            };

            if (existingTemplate?.id) {
                // Update existing
                await setDoc(doc(this.firestore, 'EmailTemplate', existingTemplate.id), templateData, { merge: true });
                this.templates[type] = { ...existingTemplate, ...templateData };
            } else {
                // Create new
                const newId = `${this.waitlistId()}_${type}`;
                templateData.createdAt = new Date();
                templateData.id = newId;
                await setDoc(doc(this.firestore, 'EmailTemplate', newId), templateData);
                this.templates[type] = { id: newId, ...templateData } as IEmailTemplate;
            }

            // Sync otpEnabled flag to Waitlist document when saving OTP template
            if (type === 'waitlist_verify_otp_email') {
                const waitlistDocRef = doc(this.firestore, 'Waitlists', this.waitlistId());
                await updateDoc(waitlistDocRef, { otpEnabled: formValue.isActive });
            }

            this.toastService.success('Template saved successfully');
        } catch (error) {
            console.error('Error saving template:', error);
            this.toastService.error('Failed to save template. Please try again.');
        } finally {
            this.saving.set(false);
        }
    }

    resetToDefault(): void {
        const defaults = this.getDefaultTemplate(this.activeTab());
        this.templateForm.patchValue({
            template: defaults.template,
            subject: defaults.subject,
        });
    }

    goBack(): void {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        if (returnUrl) {
            this.router.navigateByUrl(returnUrl);
        } else {
            this.router.navigate(['/admin/waitlists']);
        }
    }

    getPlaceholders(): string[] {
        return getEmailTags(this.activeTab());
    }

    // Broadcast specific methods
    isComposingBroadcast = signal(false);

    openBroadcastEditor(): void {
        this.isComposingBroadcast.set(true);
    }

    closeBroadcastEditor(): void {
        this.isComposingBroadcast.set(false);
    }

    onBroadcastSent(): void {
        this.isComposingBroadcast.set(false);
        this.loadBroadcastHistory(this.waitlistId());
    }

    getStatusClass(status: string): string {
        switch (status) {
            case 'sent':
                return 'status-sent';
            case 'sending':
                return 'status-sending';
            case 'failed':
                return 'status-failed';
            case 'draft':
                return 'status-draft';
            default:
                return '';
        }
    }

    formatDate(date: any): string {
        if (!date) return '-';
        const d = date.toDate ? date.toDate() : new Date(date);
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
        });
    }

    /**
     * Insert placeholder into subject field at cursor position
     */
    insertPlaceholderToSubject(placeholder: string): void {
        const subjectInput = document.querySelector('input[formControlName="subject"]') as HTMLInputElement;
        if (subjectInput) {
            const start = subjectInput.selectionStart || 0;
            const end = subjectInput.selectionEnd || 0;
            const currentValue = this.templateForm.get('subject')?.value || '';
            const newValue = currentValue.substring(0, start) + placeholder + currentValue.substring(end);
            this.templateForm.patchValue({ subject: newValue });

            // Restore focus and cursor position
            setTimeout(() => {
                subjectInput.focus();
                subjectInput.setSelectionRange(start + placeholder.length, start + placeholder.length);
            }, 0);
        } else {
            // Fallback: append to end
            const currentValue = this.templateForm.get('subject')?.value || '';
            this.templateForm.patchValue({ subject: currentValue + placeholder });
        }
    }

    /**
     * Handle subject placeholder dropdown selection
     */
    onSubjectPlaceholderSelect(event: Event): void {
        const select = event.target as HTMLSelectElement;
        const placeholder = select.value;
        if (placeholder) {
            this.insertPlaceholderToSubject(placeholder);
            select.value = ''; // Reset dropdown
        }
    }

    /**
     * Handle body placeholder dropdown selection
     */
    onBodyPlaceholderSelect(event: Event): void {
        const select = event.target as HTMLSelectElement;
        const placeholder = select.value;
        if (placeholder) {
            // Insert at cursor position using the email template editor
            if (this.emailTemplateEditor) {
                this.emailTemplateEditor.insertPlaceholder(placeholder);
            }
            select.value = ''; // Reset dropdown
        }
    }

    /**
     * Handle template content change from email editor
     */
    onTemplateContentChange(content: string): void {
        this.templateForm.patchValue({ template: content });
    }

    /**
     * Enable the current template (without saving)
     */
    enableTemplate(): void {
        this.templateForm.patchValue({ isActive: true });
    }

    /**
     * Enable the current template and save to database
     */
    async enableTemplateAndSave(): Promise<void> {
        this.templateForm.patchValue({ isActive: true });
        await this.saveTemplate();
    }

    /**
     * Handle checkbox change for template active status
     * Auto-saves when the template is disabled to persist the state
     */
    async onTemplateActiveChange(event: Event): Promise<void> {
        const checkbox = event.target as HTMLInputElement;
        if (!checkbox.checked) {
            // When unchecking, save immediately to persist the disabled state
            await this.saveTemplate();
        }
    }

    /**
     * Open test email dialog for current template
     */
    openTestEmailDialog(): void {
        const templateContent = this.templateForm.get('template')?.value;
        if (!templateContent) {
            this.toastService.error('Please add template content before sending a test email.');
            return;
        }

        this.dialog.open(TestEmailComponent, {
            enterAnimationDuration: '300ms',
            exitAnimationDuration: '200ms',
            width: '90vw',
            maxWidth: '1000px',
            maxHeight: '90vh',
            panelClass: 'test-email-dialog',
            data: {
                formValue: {
                    senderName: this.templateForm.get('senderName')?.value,
                    senderEmail: this.templateForm.get('senderEmail')?.value,
                    subject: this.templateForm.get('subject')?.value,
                    previewText: this.templateForm.get('previewText')?.value,
                },
                contentTemplate: templateContent,
            },
        });
    }
}
