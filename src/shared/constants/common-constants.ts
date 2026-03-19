import { Injectable } from '@angular/core';

@Injectable({
    providedIn: 'root'
})
export class ConstantVariables {
    public PAGINATION_LIMIT: number = 10;

    public APPLICATION_NAME: string = 'Arc CMS';

    public ADMIN = 'admin';
    public USER = 'user';
    public CUSTOMER = 'customer';

    public mediaManagerMenu: any = [
        {
            name: 'My Uploads',
            value: 'upload',
            icon: 'upload',
        },
        {
            name: 'Free Images',
            value: 'search',
            icon: 'image',
        },
    ];

    public fixedRoles = [
        {
            userType: 'admin',
            userTypeLabel: 'Admin',
        },
        {
            userType: 'customer',
            userTypeLabel: 'User',
        },
    ];

    public roles = [...this.fixedRoles];

    public defaultEmailTags = ['##OTP##', '##RECEIVER_NAME##', '##COMPANY_NAME##'];

    public firebaseAuthErrors = [
        { code: 'auth/missing-password', message: 'Your password is missing.' },
        { code: 'auth/email-already-in-use', message: 'The email address is already in use by another account.' },
        { code: 'auth/invalid-email', message: 'The email address is not valid.' },
        { code: 'auth/operation-not-allowed', message: 'Email/password authentication is not enabled.' },
        { code: 'auth/weak-password', message: 'The password must be at least 6 characters long.' },
        { code: 'auth/user-disabled', message: 'The user account has been disabled by an administrator.' },
        { code: 'auth/user-not-found', message: 'There is no user record corresponding to this identifier.' },
        { code: 'auth/wrong-password', message: 'The password is incorrect.' },
        {
            code: 'auth/account-exists-with-different-credential',
            message: 'An account already exists with the same email but different sign-in credentials.',
        },
        {
            code: 'auth/credential-already-in-use',
            message: 'This credential is already associated with a different user account.',
        },
        { code: 'auth/popup-closed-by-user', message: 'The authentication popup was closed before completion.' },
        {
            code: 'auth/cancelled-popup-request',
            message: 'Multiple pop-ups requested, but only one can be open at a time.',
        },
        { code: 'auth/popup-blocked', message: 'The authentication popup was blocked by the browser.' },
        { code: 'auth/invalid-phone-number', message: 'The phone number is not a valid phone number.' },
        { code: 'auth/quota-exceeded', message: 'SMS quota exceeded for the project.' },
        { code: 'auth/missing-phone-number', message: 'A phone number must be provided for authentication.' },
        { code: 'auth/too-many-requests', message: 'Too many requests were made; try again later.' },
        { code: 'auth/code-expired', message: 'The SMS verification code has expired.' },
        { code: 'auth/invalid-verification-code', message: 'The verification code entered is incorrect.' },
        {
            code: 'auth/network-request-failed',
            message: 'A network error (e.g., timeout, interrupted connection) occurred.',
        },
        { code: 'auth/internal-error', message: 'An internal Firebase error occurred.' },
        { code: 'auth/invalid-credential', message: 'The supplied credential is invalid or has expired.' },
        {
            code: 'auth/requires-recent-login',
            message:
                'This operation is sensitive and requires recent authentication. Log in again before retrying this request.',
        },
    ];

    // Soft pastel color palette for tags
    public tagsColorOptions = [
        { color: '#FFB3BA', title: 'Rose' },
        { color: '#FFDFBA', title: 'Peach' },
        { color: '#FFFFBA', title: 'Lemon' },
        { color: '#BAFFC9', title: 'Mint' },
        { color: '#BAE1FF', title: 'Sky' },
        { color: '#EECBFF', title: 'Lavender' },
        { color: '#A2E1DB', title: 'Seafoam' },
        { color: '#F6EAC2', title: 'Cream' },
        { color: '#E2F0CB', title: 'Lime' },
        { color: '#FF9AA2', title: 'Coral' },
        { color: '#C7CEEA', title: 'Periwinkle' },
        { color: '#B5EAD7', title: 'Sage' },
        { color: '#E0BBE4', title: 'Orchid' },
        { color: '#FFC8A2', title: 'Apricot' },
        { color: '#CCF1FF', title: 'Ice' },
        { color: '#F0E6EF', title: 'Blush' },
        { color: '#FCF6BD', title: 'Butter' },
        { color: '#D4F1F4', title: 'Aqua' },
        { color: '#F4C2C2', title: 'Pink' },
        { color: '#DCD0FF', title: 'Lilac' },
    ];

    public PUBLISH = 'publish';
    public DRAFT = 'draft';

    /* ===================== For Response Generation Type ================ */
    public REFINE = 'refinePrompt';
    public FETCH_CONTENT = 'fetchContent';

    public CRON_JOB_STATUS = {
        EXECUTED: 'executed',
        ERROR: 'error',
        PENDING: 'pending',
    };

    public EMAIL_SEND_STATUS = {
        QUEUED: 'QUEUED',
        SENT: 'SENT',
        DELIVERED: 'DELIVERED',
        SOFT_BOUNCE: 'SOFT_BOUNCE',
        HARD_BOUNCE: 'HARD_BOUNCE',
        OPENED: 'OPENED',
        NOT_OPENED: 'NOT OPENED',
        CLICKED: 'CLICKED',
        COMPLAINT: 'COMPLAINT',
        FAILED: 'FAILED',
    };

    public defaultSystemInstruction =
        'Ensure responses are from actual web sites with a valid URL. Do not use example.com or any other made up name. Do not imagine any content. Stick to what you know for sure has a valid URl. Give me at least 5 records.';
}
