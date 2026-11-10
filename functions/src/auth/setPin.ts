/**
 * Signed in: choose or change the sign-in PIN (specs/sign-in-pin-spec.md). Phone
 * accounts, and email accounts, whose password is then taken off when the site signs
 * email accounts in with a PIN (dropPasswordForPin). This device is remembered.
 *
 * Changing a PIN the account already has needs that PIN (`currentPin`), checked like a
 * sign-in: a wrong one counts towards the same lock, so a session left open on someone
 * else's device cannot quietly take over the PIN. A first PIN needs none, and Forgot
 * PIN is resetPin / resetEmailPin, with a code. `{ status: true }` only answers whether
 * the account has a PIN (`hasPin`), so the profile knows to ask for it.
 *
 * Deployed whatever the app's features: an email account has a PIN without the `sms`
 * feature, which only phone sign-in needs.
 */
import { onCall } from 'firebase-functions/v2/https';
import { checkPin, hasPin, isValidPin, pinRefusal, requireOwnRecord, setPin as storePin } from './accounts.js';
import { readNewPin } from './phoneAuth.js';
import { readDeviceKey, rememberDevice } from './devices.js';
import { dropPasswordForPin } from './emailPinRules.js';
import { refuse } from './refusal.js';
import { isWarmUp, WARM } from './warmUp.js';

export const setPin = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const record = await requireOwnRecord(request);
    const uid = String(record.data['uid']);
    if (request.data?.status === true) return { hasPin: await hasPin(uid) };
    if (!record.data['phone'] && !record.data['email']) throw refuse('failed-precondition', 'add-phone-first', 'Add a phone number or an email first.');
    const pin = readNewPin(request.data?.pin);
    if (await hasPin(uid)) {
        const current = request.data?.currentPin;
        if (!isValidPin(current)) throw refuse('failed-precondition', 'current-pin-required', 'Enter your current PIN.');
        const result = await checkPin(uid, current);
        if (!result.ok) throw pinRefusal(result);
    }
    await storePin(uid, pin);
    const [dropped] = await Promise.all([dropPasswordForPin(record), rememberDevice(uid, readDeviceKey(request.data?.deviceKey))]);
    return { saved: true, ...(dropped ? { passwordRemoved: true } : {}) };
});
