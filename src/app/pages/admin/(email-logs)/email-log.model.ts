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
