/**
 * The codes a page asked for, by what they were for (channel, purpose, number or
 * address), so that coming back to one while its code still works goes to the
 * code boxes without sending again, and the resend countdown carries on
 * (specs/sign-in-codes-spec.md, SC-D1). Used by the sign-in page and the
 * profile's Sign-in methods.
 */

/** How long a code works on the server (OTP_TTL_MS in phoneOtp.ts and signupOtp.ts). */
export const CODE_LIFE_MS = 10 * 60 * 1000;
/** The wait between two codes for one number or address (RESEND_THROTTLE_MS). */
export const RESEND_SECONDS = 60;

export interface SentCode {
    at: number;
    /** The code shown on screen with a test provider, if any. */
    testCode: string;
    /** A test provider kept the code in the logs. */
    testCodeInLogs: boolean;
}

export class SentCodes {
    private readonly codes = new Map<string, SentCode>();

    constructor(private readonly now: () => number = Date.now) {}

    /** A code sent just now, or `wait` seconds short of the full minute (the server's "please wait"). */
    remember(key: string, shown: Omit<SentCode, 'at'>, wait?: number): void {
        const at = wait === undefined ? this.now() : this.now() - (RESEND_SECONDS - wait) * 1000;
        this.codes.set(key, { at, ...shown });
    }

    /** The code for `key` while it still works, else null. */
    fresh(key: string): SentCode | null {
        const code = this.codes.get(key);
        return code && this.now() - code.at < CODE_LIFE_MS ? code : null;
    }

    /** Used, or spent (expired, too many tries): the next visit sends a new one. */
    forget(key: string): void {
        this.codes.delete(key);
    }

    /** What is left of the minute since the code for `key` was sent. */
    secondsLeft(key: string): number {
        const code = this.codes.get(key);
        return code ? Math.max(0, RESEND_SECONDS - Math.floor((this.now() - code.at) / 1000)) : 0;
    }
}
