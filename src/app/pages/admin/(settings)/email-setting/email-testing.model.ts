/**
 * Email Testing Configuration
 */
export interface IEmailTestingConfig {
    id?: string;
    /** Whether email testing is enabled */
    isEnabled: boolean;
    /** Active email provider */
    activeProvider: 'smtp' | 'resend' | 'gmail';
    /** Default sender email address */
    senderEmail: string;
    /** Default sender display name */
    senderName: string;
    /** Reply-to email address (optional) */
    replyToEmail?: string;
    /** SMTP configuration */
    smtp: {
        host: string;
        port: number;
        secure: boolean;
        user: string;
        password: string;
    };
    /** Resend configuration */
    resend: {
        apiKey: string;
    };
    /** Gmail configuration */
    gmail: {
        user?: string;
        password?: string;
    };
    /** BCC email for admin copies */
    bccEmail?: string;
    /** Timestamp when settings were created */
    createdAt?: Date;
    /** Timestamp when settings were last updated */
    updatedAt?: Date;
}

/**
 * Default email testing configuration
 */
export const DEFAULT_EMAIL_TESTING_CONFIG: IEmailTestingConfig = {
    isEnabled: false,
    activeProvider: 'smtp',
    senderEmail: '',
    senderName: 'Arc CMS',
    replyToEmail: '',
    smtp: {
        host: '',
        port: 587,
        secure: false,
        user: '',
        password: '',
    },
    resend: {
        apiKey: '',
    },
    gmail: {
        user: '',
        password: '',
    },
    bccEmail: '',
};
