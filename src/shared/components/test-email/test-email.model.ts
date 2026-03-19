/**
 * Test Email Model
 * Represents a test email sent to verify template appearance
 */

import { IBaseModel } from '../../models/base-model';

export interface ITestEmail extends IBaseModel {
    senderEmail: string;
    senderName: string;
    toEmail: string;
    toName: string;
    subject: string;
    template: string;
    text?: string;
    type?: string;
}

export const TEST_EMAIL_COLLECTION = 'EmailLogs';
