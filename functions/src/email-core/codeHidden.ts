/**
 * One-time codes out of Email Logs (specs/dev-review-fixes-spec.md, RF2 2.11): the
 * email needs its code only while it is being sent or may still be retried.
 * sendMail (mail-config/mailConfig.ts) hides it once the email went, failed for good
 * or was stopped by the kill switch; queueEmail hides it on an email a gate held back.
 */

/** What a one-time code reads as in Email Logs once the email went (or failed for good). */
export const CODE_PLACEHOLDER = '••••••';

/**
 * The fields that take a one-time code out of a log: the `otp` tag, and the code in
 * the composed subject and body. Empty when the log carries no code. The email needs
 * the code only while it is being sent; after that nobody reading Email Logs should
 * see it. The Simulated provider keeps it: nothing was sent, and Email Logs is where
 * a tester reads it (as the Test SMS provider keeps it in SMS Logs). A log that is
 * never sent (skipped by a gate or the kill switch) is never retried, so it loses
 * the code at once.
 */
export function codeHidden(
    code: unknown,
    composed: { subject?: string; template?: string } | undefined,
): Record<string, string> {
    if (typeof code !== 'string' || !code) return {};
    const hide = (text: string) => text.split(code).join(CODE_PLACEHOLDER);
    return {
        otp: CODE_PLACEHOLDER,
        ...(composed?.subject !== undefined ? { processedSubject: hide(composed.subject) } : {}),
        ...(composed?.template !== undefined ? { processedTemplate: hide(composed.template) } : {}),
    };
}
