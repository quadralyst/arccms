/**
 * Once a day: is every account still able to take money? A key's end date coming up, a key the
 * provider now refuses, and old event records cleared away (rules 9, 10). Which keys end when is
 * the merchant's to type in where the provider has no call for it, as Worldline does not.
 */
import { logger } from 'firebase-functions/v2';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { db } from '../init.js';
import { clearAccountProblem, raiseAccountAlert } from './alerts.js';
import { connectorFor } from './connectors/index.js';
import { CALL_TIMEOUT_MS } from './settle.js';
import { ACCOUNTS, EVENTS, readAccountKeys, type AccountDoc } from './store.js';

/** Told at each of these many days before the end, and again when it has come. */
export const EXPIRY_DAYS = [30, 7, 1] as const;
/** Long enough to drop any duplicate: Worldline retries for 48 hours. */
export const EVENT_DAYS = 7;
const DAY_MS = 86_400_000;
const PAGE = 200;
const AT_ONCE = 8;
const CLEAR_BATCH = 450;
const MAX_CLEAR_RUNS = 40;

/** Which warning a key's end date calls for, if any: the first threshold reached, or ended. */
export function expiryWord(expiresOn: string, nowMs: number): { word: string; daysLeft: number } | null {
    const endMs = Date.parse(`${expiresOn}T23:59:59Z`);
    if (!Number.isFinite(endMs)) return null;
    const daysLeft = Math.ceil((endMs - nowMs) / DAY_MS);
    if (daysLeft <= 0) return { word: 'ended', daysLeft: 0 };
    const reached = [...EXPIRY_DAYS].sort((a, b) => a - b).find((days) => daysLeft <= days);
    return reached === undefined ? null : { word: `within-${reached}`, daysLeft };
}

async function checkAccount(account: AccountDoc, nowMs: number): Promise<void> {
    if (account.keyExpiresOn) {
        const expiry = expiryWord(account.keyExpiresOn, nowMs);
        if (expiry) {
            await raiseAccountAlert(
                account,
                {
                    type: 'key-expiring',
                    expiresOn: account.keyExpiresOn,
                    daysLeft: expiry.daysLeft,
                    detail: expiry.daysLeft > 0 ? `The provider's key ends in ${expiry.daysLeft} days. Replace it before then, or payments will fail.` : 'The provider\'s key has ended. Payments will fail until it is replaced.',
                },
                expiry.word,
            );
        }
    }
    const connector = connectorFor(account.provider);
    const keys = (await readAccountKeys(account.accountId))?.modes[account.mode];
    if (!connector || !keys) return;
    const test = await connector.testKeys({ mode: account.mode, keys, timeoutMs: CALL_TIMEOUT_MS });
    if (test.ok) await clearAccountProblem(account.accountId, 'key-refused');
    else if (test.failure === 'key-refused') await raiseAccountAlert(account, { type: 'key-refused', detail: test.detail }, 'refused');
}

/** Old event records go first, and all of them, whatever happens to the accounts' checks. */
async function clearOldEvents(nowMs: number): Promise<number> {
    let cleared = 0;
    for (let run = 0; run < MAX_CLEAR_RUNS; run++) {
        const old = await db.collection(EVENTS).where('receivedAtMs', '<', nowMs - EVENT_DAYS * DAY_MS).limit(CLEAR_BATCH).get();
        if (old.empty) break;
        const batch = db.batch();
        for (const doc of old.docs) batch.delete(doc.ref);
        await batch.commit();
        cleared += old.size;
        if (old.size < CLEAR_BATCH) break;
    }
    return cleared;
}

export async function runAccountCheck(nowMs = Date.now()): Promise<{ accounts: number; eventsCleared: number }> {
    const eventsCleared = await clearOldEvents(nowMs);
    let accounts = 0;
    let after: string | undefined;
    for (;;) {
        let query = db.collection(ACCOUNTS).orderBy('accountId').limit(PAGE);
        if (after) query = query.startAfter(after);
        const page = await query.get();
        // Several at once, so a slow provider cannot keep the last accounts unchecked for ever.
        let next = 0;
        await Promise.all(Array.from({ length: Math.min(AT_ONCE, page.size) }, async () => {
            while (next < page.size) {
                const doc = page.docs[next++];
                try {
                    await checkAccount(doc.data() as AccountDoc, nowMs);
                } catch {
                    logger.error('merchant-payments: an account could not be checked');
                }
            }
        }));
        accounts += page.size;
        if (page.size < PAGE) break;
        after = page.docs[page.size - 1].id;
    }
    return { accounts, eventsCleared };
}

export const checkMerchantAccounts = onSchedule({ schedule: 'every day 06:00', timeZone: 'UTC', timeoutSeconds: 540 }, async () => {
    await runAccountCheck();
});
