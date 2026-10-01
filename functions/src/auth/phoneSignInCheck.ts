/**
 * Admin: can phone sign-in sign people in on this project? (Settings, User Settings.)
 *
 * The page calls this before it turns phone sign-in on, and whenever it shows phone
 * sign-in as on. It signs a throwaway sign-in token, the same call the last step of every
 * phone sign-in makes: that creates no account and changes nothing. When signing fails
 * for a setup reason the reply carries the fix for this project (signInSetup.ts).
 *
 * It also returns the SMS provider, so the page can warn that codes are only logged.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { owner } from '../init.js';
import { requireAdmin } from '../search/auth.js';
import { readSmsSettings } from '../sms/smsSettings.js';
import { signingFix, signingProblem } from './signInSetup.js';

/** The uid in the throwaway token. No account has it, and the token is never used. */
export const CHECK_UID = 'arccms-phone-sign-in-check';

export const checkPhoneSignIn = onCall(async (request) => {
    await requireAdmin(request);
    const { provider: smsProvider } = await readSmsSettings();
    try {
        await owner.createCustomToken(CHECK_UID);
        return { ready: true, smsProvider };
    } catch (error) {
        const problem = signingProblem(error);
        if (!problem) {
            logger.error('checkPhoneSignIn: signing a test token failed:', error);
            throw new HttpsError('internal', 'Could not check phone sign-in. The function logs have the error.');
        }
        return { ready: false, smsProvider, ...(await signingFix(problem)) };
    }
});
