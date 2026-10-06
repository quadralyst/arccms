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

    /**
     * What a person reads when sign-in fails: plain words, and what to do next. Firebase
     * Auth error codes people can see, each with its message key (member.errors.*,
     * translated: specs/app-member-language-spec.md). Shown through firebaseErrorMessage().
     */
    public firebaseAuthErrors: ReadonlyArray<{ code: string; key: string }> = [
        { code: 'auth/missing-password', key: 'member.errors.missing_password' },
        { code: 'auth/email-already-in-use', key: 'member.errors.email_already_in_use' },
        { code: 'auth/invalid-email', key: 'member.errors.invalid_email' },
        { code: 'auth/operation-not-allowed', key: 'member.errors.operation_not_allowed' },
        { code: 'auth/weak-password', key: 'member.errors.weak_password' },
        { code: 'auth/user-disabled', key: 'member.errors.user_disabled' },
        { code: 'auth/user-not-found', key: 'member.errors.user_not_found' },
        { code: 'auth/wrong-password', key: 'member.errors.wrong_password' },
        { code: 'auth/account-exists-with-different-credential', key: 'member.errors.account_exists_with_different_credential' },
        { code: 'auth/credential-already-in-use', key: 'member.errors.credential_already_in_use' },
        { code: 'auth/popup-closed-by-user', key: 'member.errors.popup_closed_by_user' },
        { code: 'auth/cancelled-popup-request', key: 'member.errors.cancelled_popup_request' },
        { code: 'auth/popup-blocked', key: 'member.errors.popup_blocked' },
        { code: 'auth/invalid-phone-number', key: 'member.errors.invalid_phone_number' },
        { code: 'auth/quota-exceeded', key: 'member.errors.quota_exceeded' },
        { code: 'auth/missing-phone-number', key: 'member.errors.missing_phone_number' },
        { code: 'auth/too-many-requests', key: 'member.errors.too_many_requests' },
        { code: 'auth/code-expired', key: 'member.errors.code_expired' },
        { code: 'auth/invalid-verification-code', key: 'member.errors.invalid_verification_code' },
        { code: 'auth/network-request-failed', key: 'member.errors.network_request_failed' },
        { code: 'auth/internal-error', key: 'member.errors.internal_error' },
        { code: 'auth/invalid-credential', key: 'member.errors.invalid_credential' },
        { code: 'auth/requires-recent-login', key: 'member.errors.requires_recent_login' },
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
