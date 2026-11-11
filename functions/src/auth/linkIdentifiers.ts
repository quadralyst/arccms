/**
 * Adding or changing the email or phone number of the signed-in account, from
 * the profile page. Both go through a verification code, and a verified code
 * is proof enough of ownership: when the number or address is on another
 * account it moves here.
 *
 * The other account keeps everything else (profiles, progress, purchases). If
 * the move leaves it no way to sign in it is detached: kept, blocked, and
 * shown to admins under Users, Detached, never deleted. Otherwise its owner
 * is told. Every move is recorded in `account_transfers`.
 *
 * An account that already has a way in (a PIN, a password, an email or a number)
 * needs a fresh code first (docs/app/fresh-code.html, purposes `link-email` and
 * `link-phone`), sent to its own address or number: a session alone must not be
 * able to put in a number or address of its choosing and then reset the PIN or
 * password through it. When an email or number replaces another, the person is
 * told on the old one (an email to the old address; for a number, an email to the
 * account's address and a notification, since a text needs a registered template).
 *
 *   checkIdentifierForLink  is this email or number free, mine, or on another account?
 *   requestEmailLinkOtp     email a code to the new address
 *   linkEmail               after the code: the address moves to this account
 *   linkPhone               after the SMS code (phoneAuth `link`): the number moves here
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { FieldValue, Timestamp, type Transaction } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { ensureSystemLists, SYSTEM_LISTS, unlinkUserContact, upsertContact } from '../email-core/contacts.js';
import { isFeatureOn } from '../feature-flags.js';
import { createNotification } from '../email-core/notifications.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';
import { arccmsOwnsAuthAccount } from '../users/authOwner.js';
import { readSmsSettings } from '../sms/smsSettings.js';
import { maskPhone, phoneHash } from './phoneNumber.js';
import { readPhone } from './phoneAuth.js';
import { cleanEmail, cleanPasted } from './pastedText.js';
import { consumeVerifiedPhoneOtp } from './phoneOtp.js';
import { consumeVerifiedEmailLinkOtp, emailCodeAskedAgain, isSimulatedEmail, issueEmailOtp, requestedLanguage } from './signupOtp.js';
import {
    ACCOUNT_TRANSFERS,
    AUTH_PINS,
    PHONE_INDEX,
    consumeRateLimit,
    releaseRateLimit,
    findUserByEmail,
    findUserByPhone,
    hasPin,
    isValidPin,
    pinTooEasy,
    requireOwnRecord,
    requirePhoneSignIn,
    setPin,
    type UserRecord,
} from './accounts.js';
import { refuse, refuseWeakPassword } from './refusal.js';
import { minPasswordLength } from '../shared/password-rule.js';
import { signInStrength } from '../sign-in-choice.js';
import { emailForLog } from './logSafe.js';
import { maskEmail, useFreshCodeProof } from './freshCode.js';
import { isBlank } from '../shared/blank.js';
import { queueEmail } from '../email-core/queueEmail.js';
import { readEmailBrand, wrapInEmailLayout } from '../email-core/emailLayout.js';
import { isActiveAdmin, requireAnotherActiveAdmin } from '../users/activeAdmins.js';

const HOUR = 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export type LinkKind = 'email' | 'phone';
export type LinkStatus = 'available' | 'yours' | 'other' | 'blocked';

export function normalizeEmailAddress(raw: unknown): string {
    const email = cleanEmail(raw);
    if (!EMAIL_PATTERN.test(email)) throw refuse('invalid-argument', 'invalid-email', 'Enter a valid email address.');
    return email;
}

/** Whether a record can still sign in once `removing` is taken off it. */
export function hasSignInLeft(data: Record<string, unknown>, removing: LinkKind): boolean {
    const email = removing === 'email' ? '' : String(data['email'] ?? '');
    const phone = removing === 'phone' ? '' : String(data['phone'] ?? '');
    return !!(email || phone);
}

/** The fields that take `kind` off a record, detaching it when nothing is left. */
export function removalUpdate(data: Record<string, unknown>, kind: LinkKind, now: Timestamp): Record<string, unknown> {
    const update: Record<string, unknown> = kind === 'email'
        ? { email: '', emailVerified: false, modifiedAt: now }
        : { phone: FieldValue.delete(), phoneVerified: false, modifiedAt: now };
    if (!hasSignInLeft(data, kind)) {
        Object.assign(update, { status: 'Detached', isActive: false, detachedAt: now, detachedReason: `${kind}_moved` });
    }
    return update;
}

/** Said when moving an email or number here would leave the site's last admin with no way in. */
export const LAST_ADMIN_SIGN_IN = "This is the only way into the site's only admin account, so it can't move here. The site needs another admin first.";

/**
 * Refuse (`last-admin`) a move that would detach the holder when it is the site's last
 * active admin: a detached account cannot sign in, and the site would have no admin.
 */
export async function refuseDetachingLastAdmin(holder: UserRecord | null, kind: LinkKind, tx: Transaction | null = null): Promise<void> {
    if (!holder || hasSignInLeft(holder.data, kind) || !isActiveAdmin(holder.data)) return;
    await requireAnotherActiveAdmin(tx, holder.ref.id, holder.data['uid'], LAST_ADMIN_SIGN_IN);
}

/** An address nobody receives mail at, for an Auth account whose email moved away. */
export function releasedEmail(uid: string): string {
    return `${uid.toLowerCase()}@moved.invalid`;
}

async function passwordIsSet(uid: string): Promise<boolean> {
    const account = await owner.getUser(uid);
    return account.providerData.some((p) => p.providerId === 'password');
}

/** The fresh code purposes linkEmail and linkPhone take a proof for. */
export const LINK_FRESH_PURPOSE = { email: 'link-email', phone: 'link-phone' } as const;

/** Whether the account has a way in already: then adding or changing one needs a fresh code. */
export async function linkNeedsFreshCode(data: Record<string, unknown>, uid: string): Promise<boolean> {
    if (!isBlank(data['email']) || !isBlank(data['phone'])) return true;
    const [pin, password] = await Promise.all([hasPin(uid), passwordIsSet(uid)]);
    return pin || password;
}

/** Refuse (`fresh-code-required`) unless the request carries a fresh-code proof for this kind, when one is needed. */
async function requireLinkProof(request: Parameters<typeof useFreshCodeProof>[0] & { data?: Record<string, unknown> }, me: UserRecord, uid: string, kind: LinkKind): Promise<void> {
    if (!(await linkNeedsFreshCode(me.data, uid))) return;
    await useFreshCodeProof(request, request.data?.['freshProof'], LINK_FRESH_PURPOSE[kind]);
}

/**
 * Tell the person their email or number was replaced, on the old one where that can be
 * reached. Best effort: the change already happened.
 */
async function tellReplaced(kind: LinkKind, me: UserRecord, oldValue: string, newValue: string): Promise<void> {
    const label = kind === 'email' ? 'email address' : 'phone number';
    const shown = kind === 'email' ? maskEmail(newValue) : maskPhone(newValue);
    const text = `The ${label} on your account was changed to ${shown}. If this wasn't you, contact us at once.`;
    const to = kind === 'email' ? oldValue : String(me.data['email'] ?? '').trim().toLowerCase();
    const sends: Promise<unknown>[] = [createNotification({
        userId: String(me.data['uid'] ?? ''), type: 'account_security', title: `Your ${label} was changed`, body: text,
    })];
    if (!isBlank(to) && to.includes('@')) {
        sends.push((async () => queueEmail({
            source: 'auth',
            category: 'transactional',
            toEmail: to,
            toName: String(me.data['name'] ?? '') || undefined,
            senderEmail: '',
            senderName: '',
            subject: `Your ${label} was changed`,
            template: wrapInEmailLayout(`<p>${text}</p>`, await readEmailBrand()),
            text,
            type: kind === 'email' ? 'email_changed_email' : 'phone_changed_email',
        }))());
    }
    const results = await Promise.allSettled(sends);
    for (const r of results) if (r.status === 'rejected') logger.error(`link${kind === 'email' ? 'Email' : 'Phone'}: could not tell the old ${label}`, r.reason);
}

/** Record the move and tell whoever needs to know. Best effort: the move itself already happened. */
async function afterMove(kind: LinkKind, shown: string, from: UserRecord, to: UserRecord): Promise<void> {
    const detached = !hasSignInLeft(from.data, kind);
    const fromUid = String(from.data['uid'] ?? '');
    const label = kind === 'email' ? 'email address' : 'phone number';
    await Promise.allSettled([
        db.collection(ACCOUNT_TRANSFERS).add({
            kind,
            shown,
            fromUserDocId: from.ref.id,
            fromUid,
            toUserDocId: to.ref.id,
            toUid: String(to.data['uid'] ?? ''),
            detached,
            at: Timestamp.now(),
        }),
        detached
            ? notifyAdmins('admin_account_detached', {
                title: 'Account detached',
                body: `${from.data['name'] || 'An account'} lost its only sign-in (${shown}) to another account. It is kept but cannot sign in.`,
                link: '/admin/users',
            })
            : createNotification({
                userId: fromUid,
                type: 'account_security',
                title: `Your ${label} was moved`,
                body: `The ${label} ${shown} was verified on another account and removed from yours. If this wasn't you, please contact us.`,
            }),
    ]);
}

export const checkIdentifierForLink = onCall(async (request) => {
    const me = await requireOwnRecord(request);
    const uid = String(me.data['uid']);
    const raw = String(request.data?.identifier ?? '');

    if (cleanPasted(raw).includes('@')) {
        const email = normalizeEmailAddress(raw);
        const needsPassword = !(await passwordIsSet(uid));
        if (me.data['email'] === email) return { kind: 'email', value: email, status: 'yours', needsPassword };
        const record = await findUserByEmail(email);
        let status: LinkStatus = 'available';
        if (record) {
            status = arccmsOwnsAuthAccount(record.data) ? 'other' : 'blocked';
        } else {
            const holder = await owner.getUserByEmail(email).catch(() => null);
            if (holder && holder.uid !== uid) status = 'blocked';
        }
        return { kind: 'email', value: email, status, needsPassword };
    }

    await requirePhoneSignIn();
    const phone = readPhone(raw, await readSmsSettings());
    const needsPin = !(await hasPin(uid));
    if (me.data['phone'] === phone) return { kind: 'phone', value: phone, status: 'yours', needsPin };
    const record = await findUserByPhone(phone);
    return { kind: 'phone', value: phone, status: record ? 'other' : 'available', needsPin };
});

export const requestEmailLinkOtp = onCall(async (request) => {
    const me = await requireOwnRecord(request);
    const uid = String(me.data['uid']);
    const email = normalizeEmailAddress(request.data?.email);
    // Asked again within the minute: the code already sent, nothing new (F22). Checked
    // first, and a code that was not sent is given back (specs/sign-in-codes-spec.md, SC-D3, SC-D4).
    const asked = await emailCodeAskedAgain(email, 'link', uid);
    if (asked) return { sent: true, ...((await isSimulatedEmail()) ? { testMode: true } : {}), alreadySent: true, wait: asked.wait };
    const limit = `email-link-${uid}`;
    await consumeRateLimit(limit, 10, HOUR, 'Too many codes. Please try again later.', 'too-many-codes');
    let result: Awaited<ReturnType<typeof issueEmailOtp>>;
    try {
        result = await issueEmailOtp(email, 'link', { uid, name: String(me.data['name'] ?? '') || undefined, language: requestedLanguage(request.data) });
    } catch (err) {
        // Counted but not sent (a refusal from the provider, or a second request at once).
        await releaseRateLimit(limit);
        throw err;
    }
    if (!result.sent) {
        await releaseRateLimit(limit);
        throw refuse('unavailable', 'email-failed', "We couldn't send the email. Please try again in a moment.");
    }
    // Simulated provider: nothing was sent, and the code is in Email Logs, for admins.
    const again = result.sameCode ? { sameCode: true } : {};
    return result.testMode ? { sent: true, testMode: true, ...again } : { sent: true, ...again };
});

export const linkPhone = onCall(async (request) => {
    await requirePhoneSignIn();
    const me = await requireOwnRecord(request);
    const uid = String(me.data['uid']);
    const phone = readPhone(request.data?.phone, await readSmsSettings());
    const pin = request.data?.pin;
    if (me.data['phone'] === phone) return { linked: true, moved: false };

    const needsPin = !(await hasPin(uid));
    if (needsPin && !isValidPin(pin)) {
        throw new HttpsError('failed-precondition', 'Choose a 6-digit PIN.', { reason: 'pin-required' });
    }
    if (needsPin && pinTooEasy(pin)) {
        throw new HttpsError('invalid-argument', 'That PIN is too easy to guess. Avoid repeated digits and runs like 123456.', { reason: 'weak-pin' });
    }
    // Before any code is used up: the move must not leave the site without an admin.
    const current = await findUserByPhone(phone);
    if (current && current.ref.id !== me.ref.id) await refuseDetachingLastAdmin(current, 'phone');
    // Before the number's code is used up, so a page that still needs the fresh code keeps it.
    await requireLinkProof(request, me, uid, 'phone');
    if (!(await consumeVerifiedPhoneOtp(phone, 'link', { uid }))) {
        throw refuse('failed-precondition', 'code-expired', 'Please verify the number again.');
    }

    const now = Timestamp.now();
    const newIndex = db.collection(PHONE_INDEX).doc(phoneHash(phone));
    const oldPhone = typeof me.data['phone'] === 'string' ? me.data['phone'] : '';
    const oldIndex = oldPhone ? db.collection(PHONE_INDEX).doc(phoneHash(oldPhone)) : null;

    const from = await db.runTransaction(async (tx) => {
        const index = await tx.get(newIndex);
        const oldIndexSnap = oldIndex ? await tx.get(oldIndex) : null;
        let holder: UserRecord | null = null;
        const holderDocId = index.data()?.['userDocId'];
        if (holderDocId && holderDocId !== me.ref.id) {
            const snap = await tx.get(db.collection('users').doc(String(holderDocId)));
            if (snap.exists && snap.data()?.['phone'] === phone) holder = { ref: snap.ref, data: snap.data() ?? {} };
        }

        // Again in the transaction: an admin may have gone meanwhile.
        await refuseDetachingLastAdmin(holder, 'phone', tx);
        if (holder) tx.update(holder.ref, removalUpdate(holder.data, 'phone', now));
        tx.set(newIndex, { userDocId: me.ref.id, uid, createdAt: now });
        if (oldIndex && oldIndexSnap?.data()?.['userDocId'] === me.ref.id) tx.delete(oldIndex);
        tx.update(me.ref, { phone, phoneVerified: true, modifiedAt: now });
        return holder;
    });

    // Only a first PIN: changing one the account has needs the old one (setPin.ts).
    if (needsPin) await setPin(uid, pin as string);
    if (from) {
        // The PIN belonged to the number: without it the old account has no phone sign-in.
        await db.collection(AUTH_PINS).doc(String(from.data['uid'])).delete().catch(() => undefined);
        await afterMove('phone', maskPhone(phone), from, me);
        logger.info(`linkPhone: ${maskPhone(phone)} moved from ${from.ref.id} to ${me.ref.id}.`);
    }
    if (!isBlank(oldPhone) && oldPhone !== phone) await tellReplaced('phone', me, oldPhone, phone);
    return { linked: true, moved: !!from };
});

export const linkEmail = onCall(async (request) => {
    const me = await requireOwnRecord(request);
    const uid = String(me.data['uid']);
    const email = normalizeEmailAddress(request.data?.email);
    const password = typeof request.data?.password === 'string' ? request.data.password : '';
    if (me.data['email'] === email) return { linked: true, moved: false };

    if (!arccmsOwnsAuthAccount(me.data)) {
        throw refuse('failed-precondition', 'sign-in-managed', "Your sign-in is managed by another app, so its email can't be changed here.");
    }
    const needsPassword = !(await passwordIsSet(uid));
    const min = minPasswordLength(signInStrength());
    if (needsPassword && password.length < min) {
        throw new HttpsError('failed-precondition', `Choose a password of at least ${min} characters.`, { reason: 'password-required', min });
    }
    // A new password, not one set before: too easy to guess is refused (F22).
    if (needsPassword) refuseWeakPassword(password, { email, name: String(me.data['name'] ?? '') });

    // Who holds the address now: an ArcCMS account (moves here) or a sign-in
    // with no ArcCMS record, such as another app's user (cannot move).
    const from = await findUserByEmail(email);
    if (from && !arccmsOwnsAuthAccount(from.data)) {
        throw refuse('failed-precondition', 'email-managed', 'This email belongs to an account managed by another app.');
    }
    const holder = await owner.getUserByEmail(email).catch(() => null);
    if (holder && holder.uid !== uid && holder.uid !== from?.data['uid']) {
        throw refuse('failed-precondition', 'email-not-movable', "This email is used by a sign-in that can't be moved here.");
    }

    if (from && from.ref.id !== me.ref.id) await refuseDetachingLastAdmin(from, 'email');

    // Before the address's code is used up, so a page that still needs the fresh code keeps it.
    await requireLinkProof(request, me, uid, 'email');
    if (!(await consumeVerifiedEmailLinkOtp(email, uid))) {
        throw refuse('failed-precondition', 'code-expired', 'Please verify the email again.');
    }

    if (holder && holder.uid !== uid) {
        // Free the address on the other sign-in, and take its email-based ways in
        // with it: a Google sign-in left there would reopen the old account.
        const unlink = holder.providerData.map((p) => p.providerId).filter((id) => id === 'password' || id === 'google.com');
        await owner.updateUser(holder.uid, {
            email: releasedEmail(holder.uid),
            emailVerified: false,
            ...(unlink.length ? { providersToUnlink: unlink } : {}),
        });
    }
    await owner.updateUser(uid, { email, emailVerified: true, ...(needsPassword ? { password } : {}) });

    const now = Timestamp.now();
    const oldEmail = typeof me.data['email'] === 'string' ? me.data['email'] : '';
    const batch = db.batch();
    batch.update(me.ref, { email, emailVerified: true, modifiedAt: now });
    if (from) batch.update(from.ref, removalUpdate(from.data, 'email', now));
    batch.set(db.collection('email_lookup').doc(computeEmailHash(email)), { exists: true });
    if (oldEmail) batch.delete(db.collection('email_lookup').doc(computeEmailHash(oldEmail)));
    await batch.commit();

    // Contacts are the audience feature's (specs/feature-flags-spec.md).
    if (isFeatureOn('audience')) try {
        if (oldEmail) await unlinkUserContact(oldEmail);
        await ensureSystemLists();
        await upsertContact({
            email,
            name: String(me.data['name'] ?? '') || undefined,
            userId: uid,
            source: 'signup',
            addLists: [SYSTEM_LISTS.ALL_USERS],
        });
    } catch (err) {
        logger.error('linkEmail: contact sync failed', err);
    }

    if (from) {
        await afterMove('email', email, from, me);
        logger.info(`linkEmail: ${emailForLog(email)} moved from ${from.ref.id} to ${me.ref.id}.`);
    }
    if (!isBlank(oldEmail) && oldEmail !== email) await tellReplaced('email', me, oldEmail, email);
    return { linked: true, moved: !!from };
});
