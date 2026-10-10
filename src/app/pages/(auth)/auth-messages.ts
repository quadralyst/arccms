/**
 * The sign-in messages the auth store and services show, as translation keys
 * (specs/app-member-language-spec.md, A1b), translated where they are shown, in the
 * person's language.
 */
import { translate } from '@jsverse/transloco';
import { ConstantVariables } from '../../../shared/constants/common-constants';
import type { TranslationKey } from '../../core/i18n/translation-keys';
import { minPasswordLength } from '../../../shared/utils/password-rule';
import { SIGN_IN_STRENGTH } from '../../core/sign-in/sign-in-strength';

export const NO_ACCESS_KEY: TranslationKey = 'member.auth.no_access';
export const BLOCKED_KEY: TranslationKey = 'member.auth.blocked';
export const UNFINISHED_SIGNUP_KEY: TranslationKey = 'member.auth.unfinished_signup';
export const FALLBACK_KEY: TranslationKey = 'member.errors.generic';

/** TranslocoService.translate, passed in by whoever shows the message. */
export type Translate = (key: TranslationKey, params?: Record<string, unknown>) => string;

const FIREBASE_ERRORS = new ConstantVariables().firebaseAuthErrors;

/** Firebase Auth's error code as a message people can read, else the fallback. */
export function firebaseErrorMessage(t: Translate, code: string | undefined, fallback: TranslationKey = FALLBACK_KEY): string {
    const key = FIREBASE_ERRORS.find((item) => item.code === code)?.key as TranslationKey | undefined;
    // `min` for the too-short password message (src/custom/sign-in.ts).
    return t(key ?? fallback, { min: minPasswordLength(SIGN_IN_STRENGTH) });
}

/**
 * "Something went wrong", for a plain function that has no injector. Translated once
 * Transloco has started, which is always the case on a page; the English sentence only
 * when nothing has started it yet.
 */
export function genericErrorText(): string {
    try {
        const text = translate(FALLBACK_KEY);
        if (text && text !== FALLBACK_KEY) return text;
    } catch {
        // Transloco not started yet
    }
    return 'Something went wrong. Please try again.';
}
