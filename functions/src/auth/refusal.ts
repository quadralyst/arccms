/**
 * A refusal a member sees during sign-in, with a reason code and its numbers in
 * `details` (specs/sign-in-codes-spec.md, SC-D6). The sign-in page shows it from
 * its member strings (`member.auth.server_error.<reason>`) in the member's
 * language; `message` is the English fallback. A refusal that means a bug, such
 * as an unknown request, stays a plain HttpsError.
 */
import { HttpsError, type FunctionsErrorCode } from 'firebase-functions/v2/https';

export function refuse(code: FunctionsErrorCode, reason: string, message: string, extra: Record<string, unknown> = {}): HttpsError {
    return new HttpsError(code, message, { reason, ...extra });
}

