/**
 * A refusal a member sees during sign-in, with a reason code and its numbers in
 * `details` (specs/sign-in-codes-spec.md, SC-D6). The sign-in page shows it from
 * its member strings (`member.auth.server_error.<reason>`) in the member's
 * language; `message` is the English fallback. A refusal that means a bug, such
 * as an unknown request, stays a plain HttpsError.
 */
import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
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

/** A refusal carried as data in a reply, as the callable would have thrown it. */
export interface CodeRefusal {
    code: string;
    message: string;
    details?: unknown;
}

/**
 * A code sent from inside a check (checkPhoneAccount, checkEmailAccount with
 * `sendCode`): the send's reply as `code`, or its refusal as `codeRefused`, so
 * a limit on codes never hides the check's answer (specs/sign-in-speed-spec.md,
 * SP-D7). An error that is not a refusal comes back as `internal`, which the
 * page shows as its own "could not send" text.
 */
export async function codeOrRefusal<T>(send: () => Promise<T>): Promise<{ code: T } | { codeRefused: CodeRefusal }> {
    try {
        return { code: await send() };
    } catch (err) {
        if (err instanceof HttpsError) return { codeRefused: { code: err.code, message: err.message, details: err.details } };
        logger.error('The code could not be sent.', err);
        return { codeRefused: { code: 'internal', message: 'internal' } };
    }
}
