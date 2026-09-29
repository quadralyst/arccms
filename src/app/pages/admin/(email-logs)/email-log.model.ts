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
