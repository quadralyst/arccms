/**
 * Admin: change a member's phone number, from Users > Edit user.
 *
 * For a member who signs in by phone and lost their phone: the code to prove the
 * old number would go to the lost phone. The new number must be a valid one the
 * site allows, and not on any other account (a `users` record, the phone index or
 * a sign-in account).
 *
 * The record gets the number with `phoneVerified: false`, and the phone index points
 * the number at it. The member proves it with a code at their next phone sign-in:
 * their PIN and remembered devices are cleared and their sessions ended (whoever has
 * the lost phone is signed out within the hour), so the sign-in page sends a code to
 * the new number and asks for a new PIN, as Forgot PIN does; resetPin then marks the
 * number verified. A sign-in account that already carries a number gets the new one
 * too. A member with an email is told by the account_security notification.
 *
 * Refused for a locked app account (its app manages it), a sign-in another app owns
 * or shares (that app changes it), and a record with no sign-in account.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db, owner } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import { refuse } from '../auth/refusal.js';
import { AUTH_PINS, PHONE_INDEX } from '../auth/accounts.js';
import { readPhone } from '../auth/phoneAuth.js';
import { forgetDevices } from '../auth/devices.js';
import { maskPhone, phoneHash } from '../auth/phoneNumber.js';
import { readSmsSettings } from '../sms/smsSettings.js';
import { createNotification } from '../email-core/notifications.js';
import { isBlank } from '../shared/blank.js';
import { arccmsOwnsAuthAccount } from './authOwner.js';
import { APP_MANAGED, isLockedAppAccount } from './lockedAppAccount.js';

export const SHARED_PHONE = "This person's sign-in is shared with another app, so their number is changed there.";
export const NO_SIGN_IN = 'This person has no sign-in account, so a number would not sign them in.';
export const NUMBER_TAKEN = 'This number is already on another account.';

const notFound = (err: unknown) => (err as { code?: string })?.code === 'auth/user-not-found';

export const adminSetPhone = onCall(async (request) => {
    await requireAdmin(request);
    const id = typeof request.data?.id === 'string' ? request.data.id.trim() : '';
    if (!id || id.includes('/')) throw new HttpsError('invalid-argument', 'Which user? The record id is missing.');
    const phone = readPhone(request.data?.phone, await readSmsSettings());
    // readPhone refuses an empty number already; '' must never match the records without one.
    if (isBlank(phone)) throw new HttpsError('invalid-argument', 'A valid phone number is required.');

    const ref = db.collection('users').doc(id);
    const snap = await ref.get();
    const record = snap.data();
    if (!snap.exists || !record) throw new HttpsError('not-found', 'That user no longer exists.');
    if (isLockedAppAccount(record)) throw refuse('permission-denied', 'app-managed', APP_MANAGED);
    if (!arccmsOwnsAuthAccount(record)) throw refuse('failed-precondition', 'shared-account', SHARED_PHONE);
    const uid = typeof record['uid'] === 'string' ? record['uid'] : '';
    if (!uid) throw refuse('failed-precondition', 'no-account', NO_SIGN_IN);

    const account = await owner.getUser(uid).catch((err: unknown) => {
        if (notFound(err)) throw refuse('failed-precondition', 'no-account', NO_SIGN_IN);
        throw err;
    });
    if (record['phone'] === phone) {
        // Already theirs. A sign-in account a failed try left on the old number catches up.
        if (account.phoneNumber && account.phoneNumber !== phone) await owner.updateUser(uid, { phoneNumber: phone });
        return { updated: false, phone };
    }
    // Another sign-in account or another record with this number.
    const holder = await owner.getUserByPhoneNumber(phone).catch((err: unknown) => {
        if (notFound(err)) return null;
        throw err;
    });
    if (holder && holder.uid !== uid) throw refuse('already-exists', 'number-taken', NUMBER_TAKEN);
    const onRecords = await db.collection('users').where('phone', '==', phone).limit(2).get();
    if (onRecords.docs.some((d) => d.id !== id)) throw refuse('already-exists', 'number-taken', NUMBER_TAKEN);

    const now = Timestamp.now();
    const newIndex = db.collection(PHONE_INDEX).doc(phoneHash(phone));
    await db.runTransaction(async (tx) => {
        // The record as it is now: its number may have changed since the checks above.
        const current = await tx.get(ref);
        const data = current.data();
        if (!current.exists || !data) throw new HttpsError('not-found', 'That user no longer exists.');
        if (data['uid'] !== uid) throw new HttpsError('aborted', 'This user changed meanwhile. Please try again.');
        const oldPhone = typeof data['phone'] === 'string' ? data['phone'] : '';
        const oldIndex = isBlank(oldPhone) || oldPhone === phone ? null : db.collection(PHONE_INDEX).doc(phoneHash(oldPhone));
        const index = await tx.get(newIndex);
        const oldIndexSnap = oldIndex ? await tx.get(oldIndex) : null;
        // An index entry is the number's owner only while that record still has the number.
        const indexed = index.data()?.['userDocId'];
        if (indexed && indexed !== id) {
            const other = await tx.get(db.collection('users').doc(String(indexed)));
            if (other.exists && other.data()?.['phone'] === phone) throw refuse('already-exists', 'number-taken', NUMBER_TAKEN);
        }
        tx.set(newIndex, { userDocId: id, uid, createdAt: now });
        if (oldIndex && oldIndexSnap?.data()?.['userDocId'] === id) tx.delete(oldIndex);
        tx.update(ref, { phone, phoneVerified: false, modifiedAt: now, modifiedBy: request.auth!.uid });
    });

    // First what keeps the lost phone out: its sessions, the PIN and the remembered devices.
    // The next phone sign-in then sends a code to the new number and asks for a new PIN (resetPin).
    await Promise.all([
        owner.revokeRefreshTokens(uid),
        db.collection(AUTH_PINS).doc(uid).delete(),
        forgetDevices(uid),
    ]);
    // Then the sign-in account's own number, when it carries one, so no old number stays on it.
    if (account.phoneNumber) {
        await owner.updateUser(uid, { phoneNumber: phone }).catch((err: unknown) => {
            logger.error(`adminSetPhone: users/${id} has the new number, but its sign-in account kept the old one`, err);
            throw new HttpsError('internal', "The number is changed and the old phone is signed out, but the sign-in account kept its old number. Try again.");
        });
    }

    const email = typeof record['email'] === 'string' ? record['email'].trim() : '';
    if (!isBlank(email)) {
        await createNotification({
            userId: uid,
            type: 'account_security',
            title: 'Your phone number was changed',
            body: `An admin changed the phone number on your account to ${maskPhone(phone)}. If you did not ask for this, contact us at once.`,
            createdBy: `admin:${request.auth!.uid}`,
        }).catch((err: unknown) => logger.error('adminSetPhone: could not tell the member', err));
    }
    logger.info(`adminSetPhone: users/${id} now has ${maskPhone(phone)}, set by ${request.auth!.uid}.`);
    return { updated: true, phone };
});
