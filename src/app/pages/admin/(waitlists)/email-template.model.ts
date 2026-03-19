/**
 * Email Template Model
 */

export interface IEmailTemplate {
    id?: string;
    waitlistId: string;
    type: 'waitlist_verify_otp_email' | 'waitlist_welcome_email' | 'waitlist_broadcast_email';
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
