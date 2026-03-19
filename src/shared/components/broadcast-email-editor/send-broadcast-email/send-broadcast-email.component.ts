/**
 * Send Broadcast Email Component
 * 
 * Dialog component for confirming and sending broadcast emails.
 * Shows email preview and handles the send operation.
 */

import { CommonModule } from '@angular/common';
import { Component, inject } from '@angular/core';
import { FormBuilder, FormGroup, ReactiveFormsModule, Validators } from '@angular/forms';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { Firestore, collection, addDoc, serverTimestamp } from '@angular/fire/firestore';
import { ToastService } from '../../../services/toast.service';
import { BroadcastEmailStore } from './send-broadcast-email.store';
import { IBroadcastEmail, IBroadcastRecipient } from './send-broadcast-email.model';

interface DialogData {
    formValue: {
        subject: string;
        senderName: string;
        senderEmail: string;
        previewText: string;
    };
    contentTemplate: string;
    selectedUsers: IBroadcastRecipient[];
    waitlistId: string;
}

@Component({
    selector: 'arc-send-broadcast-email',
    standalone: true,
    imports: [CommonModule, ReactiveFormsModule],
    templateUrl: './send-broadcast-email.component.html',
    styleUrls: ['./send-broadcast-email.component.scss'],
})
export class SendBroadcastEmailComponent {
    readonly dialogData = inject<DialogData>(MAT_DIALOG_DATA);
    readonly dialogRef = inject(MatDialogRef<SendBroadcastEmailComponent>);
    private readonly sanitizer = inject(DomSanitizer);
    private readonly toastService = inject(ToastService);
    private readonly broadcastStore = inject(BroadcastEmailStore);
    private readonly fb = inject(FormBuilder);
    private readonly firestore = inject(Firestore);

    confirmForm: FormGroup;
    previewContent: SafeHtml;
    isSending = false;

    constructor() {
        this.confirmForm = this.fb.group({
            subject: [this.dialogData.formValue.subject || '', Validators.required],
        });

        this.previewContent = this.sanitizer.bypassSecurityTrustHtml(this.dialogData.contentTemplate);
    }

    get recipientCount(): number {
        return this.dialogData.selectedUsers?.length || 0;
    }

    get subject(): string {
        return this.dialogData.formValue.subject;
    }

    get senderName(): string {
        return this.dialogData.formValue.senderName;
    }

    get senderEmail(): string {
        return this.dialogData.formValue.senderEmail;
    }

    /**
     * Queue broadcast for server-side processing.
     * Creates a single BroadcastEmails document with status 'queued'.
     * The processBroadcast cloud function picks it up and creates
     * individual EmailLogs per recipient with rate-limited delays.
     */
    async sendBroadcastEmail(): Promise<void> {
        if (this.isSending) return;

        // Fix 6: Validate recipients before proceeding
        if (!this.dialogData.selectedUsers?.length) {
            this.toastService.error('No recipients selected.');
            return;
        }

        this.isSending = true;

        try {
            // Map recipients to lightweight objects for inline storage
            const recipients = (this.dialogData.selectedUsers || []).map((user) => ({
                toName: user.toName,
                toEmail: user.toEmail,
            }));

            const broadcastData = {
                waitlistId: this.dialogData.waitlistId,
                subject: this.dialogData.formValue.subject,
                senderName: this.dialogData.formValue.senderName,
                senderEmail: this.dialogData.formValue.senderEmail,
                previewText: this.dialogData.formValue.previewText,
                template: this.dialogData.contentTemplate,
                recipients,
                totalCount: recipients.length,
                sentCount: 0,
                failedCount: 0,
                processedIndex: 0,
                status: 'queued',
                chunkNumber: 0,
                createdAt: serverTimestamp(),
            };

            const broadcastRef = await addDoc(
                collection(this.firestore, 'BroadcastEmails'),
                broadcastData,
            );

            this.toastService.success(
                `Broadcast queued for ${recipients.length} recipients. Processing will begin shortly.`,
            );
            this.dialogRef.close({ success: true, broadcastId: broadcastRef.id });
        } catch (error) {
            console.error('Error queuing broadcast:', error);
            this.toastService.error('Failed to queue broadcast email. Please try again.');
        } finally {
            this.isSending = false;
        }
    }

    /**
     * Dismiss the dialog without sending
     */
    dismissModal(): void {
        this.dialogRef.close({ success: false });
    }
}
