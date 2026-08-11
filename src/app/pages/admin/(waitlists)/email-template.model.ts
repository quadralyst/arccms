/**
 * Email Template Model
 */

/** Payment/subscription transactional email types (global scope, no waitlistId). */
export type PaymentEmailType =
    | 'payment_succeeded_email'
    | 'payment_failed_email'
    | 'subscription_lifecycle_email'
    | 'trial_ending_email';

export interface IEmailTemplate {
    id?: string;
    /** Optional for payment emails, which are global rather than waitlist-scoped. */
    waitlistId?: string;
    /** 'payments' for the payment email types; absent for waitlist templates. */
    scope?: 'payments';
    type:
        | 'waitlist_verify_otp_email'
        | 'waitlist_welcome_email'
        | 'waitlist_broadcast_email'
        | PaymentEmailType;
    senderEmail: string;
    senderName: string;
    subject: string;
    template: string;
    previewText?: string;
    isActive: boolean;
    createdAt?: Date;
    updatedAt?: Date;
}




// ── Payment email templates ──
// Supported tags: ##NAME##, ##PAYMENT_AMOUNT##, ##CURRENCY##, ##PAYMENT_STATUS##,
// ##SUBSCRIPTION_PLAN##, ##RENEWAL_DATE##, ##TRIAL_ENDS_AT##

export const DEFAULT_PAYMENT_SUCCEEDED_TEMPLATE = `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Payment received 🎉</h2>
    <p>Hi ##NAME##,</p>
    <p>Thank you! We've successfully received your payment of <strong>##PAYMENT_AMOUNT##</strong> for the <strong>##SUBSCRIPTION_PLAN##</strong> plan.</p>
    <p>Your access is now active. Your next renewal date is ##RENEWAL_DATE##.</p>
    <p>If you have any questions, just reply to this email.</p>
</div>
`;

export const DEFAULT_PAYMENT_FAILED_TEMPLATE = `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Payment failed</h2>
    <p>Hi ##NAME##,</p>
    <p>Unfortunately your payment of <strong>##PAYMENT_AMOUNT##</strong> for the <strong>##SUBSCRIPTION_PLAN##</strong> plan could not be processed.</p>
    <p>Please update your payment method to keep your access active.</p>
</div>
`;

export const DEFAULT_SUBSCRIPTION_LIFECYCLE_TEMPLATE = `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Subscription update</h2>
    <p>Hi ##NAME##,</p>
    <p>There's an update to your subscription. Current status: <strong>##PAYMENT_STATUS##</strong>.</p>
    <p>If this wasn't expected, please get in touch with us.</p>
</div>
`;

export const DEFAULT_TRIAL_ENDING_TEMPLATE = `
<div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px;">
    <h2>Your trial ends soon</h2>
    <p>Hi ##NAME##,</p>
    <p>Your free trial of the <strong>##SUBSCRIPTION_PLAN##</strong> plan ends on <strong>##TRIAL_ENDS_AT##</strong>.</p>
    <p>You'll be charged automatically when the trial ends — no action needed to continue.</p>
</div>
`;

/*
 * The default OTP / welcome / broadcast bodies used to live here as
 * DEFAULT_OTP_TEMPLATE, DEFAULT_WELCOME_TEMPLATE and DEFAULT_BROADCAST_TEMPLATE.
 *
 * They were a second copy of what the server seeds, and they had drifted into a
 * different document altogether — a full <!DOCTYPE html> page rather than an
 * embeddable body, different copy, and a subject that never named the form. So
 * "Reset to default" handed the admin an email the system would never send.
 *
 * The definitions now live only in functions/src/email-core/defaultTemplates.ts
 * (buildWaitlistTemplateDefs) and reach this page through the read-only
 * `getWaitlistTemplateDefaults` callable.
 */
