/**
 * Test Email Component
 * 
 * Dialog component for sending test emails to verify template appearance.
 * Features:
 * - Template preview with live variable replacement
 * - Form for recipient details
 * - Variable extraction and value input
 */

import { CommonModule, DOCUMENT } from '@angular/common';
import { Component, inject, Inject, SecurityContext } from '@angular/core';
import { FormArray, FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { ToastService } from '../../services/toast.service';
import { TestEmailStore } from './test-email.store';
import { ITestEmail } from './test-email.model';

interface DialogData {
    formValue: {
        subject: string;
        senderName: string;
        senderEmail: string;
        previewText?: string;
    };
    contentTemplate: string;
    allSelectedTemplateData?: {
        type?: string;
    };
}

@Component({
    selector: 'arc-test-email',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './test-email.component.html',
    styleUrls: ['./test-email.component.scss'],
})
export class TestEmailComponent {
    readonly dialogData = inject<DialogData>(MAT_DIALOG_DATA);
    readonly dialogRef = inject(MatDialogRef<TestEmailComponent>);
    private readonly fb = inject(FormBuilder);
    private readonly sanitizer = inject(DomSanitizer);
    private readonly toastService = inject(ToastService);
    readonly testEmailStore = inject(TestEmailStore);

    testEmailForm: FormGroup;
    previewContent: SafeHtml;

    constructor(@Inject(DOCUMENT) private document: Document) {
        this.testEmailForm = this.fb.group({
            subject: [this.dialogData.formValue.subject || '', Validators.required],
            toEmail: ['', [Validators.required, Validators.email]],
            toName: ['', Validators.required],
            variables: this.fb.array([]),
        });

        this.previewContent = this.sanitizer.bypassSecurityTrustHtml(this.dialogData.contentTemplate);
    }

    ngOnInit(): void {
        this.extractAndSetVariables();

        this.testEmailForm.get('variables')?.valueChanges.subscribe(() => {
            this.updatePreview();
        });
    }

    get variables(): FormArray {
        return this.testEmailForm.get('variables') as FormArray;
    }

    /**
     * Extract template variables (##VAR##) and create form controls for each
     */
    private extractAndSetVariables(): void {
        const regex = /##([^#]+)##/g;
        const matches = [...this.dialogData.contentTemplate.matchAll(regex)];

        // Use Set to avoid duplicate variables
        const uniqueVariables = new Set<string>();

        matches.forEach((match) => {
            const variableName = match[1].toLowerCase();
            if (!uniqueVariables.has(variableName)) {
                uniqueVariables.add(variableName);
                this.variables.push(
                    this.fb.group({
                        name: [variableName],
                        value: ['', Validators.required],
                    })
                );
            }
        });
    }

    /**
     * Update preview with current variable values
     */
    updatePreview(): void {
        let updatedContent = this.dialogData.contentTemplate;
        const variables = this.variables.value;

        variables.forEach((variable: { name: string; value: string }) => {
            if (variable.value) {
                const regex = new RegExp(`##${variable.name}##`, 'gi');
                updatedContent = updatedContent.replace(regex, variable.value);
            }
        });

        const decodedContent = this.decodeHtmlEntities(updatedContent);
        this.previewContent = this.sanitizer.bypassSecurityTrustHtml(decodedContent);
    }

    private decodeHtmlEntities(html: string): string {
        const textarea = this.document.createElement('textarea');
        textarea.innerHTML = html;
        return textarea.value;
    }

    /**
     * Send test email
     */
    onSubmit(): void {
        if (!this.testEmailForm.valid) {
            return;
        }

        const formData = this.testEmailForm.value;
        const finalTemplate = this.sanitizer.sanitize(SecurityContext.HTML, this.previewContent);

        const emailObj = {
            senderEmail: this.dialogData.formValue.senderEmail,
            senderName: this.dialogData.formValue.senderName,
            toEmail: formData.toEmail,
            toName: formData.toName,
            subject: formData.subject,
            template: finalTemplate || '',
            text: this.dialogData.formValue.previewText || '',
            type: this.dialogData.allSelectedTemplateData?.type || 'test',
        };

        this.testEmailStore.add(emailObj as any).subscribe({
            next: (id) => {
                this.toastService.success('Test email sent successfully!');

                // Reset form for another test email
                this.testEmailForm.get('toEmail')?.setValue('');
                this.testEmailForm.get('toName')?.setValue('');

                // Reset variables
                const formArr = this.testEmailForm.get('variables') as FormArray;
                formArr.clear();
                this.extractAndSetVariables();
            },
            error: (error) => {
                console.error('Error sending test email:', error);
                this.toastService.error('Failed to send test email. Please try again.');
            },
        });
    }

    /**
     * Dismiss dialog
     */
    dismissModal(): void {
        this.dialogRef.close();
    }
}
