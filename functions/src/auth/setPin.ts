/**
 * Signed in: choose or change the sign-in PIN (specs/sign-in-pin-spec.md). Phone
 * accounts, and email accounts, whose password is then taken off when the site signs
 * email accounts in with a PIN (dropPasswordForPin). This device is remembered.
 *
 * Deployed whatever the app's features: an email account has a PIN without the `sms`
 * feature, which only phone sign-in needs.
 */
import { onCall } from 'firebase-functions/v2/https';
import { requireOwnRecord, setPin as storePin } from './accounts.js';
import { readNewPin } from './phoneAuth.js';
import { readDeviceKey, rememberDevice } from './devices.js';
import { dropPasswordForPin } from './emailPinRules.js';
import { refuse } from './refusal.js';
import { isWarmUp, WARM } from './warmUp.js';

export const setPin = onCall(async (request) => {
    if (isWarmUp(request)) return WARM;
    const record = await requireOwnRecord(request);
    if (!record.data['phone'] && !record.data['email']) throw refuse('failed-precondition', 'add-phone-first', 'Add a phone number or an email first.');
    const uid = String(record.data['uid']);
    const pin = readNewPin(request.data?.pin);
    await storePin(uid, pin);
    const [dropped] = await Promise.all([dropPasswordForPin(record), rememberDevice(uid, readDeviceKey(request.data?.deviceKey))]);
    return { saved: true, ...(dropped ? { passwordRemoved: true } : {}) };
});
