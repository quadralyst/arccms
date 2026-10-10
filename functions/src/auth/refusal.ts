/**
 * A refusal a member sees during sign-in, with a reason code and its numbers in
 * `details` (specs/sign-in-codes-spec.md, SC-D6). The sign-in page shows it from
 * its member strings (`member.auth.server_error.<reason>`) in the member's
 * language; `message` is the English fallback. A refusal that means a bug, such
 * as an unknown request, stays a plain HttpsError.
 */
import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';
import { minPasswordLength, passwordProblem, passwordProblemText, type PasswordOwner } from '../shared/password-rule.js';
import type { SignInStrength } from '../shared/sign-in-strength.js';
import { signInStrength } from '../sign-in-choice.js';

export function refuse(code: FunctionsErrorCode, reason: string, message: string, extra: Record<string, unknown> = {}): HttpsError {
    return new HttpsError(code, message, { reason, ...extra });
}

/**
 * Refuse a new password that is too easy to guess (shared/password-rule.ts, F22),
 * with the reason `weak-password`, the `problem` and the shortest length (`min`),
 * which the page says in the member's language. The rule is the app's strength
 * (src/custom/sign-in.ts) unless the caller names one.
 */
export function refuseWeakPassword(password: string, owner: PasswordOwner, strength: SignInStrength = signInStrength()): void {
    const problem = passwordProblem(password, owner, strength);
    if (problem) {
        throw refuse('invalid-argument', 'weak-password', passwordProblemText(problem, strength), { problem, min: minPasswordLength(strength) });
    }
}
