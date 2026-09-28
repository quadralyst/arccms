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
 *   checkIdentifierForLink  is this email or number free, mine, or on another account?
 *   requestEmailLinkOtp     email a code to the new address
 *   linkEmail               after the code: the address moves to this account
 *   linkPhone               after the SMS code (phoneAuth `link`): the number moves here
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { ensureSystemLists, SYSTEM_LISTS, unlinkUserContact, upsertContact } from '../email-core/contacts.js';
import { createNotification } from '../email-core/notifications.js';
import { notifyAdmins } from '../email-core/adminAlerts.js';
import { arccmsOwnsAuthAccount } from '../users/authOwner.js';
import { readSmsSettings } from '../sms/smsSettings.js';
import { maskPhone, phoneHash } from './phoneNumber.js';
import { readPhone } from './phoneAuth.js';
import { consumeVerifiedPhoneOtp } from './phoneOtp.js';
import { consumeVerifiedEmailLinkOtp, issueEmailOtp } from './signupOtp.js';
import {
    ACCOUNT_TRANSFERS,
    AUTH_PINS,
    PHONE_INDEX,
    consumeRateLimit,
    findUserByEmail,
    findUserByPhone,
    hasPin,
    isValidPin,
    isWeakPin,
    requireOwnRecord,
    requirePhoneSignIn,
    setPin,
    type UserRecord,
} from './accounts.js';

const HOUR = 60 * 60 * 1000;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD_LENGTH = 8;

export type LinkKind = 'email' | 'phone';
export type LinkStatus = 'available' | 'yours' | 'other' | 'blocked';

export function normalizeEmailAddress(raw: unknown): string {
    const email = String(raw ?? '').trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email)) throw new HttpsError('invalid-argument', 'Enter a valid email address.');
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

/** An address nobody receives mail at, for an Auth account whose email moved away. */
export function releasedEmail(uid: string): string {
    return `${uid.toLowerCase()}@moved.invalid`;
}

async function passwordIsSet(uid: string): Promise<boolean> {
    const account = await owner.getUser(uid);
    return account.providerData.some((p) => p.providerId === 'password');
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

    if (raw.includes('@')) {
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
    await consumeRateLimit(`email-link-${uid}`, 10, HOUR, 'Too many codes. Please try again in an hour.');
    const result = await issueEmailOtp(email, 'link', { uid, name: String(me.data['name'] ?? '') || undefined });
    if (!result.sent) {
        throw new HttpsError('unavailable', "We couldn't send the email. Please try again in a moment.");
    }
    return { sent: true };
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
    if (isValidPin(pin) && isWeakPin(pin)) {
        throw new HttpsError('invalid-argument', 'That PIN is too easy to guess. Avoid repeated digits and runs like 123456.', { reason: 'weak-pin' });
    }
    if (!(await consumeVerifiedPhoneOtp(phone, 'link', { uid }))) {
        throw new HttpsError('failed-precondition', 'Please verify the number again.');
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

        if (holder) tx.update(holder.ref, removalUpdate(holder.data, 'phone', now));
        tx.set(newIndex, { userDocId: me.ref.id, uid, createdAt: now });
        if (oldIndex && oldIndexSnap?.data()?.['userDocId'] === me.ref.id) tx.delete(oldIndex);
        tx.update(me.ref, { phone, phoneVerified: true, modifiedAt: now });
        return holder;
    });

    if (isValidPin(pin)) await setPin(uid, pin);
    if (from) {
        // The PIN belonged to the number: without it the old account has no phone sign-in.
        await db.collection(AUTH_PINS).doc(String(from.data['uid'])).delete().catch(() => undefined);
        await afterMove('phone', maskPhone(phone), from, me);
        logger.info(`linkPhone: ${maskPhone(phone)} moved from ${from.ref.id} to ${me.ref.id}.`);
    }
    return { linked: true, moved: !!from };
});

export const linkEmail = onCall(async (request) => {
    const me = await requireOwnRecord(request);
    const uid = String(me.data['uid']);
    const email = normalizeEmailAddress(request.data?.email);
    const password = typeof request.data?.password === 'string' ? request.data.password : '';
    if (me.data['email'] === email) return { linked: true, moved: false };

    if (!arccmsOwnsAuthAccount(me.data)) {
        throw new HttpsError('failed-precondition', "Your sign-in is managed by another app, so its email can't be changed here.");
    }
    const needsPassword = !(await passwordIsSet(uid));
    if (needsPassword && password.length < MIN_PASSWORD_LENGTH) {
        throw new HttpsError('failed-precondition', 'Choose a password of at least 8 characters.', { reason: 'password-required' });
    }

    // Who holds the address now: an ArcCMS account (moves here) or a sign-in
    // with no ArcCMS record, such as another app's user (cannot move).
    const from = await findUserByEmail(email);
    if (from && !arccmsOwnsAuthAccount(from.data)) {
        throw new HttpsError('failed-precondition', 'This email belongs to an account managed by another app.');
    }
    const holder = await owner.getUserByEmail(email).catch(() => null);
    if (holder && holder.uid !== uid && holder.uid !== from?.data['uid']) {
        throw new HttpsError('failed-precondition', "This email is used by a sign-in that can't be moved here.");
    }

    if (!(await consumeVerifiedEmailLinkOtp(email, uid))) {
        throw new HttpsError('failed-precondition', 'Please verify the email again.');
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

    try {
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
        logger.info(`linkEmail: ${email} moved from ${from.ref.id} to ${me.ref.id}.`);
    }
    return { linked: true, moved: !!from };
});
