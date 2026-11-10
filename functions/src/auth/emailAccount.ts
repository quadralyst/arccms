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
import { EMAIL_VERIFIED_WINDOW_MS, requestedLanguage, requestedName, sendSignupCode, signupCodeRequired, signupCodeVerifiedAt, verifiedEmailCode } from './signupOtp.js';
import { USER_RECORD_CLAIM } from '../users/claims.js';
import type { UserRecord } from 'firebase-admin/auth';
import { isWarmUp, WARM } from './warmUp.js';
import { refuseOtherSignIn } from './appAccountLock.js';
import { codeOrRefusal, refuse } from './refusal.js';
import { emailPinStatus, sendEmailPinCode } from './emailPin.js';
import { readDeviceKey } from './devices.js';

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

/**
 * With `sendCode: true` (the page sends it when sign-up needs a code, E4), a
 * new address while signups are open is also emailed its sign-up code, so the
 * page makes one call instead of two; the send's reply comes back as `code`, or
 * its refusal as `codeRefused` (specs/sign-in-speed-spec.md, SP-D6, SP-D7).
 *
 * A registered address also says what to ask for (`signInWith`: `password`, `pin`, or
 * `code` for a first PIN), whether this device needs a code first (`deviceCode`) and
 * whether to offer a PIN after the password (`offerPin`), from the account itself and
 * the site's email PIN setting (specs/sign-in-pin-spec.md); with `sendCode` it sends
 * the `device` or `pin-reset` code that comes next, the same way.
 */
export const checkEmailAccount = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const email = normalizeEmailAddress(request.data?.email);
    // The caller's limit, the settings and the record together; nothing is answered until the limit passes (SP-D4).
    const [, settings, record] = await Promise.all([
        consumeRateLimit(`check-ip-${callerKey(request)}`, 100, HOUR, 'Too many attempts. Please try again later.'),
        readSignInSettings(),
        findUserByEmail(email),
    ]);

    const { signupOpen } = settings;
    let status: EmailAccountStatus = 'new';
    if (record) {
        status = 'registered';
        const [pinStatus] = await Promise.all([
            emailPinStatus(record, settings, readDeviceKey(request.data?.deviceKey)),
            db.collection('email_lookup').doc(computeEmailHash(email)).set({ exists: true }),
        ]);
        const { codePurpose, ...how } = pinStatus;
        const reply = { status, signupOpen, ...how };
        if (request.data?.sendCode !== true || !codePurpose) return reply;
        const name = typeof record.data['name'] === 'string' ? record.data['name'] : undefined;
        return { ...reply, ...(await codeOrRefusal(() => sendEmailPinCode(request, email, codePurpose, name))) };
    } else {
        const account = await owner.getUserByEmail(email).catch(() => null);
        if (account) {
            const password = account.providerData?.some((p) => p.providerId === 'password');
            status = signupOpen && password && isUnfinishedSignup(account.metadata?.creationTime) ? 'unfinished' : 'no-access';
        }
    }
    const reply = { status, signupOpen };
    if (request.data?.sendCode !== true || status !== 'new' || !signupOpen) return reply;
    const options = { name: requestedName(request.data), language: requestedLanguage(request.data) };
    return { ...reply, ...(await codeOrRefusal(() => sendSignupCode(request, email, options))) };
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
 *
 * When the site asks new accounts for a sign-up code (signupCodeRequired, or email
 * PIN sign-in, where the code is the only proof), a record needs the ticket from
 * this browser's own code check: a sign-in account made straight through Firebase,
 * with no code, gets no record. The page then removes that sign-in and asks again.
 * A call with no ticket at all for a sign-in this site's sign-up made (see
 * removeUnfinishedSignup) removes that sign-in here and answers `signup-again`:
 * after a reload the page has lost the ticket, and the address must not stay blocked.
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
    const [settings, codeRequired] = await Promise.all([readSignInSettings(), signupCodeRequired()]);
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
    // Verified only with the ticket from this browser's own code check. Checked here and
    // used up once the record is written, so a retry after a failed write still has it.
    const ticket = request.data?.ticket;
    const emailVerified = await verifiedEmailCode(email, 'signup', ticket, false);
    if (!emailVerified && (codeRequired || settings.emailPin)) {
        // No ticket at all: a sign-up whose page was reloaded before this answered (the
        // ticket lives only in the page). Its sign-in would block the address for good,
        // so when this site's own sign-up made it, it goes, and the person signs up again.
        if (!ticket && await removeUnfinishedSignup(email, account)) {
            throw refuse('failed-precondition', 'signup-again', "Your sign-up didn't finish. Please sign up again.");
        }
        throw refuse('failed-precondition', 'code-expired', 'Your code has expired. Please ask for a new one.');
    }
    const ref = db.collection('users').doc();
    const now = Timestamp.now();
    await ref.set({
        id: ref.id,
        uid,
        name,
        email,
        emailVerified,
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
    await Promise.all([
        applyNewAccountClaims(uid, ref.id, settings.defaultRole),
        emailVerified ? verifiedEmailCode(email, 'signup', ticket, true) : Promise.resolve(false),
    ]);
    return { id: ref.id, created: true };
});

/** How long after its code check this site's sign-up creates the sign-in account. */
const SIGNUP_AFTER_CODE_MS = EMAIL_VERIFIED_WINDOW_MS;

/**
 * Delete a sign-in account this site's own email sign-up made and never finished,
 * and say whether it did. Only when every sign holds: a password sign-in and nothing
 * else, its email never verified, made within UNFINISHED_SIGNUP_MS, no `arccms_uid`
 * claim, no record (the caller checked), and this address passed this site's sign-up
 * code check shortly before the account was made. In a sign-in pool shared with another
 * app, that app's users fail the last test, so their accounts are never touched.
 */
export async function removeUnfinishedSignup(email: string, account: UserRecord, now = Date.now()): Promise<boolean> {
    const providers = account.providerData ?? [];
    if (account.emailVerified === true) return false;
    if (!providers.length || providers.some((p) => p.providerId !== 'password')) return false;
    if (!isUnfinishedSignup(account.metadata?.creationTime, now)) return false;
    if (account.customClaims?.[USER_RECORD_CLAIM]) return false;
    const created = Date.parse(account.metadata.creationTime);
    const codeAt = await signupCodeVerifiedAt(email);
    // A few seconds' leeway: two servers' clocks.
    if (codeAt === null || created < codeAt - 5_000 || created - codeAt > SIGNUP_AFTER_CODE_MS) return false;
    await owner.deleteUser(account.uid);
    return true;
}
