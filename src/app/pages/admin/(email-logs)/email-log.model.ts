import { IBaseModel } from '../../../../shared/models/base-model';

export interface IEmailLog extends IBaseModel {
    senderEmail: string;
    senderName: string;
    toName: string;
    toEmail: string;
    subject: string;
    template: string;
    processedSubject?: string;
    processedTemplate?: string;
    text: string;
    bcc?: string;
    type: string;
    status?: string;
    activeProvider?: string;
    messageId?: string;
    sendingTime?: Date;
    usedTags?: string[];
    unmappedTags?: string[];
    errorMessage?: string;
    isOpened?: boolean;
    openedAt?: Date;
    isHardBounce?: boolean;
    broadcastId?: string;
    lastWebhookEvent?: string;
    lastWebhookAt?: Date;
    ipAddress?: string;
    deliveryDetails?: any;
    bounceDetails?: any;
    complaintDetails?: any;
    otp?: string;
    /** The language the email is written in (specs/app-email-spec.md). */
    language?: string;
    /** Where replies go, when the email set its own. */
    replyTo?: string;
    /** An app email's reference, such as `businesses/b1/closings/c9`. */
    appRef?: string;
    /** The files it carried. `path` is where Storage keeps them; a blocked send only lists them. */
    attachments?: IEmailAttachment[];
}

export interface IEmailAttachment {
    name: string;
    contentType: string;
    size: number;
    path?: string;
}

/** A file size as people read it: 820 B, 12.4 KB, 1.2 MB. */
export function fileSize(bytes: number): string {
    if (!Number.isFinite(bytes) || bytes < 1024) return `${Math.max(0, Math.round(bytes || 0))} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export const EMAIL_LOGS_COLLECTION = 'EmailLogs';

/**
 * The subject as the person received it. Once sent, `processedSubject` is the
 * truth even when it came out blank (a tag with nothing to fill it); showing the
 * template's subject then, as the log used to, displays raw `##TAGS##` that were
 * never sent. Not yet sent, the template's subject is all there is.
 */
export function sentSubject(log: Pick<IEmailLog, 'subject' | 'processedSubject'>): string {
    const subject = log.processedSubject !== undefined && log.processedSubject !== null ? log.processedSubject : log.subject;
    return subject || '(no subject)';
}
