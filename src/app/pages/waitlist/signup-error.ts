/**
 * A sign-up step's failure as a line in the member's language (RF6 6.1): picked by the
 * callable's code and reason, never the server's or the browser's own English. The same
 * mapping as formError in public/assets/js/arc-site.js, which published pages use.
 */
import type { TranslationKey } from '../../core/i18n/translation-keys';

/** Which step failed: joining, checking the code, sending it again, or confirming. */
export type SignupStep = 'join' | 'verify' | 'resend' | 'confirm';

const FALLBACK: Record<SignupStep, TranslationKey> = {
    join: 'member.signup_form.errors.failed',
    verify: 'member.signup_form.errors.code_invalid',
    resend: 'member.signup_form.errors.resend_failed',
    confirm: 'member.signup_form.errors.verify_failed',
};

/** `functions/permission-denied` (a callable's error) as `permission-denied`. */
function codeOf(error: unknown): string {
    const code = (error as { code?: unknown } | null)?.code;
    return typeof code === 'string' ? code.replace(/^functions\//, '') : '';
}

function reasonOf(error: unknown): string {
    const details = (error as { details?: unknown } | null)?.details;
    const reason = details && typeof details === 'object' ? (details as { reason?: unknown }).reason : undefined;
    return typeof reason === 'string' ? reason : '';
}

export function signupErrorKey(error: unknown, step: SignupStep): TranslationKey {
    const code = codeOf(error);
    const reason = reasonOf(error);
    // A callable that could not reach the server fails as `internal`; the browser says why.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'member.signup_form.errors.offline';
    if (reason === 'form-closed' || reason === 'form-missing') return 'member.signup_form.errors.form_closed';
    if (code === 'permission-denied') return 'member.signup_form.errors.expired';
    if (code === 'resource-exhausted') {
        if (reason === 'wait') return 'member.signup_form.errors.wait';
        if (reason === 'too-many-codes') return 'member.signup_form.errors.too_many_codes';
        if (reason === 'code-locked') return 'member.signup_form.errors.code_locked';
        return 'member.signup_form.errors.too_many';
    }
    if (step === 'verify' && ['invalid-argument', 'deadline-exceeded', 'not-found'].includes(code)) {
        return 'member.signup_form.errors.code_invalid';
    }
    if (step === 'join' && code === 'invalid-argument') return 'member.signup_form.errors.check_answers';
    return FALLBACK[step];
}
