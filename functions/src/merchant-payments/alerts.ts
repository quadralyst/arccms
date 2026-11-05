/**
 * Reaching the app: its hooks in functions/src/custom/payments.ts, loaded only by what
 * delivers something, never by the webhook (rule 8), and each alert said once until it
 * changes (rule 10). Nothing is logged but the type and the account's provider (rule 9).
 */
import { logger } from 'firebase-functions/v2';
import { db } from '../init.js';
import { ACCOUNTS, readAccount, type AccountDoc } from './store.js';
import type { PaymentAlert, PaymentAlertType, PaymentHooks } from './types.js';

let replaced: PaymentHooks | null = null;

/** For an app's unit tests: use these hooks, until `stop()`. */
export function capturePaymentHooks(hooks: PaymentHooks): { stop(): void } {
    replaced = hooks;
    return { stop: () => void (replaced = null) };
}

export async function paymentHooks(): Promise<PaymentHooks> {
    if (replaced) return replaced;
    const custom = await import('../custom/payments.js');
    return custom.PAYMENT_HOOKS ?? {};
}

/**
 * Tell the app, once for this `word`: a key's alert says the same word until something
 * changes. Marked said only after the app took it, so a failed call is said again next time.
 */
export async function raiseAccountAlert(account: AccountDoc, alert: Omit<PaymentAlert, 'accountId' | 'provider' | 'mode'>, word: string): Promise<void> {
    if (account.alertsSaid?.[alert.type] === word) return;
    try {
        const hooks = await paymentHooks();
        await hooks.onAlert?.({ ...alert, accountId: account.accountId, provider: account.provider, mode: account.mode });
        await changeMaps(account.accountId, (problems, said) => {
            problems[alert.type] = alert.detail;
            said[alert.type] = word;
        });
    } catch {
        logger.warn('merchant-payments: an alert did not reach the app', { type: alert.type, provider: account.provider });
    }
}

/** Changes an account's two maps together, against what they hold now. */
async function changeMaps(accountId: string, change: (problems: Record<string, string>, said: Record<string, string>) => void): Promise<void> {
    const ref = db.collection(ACCOUNTS).doc(accountId);
    await db.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const account = snap.data() as AccountDoc;
        const problems = { ...(account.problems ?? {}) } as Record<string, string>;
        const said = { ...(account.alertsSaid ?? {}) };
        change(problems, said);
        tx.update(ref, { problems, alertsSaid: said });
    });
}

/** The problem has gone; the same alert may be said again if it comes back. */
export async function clearAccountProblem(accountId: string, type: PaymentAlertType): Promise<void> {
    const account = await readAccount(accountId);
    if (!account?.problems?.[type] && !account?.alertsSaid?.[type]) return;
    await changeMaps(accountId, (problems, said) => {
        delete problems[type];
        delete said[type];
    });
}

/**
 * An event came for this account, so its webhook is on. For a provider that signs nothing this
 * proves little, and all a forger gains is an alert not said.
 */
export async function noteEventArrived(accountId: string): Promise<void> {
    const account = await readAccount(accountId);
    if (!account || (!account.silentFinishes && !account.problems?.['webhook-silent'])) return;
    await db.collection(ACCOUNTS).doc(accountId).update({ silentFinishes: 0 });
    await clearAccountProblem(accountId, 'webhook-silent');
}
