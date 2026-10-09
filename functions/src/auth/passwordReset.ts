/**
 * Forgot password (specs/password-reset-page-spec.md): a code by email, then a
 * new password, both on the sign-in page, as Forgot PIN is by SMS.
 *
 * Firebase's own reset email led to Firebase's page, which took any password of
 * 6 characters, spoke only English and left an installed app for the browser.
 * Here the code goes through the email engine (template `password_reset_otp_email`)
 * and the new password is checked against the password rule before the Admin SDK
 * sets it. When the email engine sends nothing (email off, no provider), the page
 * falls back to Firebase's reset email.
 */
import { onCall } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { owner } from '../init.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { callerKey, canSignIn, consumeRateLimit, findUserByEmail, readSignInSettings, releaseRateLimit } from './accounts.js';
import { normalizeEmailAddress } from './linkIdentifiers.js';
import { isUnfinishedSignup } from './emailAccount.js';
import { consumeVerifiedResetCode, emailCodeAskedAgain, issueEmailOtp, resetCodesShown } from './signupOtp.js';
import { isWarmUp, WARM } from './warmUp.js';
import { refuse, refuseWeakPassword } from './refusal.js';
import { AUTH_OWNER } from '../users/authOwner.js';
import { APP_MANAGED, isLockedAppAccount } from '../users/lockedAppAccount.js';

const HOUR = 60 * 60 * 1000;

/** What a host app's user is told: their login is that app's to reset. */
export const HOST_ACCOUNT = 'Reset your password in the app you signed up with.';

/** The account a reset changes. */
interface ResetTarget {
    uid: string;
    name?: string;
}

/**
 * Whose password this address resets, or the refusal. In a sign-in pool shared
 * with a host app (CO6), a login the host app owns (`authOwner: host`) or with no
 * Arc CMS record is the host app's to reset; a `shared` one is the same person's
 * one login, so Arc CMS resets it. A locked app account and a blocked one are
 * refused, as everywhere else. A recent sign-up whose record was never written
 * (isUnfinishedSignup) is reset too: its next sign-in finishes it.
 */
export async function resetTarget(email: string): Promise<ResetTarget> {
    const record = await findUserByEmail(email);
    if (record) {
        if (isLockedAppAccount(record.data)) throw refuse('permission-denied', 'app-managed', APP_MANAGED);
        if (!canSignIn(record.data)) {
            throw refuse('permission-denied', 'account-blocked', 'This account is blocked. Please contact the site administrator.');
        }
        if (record.data['authOwner'] === AUTH_OWNER.HOST) throw refuse('failed-precondition', 'host-account', HOST_ACCOUNT);
        const uid = String(record.data['uid'] ?? '');
        if (!uid) throw refuse('not-found', 'no-email-account', 'No account uses this email.');
        const name = typeof record.data['name'] === 'string' ? record.data['name'] : undefined;
        return { uid, name };
    }
    const account = await owner.getUserByEmail(email).catch(() => null);
    if (!account) throw refuse('not-found', 'no-email-account', 'No account uses this email.');
    const password = account.providerData?.some((p) => p.providerId === 'password');
    if (password && isUnfinishedSignup(account.metadata?.creationTime) && (await readSignInSettings()).signupOpen) {
        return { uid: account.uid, name: account.displayName || undefined };
    }
    throw refuse('failed-precondition', 'host-account', HOST_ACCOUNT);
}

/**
 * Forgot password, first step: email this address a reset code. Limits as for a
 * sign-up code: one a minute and 5 an hour per address, 20 an hour per caller.
 * `sent: false` when the email engine sent nothing (email off, no provider, the
 * address suppressed): the page then asks Firebase to email its reset link.
 * While testing with the Simulated provider the reply carries the code
 * (`testCode`) only when an admin turned on "Show password reset codes on
 * screen"; otherwise it is in Email Logs (`testCodeInLogs`).
 */
export const requestPasswordReset = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const email = normalizeEmailAddress(request.data?.email);
    const target = await resetTarget(email);
    const asked = await emailCodeAskedAgain(email, 'reset');
    if (asked) {
        const test = (await resetCodesShown()) ? { testMode: true, testCode: asked.code } : {};
        return { sent: true, status: 'pending', ...test, alreadySent: true, wait: asked.wait };
    }
    const callerLimit = `reset-otp-ip-${callerKey(request)}`;
    const addressLimit = `reset-otp-${computeEmailHash(email)}`;
    await consumeRateLimit(callerLimit, 20, HOUR, 'Too many attempts. Please try again later.');
    await consumeRateLimit(addressLimit, 5, HOUR, 'Too many codes for this address. Please try again later.', 'too-many-codes');
    try {
        const reply = await issueEmailOtp(email, 'reset', { name: target.name });
        if (!reply.sent) await Promise.all([releaseRateLimit(callerLimit), releaseRateLimit(addressLimit)]);
        return reply;
    } catch (err) {
        await Promise.all([releaseRateLimit(callerLimit), releaseRateLimit(addressLimit)]);
        throw err;
    }
});

/**
 * Forgot password, last step: the new password, with the ticket from checking
 * the code (verifySignupOtp, purpose `reset`), so only the browser that entered
 * the code can use it. The password rule is checked first, so a refused password
 * leaves the code usable. Every other session is signed out, as after a PIN
 * reset; the page then signs in with the new password.
 */
export const resetPassword = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const email = normalizeEmailAddress(request.data?.email);
    const password = typeof request.data?.password === 'string' ? request.data.password : '';
    if (!password) throw refuse('invalid-argument', 'password-required', 'Please enter your password.');
    const target = await resetTarget(email);
    refuseWeakPassword(password, { email, name: target.name });
    if (!(await consumeVerifiedResetCode(email, request.data?.ticket))) {
        throw refuse('failed-precondition', 'code-expired', 'That code has expired. Please ask for a new one.');
    }
    await owner.updateUser(target.uid, { password });
    await owner.revokeRefreshTokens(target.uid);
    logger.info(`resetPassword: a new password was set for ${email} with a reset code.`);
    return { reset: true };
});
