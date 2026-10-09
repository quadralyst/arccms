/**
 * The sign-in page's first question for an email: sign in, sign up, or no access?
 *
 * The page used to answer it from `email_lookup`, which only says whether a
 * trigger once wrote a hash. That misses records whose trigger never ran (a
 * database recreated, triggers bound elsewhere) and sends those people to
 * sign-up. This asks the `users` records themselves, repairs a missing lookup
 * entry on the way, and recognises a login with no ArcCMS record (another app's
 * user in a shared sign-in pool), which gets "no access" at once.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import {
    applyNewAccountClaims,
    callerKey,
    consumeRateLimit,
    findUserByEmail,
    findUserByUid,
    readSignInSettings,
    requireSignedIn,
} from './accounts.js';
import { normalizeEmailAddress } from './linkIdentifiers.js';
import { readName } from './phoneAuth.js';
import { authOwnerFor } from './googleAccount.js';
import { consumeVerifiedSignupCode } from './signupOtp.js';
import { isWarmUp, WARM } from './warmUp.js';
import { refuseOtherSignIn } from './appAccountLock.js';
import { refuse } from './refusal.js';
import { arccmsOwnsAuthAccount } from '../users/authOwner.js';

const HOUR = 60 * 60 * 1000;

export type EmailAccountStatus = 'registered' | 'new' | 'no-access' | 'unfinished';

/**
 * A password sign-in this recent with no record is a sign-up whose last step
 * (createAccountRecord) never answered, not another app's user (review F): the
 * next sign-in finishes it. Older ones stay no access.
 */
export const UNFINISHED_SIGNUP_MS = 24 * HOUR;

export function isUnfinishedSignup(creationTime: string | undefined, now = Date.now()): boolean {
    const created = creationTime ? Date.parse(creationTime) : NaN;
    return Number.isFinite(created) && now - created <= UNFINISHED_SIGNUP_MS;
}

export const checkEmailAccount = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    await consumeRateLimit(`check-ip-${callerKey(request)}`, 100, HOUR, 'Too many attempts. Please try again later.');
    const email = normalizeEmailAddress(request.data?.email);
    const { signupOpen } = await readSignInSettings();

    let status: EmailAccountStatus = 'new';
    if (await findUserByEmail(email)) {
        status = 'registered';
        await db.collection('email_lookup').doc(computeEmailHash(email)).set({ exists: true });
    } else {
        const account = await owner.getUserByEmail(email).catch(() => null);
        if (account) {
            const password = account.providerData?.some((p) => p.providerId === 'password');
            status = signupOpen && password && isUnfinishedSignup(account.metadata?.creationTime) ? 'unfinished' : 'no-access';
        }
    }
    return { status, signupOpen };
});

/**
 * Email sign-up, second half: the browser has just created the password sign-in
 * account; this creates the person's record, with the site's default role and
 * the `arccms_uid` claim, so the claim is in the token when sign-in completes.
 * The record used to be written from the browser, which left the claim to a
 * trigger that finished some time after sign-in.
 *
 * `emailVerified` comes from the server's own sign-up code record, never from
 * the browser. Calling it again for someone who has a record changes nothing.
 * `finish` (a sign-in finishing an unfinished sign-up, auth.store login): only
 * for a sign-in created within UNFINISHED_SIGNUP_MS, so another app's user
 * signing in here never gets a record that way.
 */
export const createAccountRecord = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const uid = requireSignedIn(request);
    const existing = await findUserByUid(uid);
    if (existing) {
        // A locked app account with a password linked to it in the browser (appAccountLock.ts).
        await refuseOtherSignIn(request, existing);
        return { id: existing.ref.id, created: false };
    }

    const token = request.auth!.token as { email?: string; firebase?: { sign_in_provider?: string } };
    const email = String(token.email ?? '').trim().toLowerCase();
    if (token.firebase?.sign_in_provider !== 'password' || !email) {
        throw refuse('failed-precondition', 'sign-in-again', 'Please sign in again.');
    }
    const settings = await readSignInSettings();
    if (!settings.signupOpen) {
        throw new HttpsError('failed-precondition', "New accounts can't be created on this site right now.", { reason: 'signup-closed' });
    }
    if (await findUserByEmail(email)) {
        throw refuse('already-exists', 'email-has-account', 'You already have an account with this email. Enter your password to sign in.');
    }

    const name = readName(request.data?.name);
    const account = await owner.getUser(uid);
    if (request.data?.finish === true && !isUnfinishedSignup(account.metadata?.creationTime)) {
        throw new HttpsError('permission-denied', "This account doesn't have access to this site.", { reason: 'no-access' });
    }
    const ref = db.collection('users').doc();
    const now = Timestamp.now();
    await ref.set({
        id: ref.id,
        uid,
        name,
        email,
        // Verified only with the ticket from this browser's own code check.
        emailVerified: await consumeVerifiedSignupCode(email, request.data?.ticket),
        role: settings.defaultRole,
        status: 'Active',
        isActive: true,
        authOwner: authOwnerFor(account.metadata.creationTime),
        by: 'email',
        createdBy: uid,
        modifiedBy: uid,
        createdAt: now,
        modifiedAt: now,
    });
    await applyNewAccountClaims(uid, ref.id, settings.defaultRole);
    return { id: ref.id, created: true };
});

/**
 * Whether the sign-in page may show a password reset link instead of emailing it
 * (F22): only while email goes to the Simulated provider, which sends nothing, and
 * only when an admin turned on "Show password reset links on screen" (Settings,
 * Email), which warns that anyone could then reset any account's password.
 */
export async function resetLinksShown(): Promise<boolean> {
    const settings = (await db.collection('Settings').doc('email').get()).data();
    return settings?.['isEnabled'] === true && settings?.['activeProvider'] === 'debug_log' && settings?.['showResetLinks'] === true;
}

/**
 * Forgot password, while testing (F22): the reset link, made here, for the page to
 * show, since Firebase's own reset email reaches neither the Simulated provider nor
 * Email Logs. `{ shown: false }` whenever the links are not shown (the switch is
 * off, or real email is on): the page then asks Firebase to email it, as always.
 * Only for an account this site owns: a host app's user in a shared sign-in pool
 * keeps their password.
 */
export const requestPasswordResetLink = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    await consumeRateLimit(`reset-link-ip-${callerKey(request)}`, 20, HOUR, 'Too many attempts. Please try again later.');
    const email = normalizeEmailAddress(request.data?.email);
    if (!(await resetLinksShown())) return { shown: false };
    const record = await findUserByEmail(email);
    if (!record || !arccmsOwnsAuthAccount(record.data)) {
        throw refuse('not-found', 'no-email-account', 'No account uses this email.');
    }
    const link = await owner.generatePasswordResetLink(email);
    logger.info('requestPasswordResetLink: a reset link was shown on the sign-in page (test mode).');
    return { shown: true, link };
});
