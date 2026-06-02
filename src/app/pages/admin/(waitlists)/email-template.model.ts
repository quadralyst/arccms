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

export const DEFAULT_OTP_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .otp-code { font-size: 32px; font-weight: bold; text-align: center; padding: 20px; background: #f5f5f5; border-radius: 8px; letter-spacing: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Verify Your Email</h2>
        <p>Hi ##NAME##,</p>
        <p>Thank you for signing up! Please use the following code to verify your email:</p>
        <div class="otp-code">##OTP##</div>
        <p>This code expires in 15 minutes.</p>
        <p>If you didn't request this, please ignore this email.</p>
    </div>
</body>
</html>
`;

export const DEFAULT_WELCOME_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
        .referral-box { padding: 20px; background: #f5f5f5; border-radius: 8px; margin: 20px 0; }
    </style>
</head>
<body>
    <div class="container">
        <h2>Welcome to the Waitlist!</h2>
        <p>Hi ##NAME##,</p>
        <p>You're officially on the waitlist! Here's your queue position: <strong>###POSITION##</strong></p>
        <div class="referral-box">
            <h3>Move Up the Queue!</h3>
            <p>Share your referral link and move up for every friend who joins:</p>
            <p><strong>##REFERRAL_LINK##</strong></p>
        </div>
        <p>We'll notify you as soon as you get access.</p>
    </div>
</body>
</html>
`;

export const DEFAULT_BROADCAST_TEMPLATE = `
<!DOCTYPE html>
<html>
<head>
    <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .container { max-width: 600px; margin: 0 auto; padding: 20px; }
    </style>
</head>
<body>
    <div class="container">
        <h2>##SUBJECT##</h2>
        <p>Hi ##NAME##,</p>
        <p>##CONTENT##</p>
        <hr>
        <p style="font-size: 12px; color: #666;">
            You received this email because you're on our waitlist.<br>
            <a href="##UNSUBSCRIBE_LINK##">Unsubscribe</a>
        </p>
    </div>
</body>
</html>
`;

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
