/**
 * Broadcast Email Model
 * Represents a broadcast email sent to waitlist users
 */

import { IBaseModel } from '../../../../shared/models/base-model';

export interface IBroadcastEmail extends IBaseModel {
    waitlistId: string;
    subject: string;
    senderName: string;
    senderEmail: string;
    previewText?: string;
    template: string;
    /** Total number of recipients */
    totalCount: number;
    /** Successfully queued for sending */
    sentCount: number;
    /** Failed after all retry attempts */
    failedCount: number;
    /** Next recipient index to process */
    processedIndex: number;
    /** Number of processing chunks completed */
    chunkNumber: number;
    status: BroadcastStatus;
    recipientCount?: number;
    sentAt?: Date;
    errorMessage?: string;
}

export type BroadcastStatus = 'draft' | 'queued' | 'processing' | 'paused' | 'completed' | 'failed';

export interface IBroadcastRecipient {
    toName: string;
    toEmail: string;
}

export const BROADCAST_EMAIL_COLLECTION = 'BroadcastEmails';
