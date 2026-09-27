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
import { onCall } from 'firebase-functions/v2/https';
import { db, owner } from '../init.js';
import { computeEmailHash } from '../email-core/unsubscribeToken.js';
import { callerKey, consumeRateLimit, findUserByEmail, readSignInSettings } from './accounts.js';
import { normalizeEmailAddress } from './linkIdentifiers.js';

const HOUR = 60 * 60 * 1000;

export type EmailAccountStatus = 'registered' | 'new' | 'no-access';

export const checkEmailAccount = onCall(async (request) => {
    await consumeRateLimit(`check-ip-${callerKey(request)}`, 100, HOUR, 'Too many attempts. Please try again later.');
    const email = normalizeEmailAddress(request.data?.email);
    const { signupOpen } = await readSignInSettings();

    let status: EmailAccountStatus = 'new';
    if (await findUserByEmail(email)) {
        status = 'registered';
        await db.collection('email_lookup').doc(computeEmailHash(email)).set({ exists: true });
    } else if (await owner.getUserByEmail(email).catch(() => null)) {
        status = 'no-access';
    }
    return { status, signupOpen };
});
