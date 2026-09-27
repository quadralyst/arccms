import { IBaseModel } from '../../../../shared/models/base-model';

/** One SMS, sent or (with the Test provider) only recorded. Written by functions/src/sms/sendSms.ts. */
export interface ISmsLog extends IBaseModel {
    /** E.164, e.g. `+919876543210`. */
    to: string;
    purpose: 'otp' | 'test' | string;
    provider: 'log' | 'msg91' | string;
    /** The full text for the Test provider; the code is blanked for a real one. */
    text: string;
    status: 'logged' | 'sent' | 'failed';
    error?: string;
    providerMessageId?: string;
}

export const SMS_LOGS_COLLECTION = 'SmsLogs';
