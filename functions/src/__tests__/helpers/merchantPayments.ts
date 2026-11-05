/** Shared by the merchant payments specs: a pretend account, and everything stored, for looking through. */
import { connectPaymentAccount } from '../../merchant-payments/accounts.js';
import { startPayment } from '../../merchant-payments/payments.js';
import type { MemoryFirestore } from './memoryFirestore.js';

export const SECRET = 'SECRETKEY-CANARY-1234';
export const WEBHOOK_SECRET = 'WEBHOOK-CANARY-5678';
export const WEBHOOK_KEY_ID = 'KEYID-CANARY-90';
export const ACCOUNT = 'business-1';

export const pretendFields = (over: Record<string, string> = {}) => ({ accountName: 'My shop', secretKey: SECRET, webhookKeyId: WEBHOOK_KEY_ID, webhookSecret: WEBHOOK_SECRET, ...over });

export async function connectPretend(accountId = ACCOUNT, over: Record<string, string> = {}) {
    const answer = await connectPaymentAccount({ accountId, provider: 'pretend', mode: 'test', fields: pretendFields(over), by: 'owner-1' });
    if (!answer.ok) throw new Error(answer.detail);
    return answer.account;
}

export async function startPretend(reference = 'order-1', amountMinor = 1250, accountId = ACCOUNT) {
    const answer = await startPayment({ accountId, amountMinor, currency: 'CHF', reference, returnUrl: 'https://app.example.com/done' });
    if (!answer.ok) throw new Error(answer.detail);
    return answer;
}

/** Every stored document outside the keys' own collection, as text. */
export function everythingButKeys(db: MemoryFirestore): string {
    return JSON.stringify([...db.store.entries()].filter(([name]) => name !== 'MerchantAccountKeys').map(([name, docs]) => [name, [...docs.entries()]]));
}
