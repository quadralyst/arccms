/**
 * Worldline Connect (docs/app/merchant-payments.html#worldline-connect), on Worldline's own
 * SDK, loaded only when a call needs it: the webhook checks a signature with node:crypto
 * alone, so its cold start never pays for the SDK (rule 8). One client per set of keys, as
 * init() gives; nothing is shared between merchants.
 *
 * The address follows the mode and nothing else (rule 6). There is no address in an
 * account's values, so no value can send a key elsewhere.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import type { ConnectorContext, ConnectorError, ConnectorRead, PaymentConnector, PaymentKeys, PaymentMode } from '../types.js';
import { headerValue, safeDetail, withTimeout } from './shared.js';

export const WORLDLINE_HOSTS: Record<PaymentMode, string> = {
    test: 'api.preprod.connect.worldline-solutions.com',
    live: 'api.connect.worldline-solutions.com',
};

/** The domain every Connect page is on (rule 11). Which subdomain comes from the account. */
const PAGE_DOMAIN = '.worldline-solutions.com';
/** The name pre-production hosts carry, which a live page may never have (rule 6). */
const PREPROD_LABEL = /(^|\.)preprod\./;
/** Connect closes a hosted page after 2 hours, with no setting to shorten it. */
const PAGE_MINUTES = 120;
/** The longest order.customer.merchantCustomerId Connect takes. */
const CUSTOMER_ID_LENGTH = 15;

/**
 * Every status Connect's guide lists, and what it is here (rule 5). Strict until the proof on
 * a test account says otherwise: `CAPTURE_REQUESTED`, an authorisation, and anything waiting
 * for approval are not paid. A status not listed here is never paid.
 */
const PAYMENT_STATES: Record<string, ConnectorRead['state']> = {
    CREATED: 'open',
    REDIRECTED: 'open',
    ACCOUNT_VERIFIED: 'open',
    PENDING_PAYMENT: 'open',
    PENDING_FRAUD_APPROVAL: 'open',
    PENDING_APPROVAL: 'open',
    PENDING_COMPLETION: 'open',
    PENDING_CAPTURE: 'open',
    AUTHORIZATION_REQUESTED: 'open',
    CAPTURE_REQUESTED: 'open',
    CAPTURE_IN_PROGRESS: 'open',
    CAPTURED: 'paid',
    PAID: 'paid',
    COMPLETED: 'paid',
    REJECTED: 'failed',
    REJECTED_CAPTURE: 'failed',
    CANCELLED: 'cancelled',
    // Money moved and came back, or may yet. Only a person can say what that means.
    REVERSED: 'unclear',
    CHARGEBACK_NOTIFICATION: 'unclear',
    CHARGEBACKED: 'unclear',
    REFUNDED: 'unclear',
};

export function worldlineState(status: string | null | undefined): ConnectorRead['state'] {
    return (status && Object.hasOwn(PAYMENT_STATES, status) ? PAYMENT_STATES[status] : undefined) ?? 'open';
}

interface SdkAnswer {
    status: number;
    isSuccess?: boolean;
    body?: unknown;
}

/** The parts of the SDK's client used here. */
export interface WorldlineClient {
    v1: {
        hostedcheckouts: {
            create(merchantId: string, body: object, context?: object | null): Promise<SdkAnswer>;
            get(merchantId: string, id: string, context?: object | null): Promise<SdkAnswer>;
            remove(merchantId: string, id: string, context?: object | null): Promise<SdkAnswer>;
        };
        payments: {
            get(merchantId: string, id: string, context: object): Promise<SdkAnswer>;
            find(merchantId: string, context: object): Promise<SdkAnswer>;
            refund(merchantId: string, id: string, body: object, context?: object | null): Promise<SdkAnswer>;
        };
        services: { testconnection(merchantId: string, context?: object | null): Promise<SdkAnswer> };
    };
}

type ClientFactory = (host: string, keys: PaymentKeys) => Promise<WorldlineClient>;

const sdkClient: ClientFactory = async (host, keys) => {
    const sdk = await import('connect-sdk-nodejs');
    return sdk.init({
        host,
        scheme: 'https',
        port: 443,
        // The SDK can log whole requests; Arc logs nothing of a payment (rule 9).
        enableLogging: false,
        apiKeyId: keys['apiKeyId'],
        secretApiKey: keys['secretApiKey'],
        integrator: 'Arc CMS',
    }) as unknown as WorldlineClient;
};

let makeClient: ClientFactory = sdkClient;

/** For tests: build clients with this, until called with null. No test reaches the network. */
export function replaceWorldlineClientForTest(factory: ClientFactory | null): void {
    makeClient = factory ?? sdkClient;
}

function client(context: Pick<ConnectorContext, 'mode' | 'keys'>): Promise<WorldlineClient> {
    return makeClient(WORLDLINE_HOSTS[context.mode], context.keys);
}

/** A field's name in Worldline's error, such as order.customer.countryCode. Long, so safeDetail would take it for a key. */
const PROPERTY_NAME = /^[A-Za-z][A-Za-z0-9.[\]]{0,120}$/;

function failed(answer: SdkAnswer): ConnectorError {
    const body = answer.body as { errors?: Array<{ code?: string; message?: string; propertyName?: string }> } | undefined;
    const first = body?.errors?.[0];
    const field = first?.propertyName && PROPERTY_NAME.test(first.propertyName) ? ` ${first.propertyName}` : '';
    const said = first ? ` (${safeDetail(first.code ?? '')} ${safeDetail(first.message ?? '')}${field})`.replace(/\s+\)/, ')') : '';
    if (answer.status === 401 || answer.status === 403) return { ok: false, failure: 'key-refused', detail: `Worldline refused the keys${said}` };
    if (answer.status === 404) return { ok: false, failure: 'not-found', detail: `Worldline does not know this payment${said}` };
    if (answer.status === 429 || answer.status >= 500) return { ok: false, failure: 'unavailable', detail: `Worldline could not answer (${answer.status})` };
    return { ok: false, failure: 'refused', detail: `Worldline refused the request (${answer.status})${said}` };
}

const isOk = (answer: SdkAnswer) => answer.isSuccess ?? (answer.status >= 200 && answer.status < 300);

/** A call to the SDK, in the connectors' words when it could not be made at all. */
async function call(context: ConnectorContext, what: (c: WorldlineClient) => Promise<SdkAnswer>): Promise<SdkAnswer | ConnectorError> {
    return withTimeout(async () => what(await client(context)), context.timeoutMs, 'Worldline');
}

const isError = (value: SdkAnswer | ConnectorError): value is ConnectorError => (value as ConnectorError).ok === false;

interface WorldlinePayment {
    id?: string;
    status?: string;
    paymentOutput?: {
        amountOfMoney?: { amount?: number; currencyCode?: string };
        amountCaptured?: number;
        amountPaid?: number;
        references?: { merchantReference?: string };
        paymentMethod?: string;
        paymentProductId?: number;
    };
}

/**
 * What was really paid. `amountOfMoney` is what was asked for, so a captured or paid figure
 * wins where Connect gives one: a part capture must not read as the whole (rule 4).
 */
function paidFigure(output: WorldlinePayment['paymentOutput']): number | undefined {
    const moved = Math.max(output?.amountCaptured ?? 0, output?.amountPaid ?? 0);
    return moved > 0 ? moved : output?.amountOfMoney?.amount;
}

/** A key for one exact request: a retry of it makes no second page, and a changed amount is not answered with the old page. */
export function startKey(input: { paymentId: string; amountMinor: number; currency: string; returnUrl: string }): string {
    return createHash('sha256').update([input.paymentId, input.amountMinor, input.currency, input.returnUrl].join('\u0000')).digest('hex').slice(0, 40);
}

function paymentRead(payment: WorldlinePayment | undefined | null, mode: PaymentMode): ConnectorRead {
    const status = payment?.status ?? '';
    return {
        ok: true,
        state: worldlineState(status),
        providerStatus: status || 'no status',
        amountMinor: paidFigure(payment?.paymentOutput),
        currency: payment?.paymentOutput?.amountOfMoney?.currencyCode,
        reference: payment?.paymentOutput?.references?.merchantReference,
        providerPaymentId: payment?.id,
        method: [payment?.paymentOutput?.paymentMethod, payment?.paymentOutput?.paymentProductId].filter((part) => part !== undefined).join(' ') || undefined,
        // Worldline's two systems are separate hosts, so what answered says which it is.
        mode,
        paymentExists: !!payment?.id || !!status,
    };
}

export const worldlineConnect: PaymentConnector = {
    info: {
        id: 'worldline-connect',
        name: 'Worldline Connect',
        fields: [
            { id: 'merchantId', label: 'Merchant ID', secret: false, publicName: true, required: true, pattern: /^\d{1,20}$/ },
            { id: 'apiKeyId', label: 'API Key ID', secret: true, required: true, pattern: /^\S{4,200}$/, help: 'Configuration Center, Account settings, API keys (HMAC SHA-256).' },
            { id: 'secretApiKey', label: 'Secret API Key', secret: true, preview: true, required: true, pattern: /^\S{8,400}$/, help: 'Configuration Center, Account settings, API keys (HMAC SHA-256).' },
            { id: 'webhookKeyId', label: 'Webhooks Key ID', secret: true, required: true, pattern: /^\S{4,200}$/, help: 'Configuration Center, Account settings, Webhooks keys. Apart from the API key.' },
            { id: 'webhookSecret', label: 'Secret Webhooks Key', secret: true, required: true, pattern: /^\S{8,400}$/, help: 'Configuration Center, Account settings, Webhooks keys. Apart from the API key.' },
            { id: 'pageSubdomain', label: 'MyCheckout subdomain', secret: false, required: true, pattern: /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i, help: 'Configuration Center, Merchant settings, Hosted payment pages, Subdomains. The part before the first dot.' },
            { id: 'countryCode', label: "Merchant's country", secret: false, required: true, pattern: /^[A-Z]{2}$/, help: 'Two letters, such as CH. A QR buyer gives none, and Connect asks for one.' },
            { id: 'keyExpiresOn', label: 'API key ends on', secret: false, required: false, expiry: true, pattern: /^\d{4}-\d{2}-\d{2}$/, help: 'YYYY-MM-DD, from the Configuration Center, so the app can be warned first.' },
        ],
        modes: ['test', 'live'],
        separateKeys: true,
        webhookByHand: true,
        signsEvents: true,
        canEndPage: true,
        pageLife: { settable: false, minutes: PAGE_MINUTES },
        canRefund: true,
        canRefundPart: true,
        proven: false,
        maxReferenceLength: 30,
    },

    pageHost: () => PAGE_DOMAIN,
    pageOnWrongSystem: (hostname, mode) => mode === 'live' && PREPROD_LABEL.test(hostname),

    async testKeys(context) {
        const answer = await call(context, (c) => c.v1.services.testconnection(context.keys['merchantId']));
        if (isError(answer)) return answer;
        return isOk(answer) ? { ok: true } : failed(answer);
    },

    async start(context, input) {
        const answer = await call(context, (c) =>
            c.v1.hostedcheckouts.create(
                context.keys['merchantId'],
                {
                    order: {
                        amountOfMoney: { amount: input.amountMinor, currencyCode: input.currency },
                        customer: {
                            // Connect asks for one for some ways of paying. Arc keeps no customer, and a buyer may
                            // be anonymous, so it comes from the payment: no person in it, and buyers are not made
                            // one customer to fraud screening, as a fixed word would.
                            merchantCustomerId: input.paymentId.slice(0, CUSTOMER_ID_LENGTH),
                            // The merchant's country, not a person's: a QR buyer gives neither name nor address.
                            billingAddress: { countryCode: context.keys['countryCode'] },
                        },
                        references: { merchantReference: input.reference },
                    },
                    hostedCheckoutSpecificInput: {
                        returnUrl: input.returnUrl,
                        showResultPage: false,
                        // Otherwise a buyer's cancel only ever reads as still in progress.
                        returnCancelState: true,
                        ...(input.language ? { locale: input.language } : {}),
                    },
                    // A sale, not an authorisation waiting for the merchant's approval, for every way of paying:
                    // Arc has no approve call, and a QR buyer is waiting.
                    cardPaymentMethodSpecificInput: { requiresApproval: false },
                    redirectPaymentMethodSpecificInput: { requiresApproval: false },
                    mobilePaymentMethodSpecificInput: { requiresApproval: false },
                },
                // A retry of the same record never makes a second page.
                { idempotence: { key: startKey(input) } },
            ),
        );
        if (isError(answer)) return answer;
        if (!isOk(answer)) return failed(answer);
        const body = answer.body as { hostedCheckoutId?: string; partialRedirectUrl?: string };
        if (!body?.hostedCheckoutId || !body.partialRedirectUrl) return { ok: false, failure: 'unreadable', detail: 'Worldline gave no page for this payment' };
        const partial = body.partialRedirectUrl.replace(/^\.+/, '');
        return { ok: true, providerId: body.hostedCheckoutId, pageUrl: `https://${context.keys['pageSubdomain']}.${partial}`, lifeMinutes: PAGE_MINUTES };
    },

    async read(context, ids) {
        const answer = await call(context, (c) => c.v1.hostedcheckouts.get(context.keys['merchantId'], ids.providerId));
        if (isError(answer)) return answer;
        if (answer.status === 404) {
            // An ended page can no longer be read, but a payment made on it can, even one nobody has seen yet.
            if (ids.providerPaymentId) {
                const direct = await call(context, (c) => c.v1.payments.get(context.keys['merchantId'], ids.providerPaymentId!, {}));
                if (isError(direct)) return direct;
                return isOk(direct) ? paymentRead(direct.body as WorldlinePayment, context.mode) : failed(direct);
            }
            const found = await call(context, (c) => c.v1.payments.find(context.keys['merchantId'], { hostedCheckoutId: ids.providerId }));
            if (isError(found)) return found;
            if (!isOk(found)) return failed(found);
            const payments = (found.body as { payments?: WorldlinePayment[] })?.payments ?? [];
            const best = payments.find((p) => worldlineState(p.status) === 'paid') ?? payments[payments.length - 1];
            return best ? paymentRead(best, context.mode) : failed(answer);
        }
        if (!isOk(answer)) return failed(answer);
        const body = answer.body as { status?: string; createdPaymentOutput?: { payment?: WorldlinePayment } };
        const status = body?.status ?? '';
        if (status === 'PAYMENT_CREATED' || body?.createdPaymentOutput?.payment) return paymentRead(body.createdPaymentOutput?.payment, context.mode);
        if (status === 'CANCELLED_BY_CONSUMER') return { ok: true, state: 'cancelled', providerStatus: status, mode: context.mode };
        if (status === 'CLIENT_NOT_ELIGIBLE_FOR_SELECTED_PAYMENT_PRODUCT') return { ok: true, state: 'failed', providerStatus: status, mode: context.mode };
        return { ok: true, state: 'open', providerStatus: status || 'no status', mode: context.mode };
    },

    async end(context, ids) {
        const answer = await call(context, (c) => c.v1.hostedcheckouts.remove(context.keys['merchantId'], ids.providerId));
        if (isError(answer)) return answer;
        return isOk(answer) || answer.status === 404 ? { ok: true } : failed(answer);
    },

    async refund(context, ids, input) {
        if (!ids.providerPaymentId) return { ok: false, failure: 'not-found', detail: 'Worldline has no payment to refund on this page' };
        const paymentId = ids.providerPaymentId;
        const answer = await call(context, (c) =>
            c.v1.payments.refund(
                context.keys['merchantId'],
                paymentId,
                {
                    ...(input.amountMinor !== undefined ? { amountOfMoney: { amount: input.amountMinor, currencyCode: input.currency } } : {}),
                    refundReferences: { merchantReference: input.reference },
                },
                { idempotence: { key: input.paymentId } },
            ),
        );
        if (isError(answer)) return answer;
        if (!isOk(answer)) return failed(answer);
        const body = answer.body as { id?: string; status?: string };
        return { ok: true, refundId: body?.id ?? '', providerStatus: body?.status ?? '' };
    },

    verificationHeader: 'x-gcs-webhooks-endpoint-verification',

    verifyEvent(rawBody, headers, keysByMode) {
        const signature = headerValue(headers, 'x-gcs-signature');
        const keyId = headerValue(headers, 'x-gcs-keyid');
        if (!signature || !keyId) return false;
        // Only a key the server holds, named by its id, for either of the account's modes.
        const matches = Object.values(keysByMode).filter((keys): keys is PaymentKeys => !!keys && keys['webhookKeyId'] === keyId && !!keys['webhookSecret']);
        const given = Buffer.from(signature, 'utf8');
        return matches.some((keys) => {
            const expected = Buffer.from(createHmac('sha256', keys['webhookSecret']).update(rawBody).digest('base64'), 'utf8');
            return expected.length === given.length && timingSafeEqual(expected, given);
        });
    },

    parseEvent(rawBody) {
        const event = parseJson(rawBody);
        const id = typeof event?.['id'] === 'string' ? event['id'] : '';
        const payment = event?.['payment'] as WorldlinePayment | undefined;
        const reference = payment?.paymentOutput?.references?.merchantReference;
        // Worldline's Test button sends an event whose id starts with TEST. It names no payment.
        if (!id || id.startsWith('TEST') || typeof reference !== 'string' || !reference) return null;
        return { eventId: id, type: typeof event?.['type'] === 'string' ? (event['type'] as string).slice(0, 60) : 'unknown', reference, providerPaymentId: typeof payment?.id === 'string' ? payment.id : undefined };
    },
};

function parseJson(raw: Buffer): Record<string, unknown> | null {
    try {
        const value: unknown = JSON.parse(raw.toString('utf8'));
        return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
    } catch {
        return null;
    }
}
