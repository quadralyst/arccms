import type { CallableRequest } from 'firebase-functions/v2/https';

/**
 * The sign-in page calls the functions a sign-in or sign-up uses with
 * `{ warmUp: true }` as it opens (SignInService.warmUp), so each one starts
 * while the person is still typing: a cold start takes seconds. Such a call
 * does nothing and returns at once, before any check or rate limit.
 */
export function isWarmUp(request: Pick<CallableRequest, 'data'>): boolean {
    return (request.data as { warmUp?: unknown } | undefined)?.warmUp === true;
}

/** What a warm-up call returns. */
export const WARM = { warm: true } as const;
