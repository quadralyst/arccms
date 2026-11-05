/**
 * Payrexx (docs/app/merchant-payments.html#payrexx), on its REST API with plain fetch.
 *
 * Not on the `payrexx` npm package: it is a third party's, last changed in 2022, and brings
 * axios 0.21 and the retired `request`. Three documented calls with a key in a header need
 * neither, and every library here is one more thing that could log a key.
 *
 * The key goes in the X-API-KEY header, never in an address (rule 2). Payrexx signs nothing,
 * as far as its docs say, so an event only ever prompts a read back: this connector has no
 * verifyEvent, and core treats every event from it as saying nothing by itself.
 */
import { createHash } from 'node:crypto';
import type { ConnectorContext, ConnectorError, ConnectorRead, ConnectorStarted, PaymentConnector, ProviderIds } from '../types.js';
import { safeDetail, withTimeout } from './shared.js';

const API = 'https://api.payrexx.com/v1.0';
/** What Payrexx's page opens for when the app does not say. */
const DEFAULT_LIFE = 15;
/** Payrexx sets no limit in its docs. A day is far beyond any buyer at a counter. */
const MAX_LIFE = 24 * 60;
/** A buyer's tries on one page that are read back, the latest. */
const MAX_TRANSACTIONS = 5;

/**
 * What each status is (rule 5). Payrexx says `confirmed` is the event for a successful
 * payment; which status means settled is not stated, so only that one is paid until the proof
 * on a real account says otherwise. Nothing else ever is, and an unknown status stays open.
 */
const STATES: Record<string, ConnectorRead['state']> = {
    waiting: 'open',
    authorized: 'open',
    reserved: 'open',
    uncaptured: 'open',
    confirmed: 'paid',
    cancelled: 'cancelled',
    declined: 'failed',
    error: 'failed',
    expired: 'cancelled',
    // Money moved and came back, or may yet. Only a person can say what that means.
    refunded: 'unclear',
    'partially-refunded': 'unclear',
    refund_pending: 'unclear',
    chargeback: 'unclear',
};

export function payrexxState(status: string | null | undefined): ConnectorRead['state'] {
    return (status && Object.hasOwn(STATES, status) ? STATES[status] : undefined) ?? 'open';
}

type Answer = { status: number; body: Record<string, unknown> | null };

async function send(context: ConnectorContext, method: string, path: string, query: Record<string, string>, body?: Record<string, unknown>): Promise<Answer | ConnectorError> {
    const params = new URLSearchParams({ ...query, instance: context.keys['instance'] });
    return withTimeout(
        async () => {
            const response = await fetch(`${API}${path}?${params.toString()}`, {
                method,
                // A key must never follow a redirect to another host.
                redirect: 'error',
                headers: { 'X-API-KEY': context.keys['apiSecret'], Accept: 'application/json', ...(body ? { 'Content-Type': 'application/json' } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {}),
            });
            let parsed: Record<string, unknown> | null = null;
            try {
                const value: unknown = await response.json();
                parsed = typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
            } catch {
                parsed = null;
            }
            return { status: response.status, body: parsed };
        },
        context.timeoutMs,
        'Payrexx',
    );
}

const isError = (value: Answer | ConnectorError): value is ConnectorError => (value as ConnectorError).ok === false;
const isOk = (answer: Answer) => answer.status >= 200 && answer.status < 300 && answer.body?.['status'] !== 'error';

function failed(answer: Answer): ConnectorError {
    const said = safeDetail(answer.body?.['message']);
    if (answer.status === 401 || answer.status === 403) return { ok: false, failure: 'key-refused', detail: 'Payrexx refused the keys' };
    if (answer.status === 404) return { ok: false, failure: 'not-found', detail: 'Payrexx does not know this payment' };
    // Too many calls: Payrexx answers 405, then 403, from its firewall. A 403 above reads as a refused key until the daily check says otherwise.
    if (answer.status === 405 || answer.status === 429 || answer.status >= 500) return { ok: false, failure: 'unavailable', detail: `Payrexx could not answer (${answer.status})` };
    return { ok: false, failure: 'refused', detail: `Payrexx refused the request (${answer.status})${said ? `: ${said}` : ''}` };
}

function first(answer: Answer): Record<string, unknown> | null {
    const data = answer.body?.['data'];
    const item = Array.isArray(data) ? data[0] : data;
    return typeof item === 'object' && item !== null ? (item as Record<string, unknown>) : null;
}

/** The transaction ids a gateway's answer names, newest last. */
function transactionIds(gateway: Record<string, unknown>): string[] {
    const invoices = Array.isArray(gateway['invoices']) ? (gateway['invoices'] as Array<Record<string, unknown>>) : [];
    return invoices.flatMap((invoice) => (Array.isArray(invoice?.['transactions']) ? (invoice['transactions'] as Array<Record<string, unknown>>) : []).map((t) => String(t?.['id'] ?? '')).filter(Boolean));
}

/** The transaction is this gateway's, by the gateway's id and the app's reference. */
function belongsTo(transaction: Record<string, unknown>, ids: ProviderIds): boolean {
    const invoice = (transaction['invoice'] ?? {}) as Record<string, unknown>;
    return transaction['referenceId'] === ids.reference && String(invoice['paymentRequestId'] ?? '') === ids.providerId;
}

function transactionRead(transaction: Record<string, unknown>): ConnectorRead {
    const status = typeof transaction['status'] === 'string' ? transaction['status'] : '';
    const invoice = (transaction['invoice'] ?? {}) as Record<string, unknown>;
    const mode = transaction['mode'];
    const payment = (transaction['payment'] ?? {}) as Record<string, unknown>;
    return {
        ok: true,
        state: payrexxState(status),
        providerStatus: status || 'no status',
        amountMinor: typeof invoice['totalAmount'] === 'number' ? invoice['totalAmount'] : undefined,
        currency: typeof invoice['currencyAlpha3'] === 'string' ? invoice['currencyAlpha3'] : undefined,
        reference: typeof transaction['referenceId'] === 'string' ? transaction['referenceId'] : undefined,
        providerPaymentId: String(transaction['id'] ?? ''),
        // Payrexx says which system a transaction was on. Anything not plainly LIVE is not money.
        mode: mode === 'LIVE' ? 'live' : 'test',
        method: typeof payment['brand'] === 'string' ? payment['brand'] : undefined,
        paymentExists: true,
    };
}

export const payrexx: PaymentConnector = {
    info: {
        id: 'payrexx',
        name: 'Payrexx',
        fields: [
            { id: 'instance', label: 'Instance name', secret: false, publicName: true, required: true, pattern: /^[a-z0-9][a-z0-9-]{0,62}$/i, help: 'The first part of your payrexx.com address.' },
            { id: 'apiSecret', label: 'API secret', secret: true, preview: true, required: true, pattern: /^\S{8,400}$/, help: 'Payrexx admin, Settings, API.' },
        ],
        // Its docs show no test system; the proof on a real account may change this.
        modes: ['live'],
        separateKeys: false,
        webhookByHand: true,
        signsEvents: false,
        canEndPage: true,
        pageLife: { settable: true, maxMinutes: MAX_LIFE, defaultMinutes: DEFAULT_LIFE },
        canRefund: true,
        canRefundPart: true,
        proven: false,
        maxReferenceLength: 200,
    },

    pageHost: ({ keys }) => `${keys['instance'].toLowerCase()}.payrexx.com`,

    async testKeys(context) {
        // Payrexx's docs no longer show a signature check. Listing one transaction proves the same: this key, this instance.
        const answer = await send(context, 'GET', '/Transaction/', { limit: '1' });
        if (isError(answer)) return answer;
        return isOk(answer) ? { ok: true } : failed(answer);
    },

    async start(context, input) {
        const lifeMinutes = input.lifeMinutes ?? DEFAULT_LIFE;
        const answer = await send(context, 'POST', '/Gateway/', {}, {
            amount: input.amountMinor,
            currency: input.currency,
            referenceId: input.reference,
            validity: lifeMinutes,
            successRedirectUrl: input.returnUrl,
            failedRedirectUrl: input.returnUrl,
            cancelRedirectUrl: input.returnUrl,
            skipResultPage: true,
            ...(input.language ? { language: input.language } : {}),
        });
        if (isError(answer)) return answer;
        if (!isOk(answer)) return failed(answer);
        const gateway = first(answer);
        const id = gateway?.['id'];
        const link = gateway?.['link'];
        if ((typeof id !== 'number' && typeof id !== 'string') || typeof link !== 'string') return { ok: false, failure: 'unreadable', detail: 'Payrexx gave no page for this payment' };
        return { ok: true, providerId: String(id), pageUrl: link, lifeMinutes } satisfies ConnectorStarted;
    },

    async read(context, ids: ProviderIds) {
        const gatewayAnswer = await send(context, 'GET', `/Gateway/${encodeURIComponent(ids.providerId)}/`, {});
        if (isError(gatewayAnswer)) return gatewayAnswer;
        // An ended page's gateway is gone, but a transaction already known can still be read.
        if (!isOk(gatewayAnswer) && (gatewayAnswer.status !== 404 || !ids.providerPaymentId)) return failed(gatewayAnswer);
        const gateway = isOk(gatewayAnswer) ? first(gatewayAnswer) : null;
        if (isOk(gatewayAnswer) && !gateway) return { ok: false, failure: 'unreadable', detail: 'Payrexx gave no gateway for this payment' };

        // The transaction says what was really paid. A gateway only repeats what was asked. A confirmed one wins, in any order.
        const named = gateway ? transactionIds(gateway).slice(-MAX_TRANSACTIONS) : [];
        const reads: ConnectorRead[] = [];
        for (const id of named) {
            const answer = await send(context, 'GET', `/Transaction/${encodeURIComponent(id)}/`, {});
            if (isError(answer)) return answer;
            if (!isOk(answer)) return failed(answer);
            const transaction = first(answer);
            if (transaction) reads.push(transactionRead(transaction));
        }
        if (!named.length && ids.providerPaymentId) {
            const answer = await send(context, 'GET', `/Transaction/${encodeURIComponent(ids.providerPaymentId)}/`, {});
            if (isError(answer)) return answer;
            if (!isOk(answer) && answer.status !== 404) return failed(answer);
            const transaction = isOk(answer) ? first(answer) : null;
            // An id the gateway did not name may have come from an unsigned event: it counts only if that transaction is this gateway's.
            if (transaction && belongsTo(transaction, ids)) reads.push(transactionRead(transaction));
        }
        const best = reads.find((read) => read.state === 'paid') ?? reads[reads.length - 1];
        if (best) return best;
        if (!gateway) return { ok: false, failure: 'not-found', detail: 'Payrexx does not know this payment' };
        const gatewayStatus = typeof gateway['status'] === 'string' ? gateway['status'] : '';
        // Confirmed, with no transaction to prove it: not paid, and not closed as unpaid either.
        return {
            ok: true,
            state: gatewayStatus === 'confirmed' ? 'open' : payrexxState(gatewayStatus),
            providerStatus: gatewayStatus ? `gateway ${gatewayStatus}` : 'no status',
            paymentExists: !['', 'waiting', 'cancelled', 'declined', 'expired', 'error'].includes(gatewayStatus),
        };
    },

    async end(context, ids) {
        const answer = await send(context, 'DELETE', `/Gateway/${encodeURIComponent(ids.providerId)}/`, {});
        if (isError(answer)) return answer;
        return isOk(answer) || answer.status === 404 ? { ok: true } : failed(answer);
    },

    async refund(context, ids, input) {
        if (!ids.providerPaymentId) return { ok: false, failure: 'not-found', detail: 'Payrexx has no transaction to refund for this payment' };
        const answer = await send(context, 'POST', `/Transaction/${encodeURIComponent(ids.providerPaymentId)}/refund/`, {}, input.amountMinor !== undefined ? { amount: input.amountMinor } : {});
        if (isError(answer)) return answer;
        if (!isOk(answer)) return failed(answer);
        const item = first(answer);
        return { ok: true, refundId: String(item?.['id'] ?? ''), providerStatus: typeof item?.['status'] === 'string' ? item['status'] : '' };
    },

    parseEvent(rawBody, headers) {
        const contentType = String(headers['content-type'] ?? '');
        const transaction = /json/i.test(contentType) || rawBody[0] === 0x7b ? jsonTransaction(rawBody) : formTransaction(rawBody);
        const reference = transaction?.referenceId;
        if (!transaction || !reference) return null;
        return {
            // Payrexx names no event id, so identical bytes are the same event.
            eventId: createHash('sha256').update(rawBody).digest('hex'),
            type: transaction.status ? transaction.status.slice(0, 40) : 'unknown',
            reference,
            ...(transaction.id ? { providerPaymentId: transaction.id } : {}),
        };
    },
};

interface EventFields {
    id: string;
    status: string;
    referenceId: string;
}

function jsonTransaction(raw: Buffer): EventFields | null {
    try {
        const value = JSON.parse(raw.toString('utf8')) as { transaction?: Record<string, unknown> };
        const t = value?.transaction;
        if (!t || typeof t !== 'object') return null;
        return { id: /^\d+$/.test(String(t['id'] ?? '')) ? String(t['id']) : '', status: typeof t['status'] === 'string' ? t['status'] : '', referenceId: typeof t['referenceId'] === 'string' ? t['referenceId'] : '' };
    } catch {
        return null;
    }
}

function formTransaction(raw: Buffer): EventFields | null {
    const params = new URLSearchParams(raw.toString('utf8'));
    const referenceId = params.get('transaction[referenceId]') ?? '';
    if (!referenceId) return null;
    const id = params.get('transaction[id]') ?? '';
    return { id: /^\d+$/.test(id) ? id : '', status: params.get('transaction[status]') ?? '', referenceId };
}
