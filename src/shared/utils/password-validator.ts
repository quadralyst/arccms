/**
 * The password rule (password-rule.ts) as a form validator, for every field where
 * someone chooses a new password. Never on a sign-in field: a password set before
 * still signs in.
 */
import type { AbstractControl, ValidationErrors, ValidatorFn } from '@angular/forms';
import { passwordProblem, type PasswordOwner, type PasswordProblem } from './password-rule';
import type { SignInStrength } from './sign-in-strength';
import { SIGN_IN_STRENGTH } from '../../app/core/sign-in/sign-in-strength';

/**
 * `{ password: <problem> }` while the password is too easy to guess; nothing for an
 * empty field (`required` says that). The rule is the app's strength
 * (src/custom/sign-in.ts) unless the field names one: onboarding asks for strict.
 */
export function newPasswordValidator(owner: () => PasswordOwner = () => ({}), strength: SignInStrength = SIGN_IN_STRENGTH): ValidatorFn {
    return (control: AbstractControl): ValidationErrors | null => {
        const value = String(control.value ?? '');
        if (!value) return null;
        const problem = passwordProblem(value, owner(), strength);
        return problem ? { password: problem } : null;
    };
}

/** The problem a field's validator found, for its message (`member.auth.password_error.<problem>`). */
export function passwordProblemOf(control: AbstractControl | null | undefined): PasswordProblem | null {
    return (control?.errors?.['password'] as PasswordProblem | undefined) ?? null;
}
