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

    /**
     * Media Manager tabs, each tagged with the kind of thing it produces.
     *
     * The dialog serves two different jobs — picking an image and picking an
     * icon — and a caller wants exactly one of them. `kind` is what lets the
     * component show only the tabs whose result that caller can actually
     * accept: an icon field offering "Free Images" is a dead end, because
     * choosing a photo there returns a URL the field will discard.
     *
     * Image tabs are on by default so every existing caller is unaffected;
     * icons are opt-in. See `MediaDialogData`.
     */
    public mediaManagerMenu: any = [
        {
            name: 'My Uploads',
            value: 'upload',
            icon: 'upload',
            kind: 'image',
        },
        {
            name: 'Free Images',
            value: 'search',
            icon: 'image',
            kind: 'image',
        },
        {
            name: 'Icons',
            value: 'icons',
            icon: 'icons',
            kind: 'icon',
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

    /** What a person reads when sign-in fails: plain words, and what to do next. */
    public firebaseAuthErrors = [
        { code: 'auth/missing-password', message: 'Please enter your password.' },
        { code: 'auth/email-already-in-use', message: 'You already have an account with this email. Enter your password to sign in.' },
        { code: 'auth/invalid-email', message: 'That email address does not look right.' },
        { code: 'auth/operation-not-allowed', message: 'This way of signing in is not turned on for this site.' },
        { code: 'auth/weak-password', message: 'Use at least 8 characters for your password.' },
        { code: 'auth/user-disabled', message: 'This account is blocked. Please contact the site administrator.' },
        { code: 'auth/user-not-found', message: 'Wrong email or password. Please try again.' },
        { code: 'auth/wrong-password', message: 'Wrong password. Please try again, or use Forgot Password.' },
        {
            code: 'auth/account-exists-with-different-credential',
            message: 'You already have an account with this email. Sign in with your password.',
        },
        {
            code: 'auth/credential-already-in-use',
            message: 'This sign-in is already used by another account.',
        },
        { code: 'auth/popup-closed-by-user', message: 'The sign-in window was closed. Please try again.' },
        {
            code: 'auth/cancelled-popup-request',
            message: 'A sign-in window is already open.',
        },
        { code: 'auth/popup-blocked', message: 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.' },
        { code: 'auth/invalid-phone-number', message: 'Enter a valid mobile number.' },
        { code: 'auth/quota-exceeded', message: 'We cannot send more codes right now. Please try again later.' },
        { code: 'auth/missing-phone-number', message: 'Enter your mobile number.' },
        { code: 'auth/too-many-requests', message: 'Too many attempts. Please wait a few minutes and try again.' },
        { code: 'auth/code-expired', message: 'That code has expired. Please ask for a new one.' },
        { code: 'auth/invalid-verification-code', message: "That code didn't work." },
        {
            code: 'auth/network-request-failed',
            message: 'No internet connection. Check your connection and try again.',
        },
        { code: 'auth/internal-error', message: 'Something went wrong. Please try again.' },
        // Current Firebase returns this for a wrong password or an unknown email alike.
        { code: 'auth/invalid-credential', message: 'Wrong password. Please try again, or use Forgot Password.' },
        {
            code: 'auth/requires-recent-login',
            message: 'For your security, please sign in again and retry.',
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
