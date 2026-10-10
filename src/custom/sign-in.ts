/**
 * How hard new passwords and PINs must be (docs/app/sign-in.html). Arc CMS ships
 * this empty and never edits it again. Empty means strict: passwords of 8
 * characters or more that are not easy to guess, and PINs that are not repeated
 * digits or a run like 123456.
 *
 *   export const CUSTOM_SIGN_IN: SignInChoice = {
 *       strength: 'simple',   // passwords of 6 characters or more, any 6-digit PIN
 *   };
 *
 * The first admin, made on the onboarding page, always gets the strict rule. Only
 * new passwords and PINs are checked, so switching later locks nobody out.
 */
import type { SignInChoice } from '../shared/utils/sign-in-strength';

export const CUSTOM_SIGN_IN: SignInChoice = {};
