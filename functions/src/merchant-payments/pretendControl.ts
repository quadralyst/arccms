/**
 * Driving the pretend provider from a test or a dev screen: decide what the buyer did, and let
 * its event arrive through the real webhook code, signed, from its exact bytes.
 */
import { randomBytes } from 'node:crypto';
import { db } from '../init.js';
import { featureOff } from './accounts.js';
import { pretendAllowed, PRETEND_COLLECTION, PRETEND_ID, PRETEND_KEY_ID_HEADER, PRETEND_SIGNATURE_HEADER, pretendSignature } from './connectors/pretend.js';
import { EVENTS, eventKeyFor, paymentIdFor, PAYMENTS, readAccount, readAccountKeys, type PaymentRecord } from './store.js';
import type { PaymentFailure } from './types.js';
import type { WebhookAnswer } from './webhook.js';

export type PretendOutcome = 'paid' | 'failed' | 'cancelled' | 'waiting' | 'waiting-approval' | 'authorized' | 'charged-back' | 'wrong-amount' | 'wrong-currency' | 'wrong-reference';

export interface PretendInput {
    accountId: string;
    reference: string;
    outcome: PretendOutcome;
    /** `now`: one event. `twice`: the same event twice. `none`: no event, for the sweep to find (a lost webhook). */
    deliver?: 'now' | 'twice' | 'none';
    /**
     * Do the work here, as the trigger would. For tests and a project with no trigger running.
     * The real trigger doing it as well changes nothing.
     */
    processNow?: boolean;
}

/** What the pretend provider says now, after a buyer's `outcome`. */
function statusFields(outcome: PretendOutcome, record: PaymentRecord): Record<string, unknown> {
    switch (outcome) {
        case 'wrong-amount':
            return { providerStatus: 'paid', amountMinor: record.amountMinor + 1 };
        case 'wrong-currency':
            return { providerStatus: 'paid', currency: record.currency === 'EUR' ? 'CHF' : 'EUR' };
        case 'wrong-reference':
            return { providerStatus: 'paid', reference: `${record.reference}-other` };
        default:
            return { providerStatus: outcome };
    }
}

export async function pretendPayment(input: PretendInput): Promise<{ ok: true; answers: WebhookAnswer[] } | PaymentFailure> {
    const off = featureOff();
    if (off) return off;
    if (!pretendAllowed()) return { ok: false, reason: 'not-offered', detail: 'The pretend provider is not allowed on this project.' };
    const account = await readAccount(input.accountId);
    const keys = await readAccountKeys(input.accountId);
    if (!account || account.provider !== PRETEND_ID || !keys?.modes.test) return { ok: false, reason: 'no-account', detail: 'This account is not on the pretend provider.' };
    const paymentId = paymentIdFor(input.accountId, input.reference);
    const snap = await db.collection(PAYMENTS).doc(paymentId).get();
    if (!snap.exists) return { ok: false, reason: 'not-found', detail: 'There is no such payment.' };
    const record = snap.data() as PaymentRecord;
    await db.collection(PRETEND_COLLECTION).doc(record.providerId).set(statusFields(input.outcome, record), { merge: true });

    const deliver = input.deliver ?? 'now';
    if (deliver === 'none') return { ok: true, answers: [] };
    // Only here: these define functions, which the app kit, and so every app function, should not load.
    const [{ receivePaymentEvent }, { processPaymentEvent }] = await Promise.all([import('./webhook.js'), import('./onEvent.js')]);
    const eventId = `evt_${randomBytes(8).toString('hex')}`;
    const rawBody = Buffer.from(JSON.stringify({ id: eventId, type: `payment.${input.outcome}`, reference: input.reference }));
    const headers = {
        [PRETEND_SIGNATURE_HEADER]: pretendSignature(rawBody, keys.modes.test['webhookSecret']),
        [PRETEND_KEY_ID_HEADER]: keys.modes.test['webhookKeyId'],
    };
    const request = { method: 'POST', path: `/${account.webhookId}`, headers, rawBody };
    const answers = [await receivePaymentEvent(request)];
    if (deliver === 'twice') answers.push(await receivePaymentEvent(request));
    if (input.processNow) {
        const event = await db.collection(EVENTS).doc(eventKeyFor(PRETEND_ID, account.webhookId, eventId)).get();
        if (event.exists) await processPaymentEvent(event.data() ?? {});
    }
    return { ok: true, answers };
}

