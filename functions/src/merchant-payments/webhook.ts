/**
 * Every provider's events come here, at /<webhookId>. An address is public and proves nothing
 * (rule 2): it only says which account's keys to check with. The steps, in this order:
 *
 *   1. Where the provider signs: the signature over the exact bytes received, with a key the
 *      server holds, before the body is read at all (rules 2, 3).
 *   2. Which payment it names. An event for no payment of ours is answered and dropped, so
 *      forged events write nothing; one already final writes no event either.
 *   3. Its id written once, with no raw event (rules 7, 9). A duplicate stops here.
 *   4. Answer. All the work happens in onMerchantPaymentEvent, which reads the payment back.
 *
 * So this file stays small: no provider's SDK and none of the app's code load here, and a
 * test holds it to that, as the shortest limit read is 10 seconds with a cold start in it
 * (rule 8). A slow database gets a 503 before then, and the provider sends it again.
 */
import { logger } from 'firebase-functions/v2';
import { onRequest } from 'firebase-functions/v2/https';
import { db } from '../init.js';
import { noteEventArrived } from './alerts.js';
import { connectorFor } from './connectors/index.js';
import { headerValue } from './connectors/shared.js';
import { eventKeyFor, EVENTS, PAYMENTS, paymentIdFor, readAccountKeys, WEBHOOKS, type PaymentRecord } from './store.js';
import type { Headers } from './types.js';

/** The answer must leave well before the 10 seconds, with the cold start already spent. */
export const ANSWER_WITHIN_MS = 6_000;
const WEBHOOK_ID = /^[a-f0-9]{16,64}$/;

export interface WebhookRequest {
    method: string;
    path: string;
    headers: Headers;
    rawBody?: Buffer;
}

export interface WebhookAnswer {
    status: number;
    body: string;
}

async function route(webhookId: string): Promise<{ accountId: string; provider: string } | null> {
    if (!WEBHOOK_ID.test(webhookId)) return null;
    const snap = await db.collection(WEBHOOKS).doc(webhookId).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    return { accountId: String(data['accountId'] ?? ''), provider: String(data['provider'] ?? '') };
}

function isAlreadyExists(error: unknown): boolean {
    const code = (error as { code?: unknown })?.code;
    return code === 6 || code === 'already-exists';
}

/** One delivery, from the request's exact bytes to the answer. */
export async function receivePaymentEvent(request: WebhookRequest): Promise<WebhookAnswer> {
    const webhookId = request.path.split('/').filter(Boolean).pop() ?? '';
    const target = await route(webhookId);
    const connector = target ? connectorFor(target.provider) : null;
    if (!target || !connector) return { status: 404, body: 'Unknown address' };

    if (request.method === 'GET' && connector.verificationHeader) {
        // The provider's own check of a new address: its value back, as plain text.
        const value = headerValue(request.headers, connector.verificationHeader);
        return value && value.length <= 1024 ? { status: 200, body: value } : { status: 400, body: 'Nothing to verify' };
    }
    if (request.method !== 'POST') return { status: 405, body: 'POST only' };
    // Never a body put back together by a parser: its bytes would not be what was signed.
    if (!request.rawBody?.length) return { status: 400, body: 'No body' };

    if (connector.info.signsEvents) {
        const keys = await readAccountKeys(target.accountId);
        const held = keys?.provider === target.provider ? keys.modes : {};
        if (!connector.verifyEvent?.(request.rawBody, request.headers, held)) {
            logger.warn('merchant-payments: an event was refused', { provider: target.provider, why: 'signature' });
            return { status: 401, body: 'Refused' };
        }
    }

    const event = connector.parseEvent(request.rawBody, request.headers);
    if (!event) return { status: 200, body: 'Nothing to do' };
    const paymentId = paymentIdFor(target.accountId, event.reference);
    const snap = await db.collection(PAYMENTS).doc(paymentId).get();
    const record = snap.exists ? (snap.data() as PaymentRecord) : null;
    if (!record || record.provider !== target.provider) return { status: 200, body: 'Nothing to do' };
    if (record.status === 'paid' || record.status === 'held') {
        // Nothing more for this payment, but the webhook is plainly on: the app may have read it paid first.
        await noteEventArrived(target.accountId).catch(() => undefined);
        return { status: 200, body: 'Nothing to do' };
    }

    const nowMs = Date.now();
    try {
        await db.collection(EVENTS).doc(eventKeyFor(target.provider, webhookId, event.eventId)).create({
            provider: target.provider,
            accountId: target.accountId,
            paymentId,
            type: event.type,
            ...(event.providerPaymentId ? { hint: event.providerPaymentId } : {}),
            receivedAtMs: nowMs,
        });
    } catch (error) {
        if (isAlreadyExists(error)) return { status: 200, body: 'Already received' };
        throw error;
    }
    return { status: 200, body: 'Received' };
}

/** Answers within the limit whatever the database is doing: a 503, and the provider sends the event again. */
export async function answerInTime(request: WebhookRequest, withinMs = ANSWER_WITHIN_MS): Promise<WebhookAnswer> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const late = new Promise<WebhookAnswer>((resolve) => {
        timer = setTimeout(() => resolve({ status: 503, body: 'Try again' }), withinMs);
    });
    try {
        return await Promise.race([receivePaymentEvent(request), late]);
    } catch {
        logger.error('merchant-payments: an event could not be recorded');
        return { status: 503, body: 'Try again' };
    } finally {
        if (timer) clearTimeout(timer);
    }
}

export const merchantPaymentWebhook = onRequest({ timeoutSeconds: 10, memory: '256MiB' }, async (request, response) => {
    const answer = await answerInTime({ method: request.method, path: request.path, headers: request.headers, rawBody: request.rawBody });
    response.status(answer.status).set('Content-Type', 'text/plain; charset=utf-8').set('X-Content-Type-Options', 'nosniff').send(answer.body);
});
