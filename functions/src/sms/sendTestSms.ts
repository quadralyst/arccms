/**
 * Admin: send a test SMS with the current settings (Settings, SMS).
 *
 * MSG91 sends only registered templates, so the test is the OTP template with
 * a made-up code. The result is also in SMS logs.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { randomInt } from 'node:crypto';
import { requireAdmin } from '../search/auth.js';
import { normalizePhone } from '../auth/phoneNumber.js';
import { readSmsSettings } from './smsSettings.js';
import { sendSms } from './sendSms.js';

export const sendTestSms = onCall(async (request) => {
    await requireAdmin(request);
    const settings = await readSmsSettings();
    const to = normalizePhone(request.data?.phone, settings.defaultCountryCode);
    if (!to) throw new HttpsError('invalid-argument', 'Enter a valid phone number.');

    const code = String(randomInt(100000, 1000000));
    const result = await sendSms({ to, purpose: 'test', code, text: `${code} is your test code. This is a test message.` }, settings);
    return { ...result, provider: settings.provider };
});
