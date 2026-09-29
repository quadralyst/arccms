import { randomBytes } from 'node:crypto';
import { FieldValue } from 'firebase-admin/firestore';
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';

/**
 * Where the site's unsubscribe secret lives: `_system`, which the rules close to
 * every client. Not `Settings/email`, where it used to be expected: the admin UI
 * and the onboarding wizard both save that document whole, so a secret kept
 * there is wiped on the next save, and every unsubscribe link already sent stops
 * verifying.
 */
export const UNSUBSCRIBE_SECRET_DOC = { collection: '_system', doc: 'unsubscribe_secret' } as const;

let cached: string | null = null;

/**
 * The HMAC secret behind unsubscribe and preference links.
 *
 * Nothing ever generated one, so on every new install those links came out
 * empty (found testing a fresh install, 2026-09-23). It is now created on first
 * use, once, inside a transaction so two cold instances cannot mint two.
 *
 * An install that set `Settings/email.unsubscribeSecret` by hand keeps using it
 * (pass it as `configured`), so the links it has already sent keep working.
 *
 * Returns '' if the secret cannot be read or written; callers then omit the
 * links, which is what they did before.
 */
export async function getUnsubscribeSecret(configured?: string): Promise<string> {
    if (configured) return configured;
    if (cached) return cached;
    try {
        const ref = db.collection(UNSUBSCRIBE_SECRET_DOC.collection).doc(UNSUBSCRIBE_SECRET_DOC.doc);
        const secret = await db.runTransaction(async (tx) => {
            const existing = (await tx.get(ref)).data()?.['secret'];
            if (typeof existing === 'string' && existing) return existing;
            const fresh = randomBytes(32).toString('hex');
            tx.set(ref, { secret: fresh, createdAt: FieldValue.serverTimestamp() });
            return fresh;
        });
        cached = secret;
        return secret;
    } catch (err) {
        logger.error('getUnsubscribeSecret: could not read or create the secret', err);
        return '';
    }
}

/** Test hook: forget the cached secret. */
export function resetUnsubscribeSecretCache(): void {
    cached = null;
}
