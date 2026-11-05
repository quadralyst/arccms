/**
 * The pretend connector: a provider with no network, for tests, the emulator and a dev
 * project (docs/app/merchant-payments.html#pretend). It signs its events and is read back
 * like a real provider, so an app's flow runs through every rule.
 *
 * Test mode only, so nothing it says can ever count as money (rule 6), and only where
 * `pretendAllowed()` says: a live project has it only if someone sets the switch by hand.
 * What it "knows" is kept in MerchantPretendPayments, so any instance can read it back.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../../init.js';
import type { ConnectorRead, PaymentConnector } from '../types.js';
import { headerValue } from './shared.js';

export const PRETEND_ID = 'pretend';
export const PRETEND_COLLECTION = 'MerchantPretendPayments';
export const PRETEND_HOST = 'pretend-pay.arccms.invalid';
export const PRETEND_SIGNATURE_HEADER = 'x-pretend-signature';
export const PRETEND_KEY_ID_HEADER = 'x-pretend-keyid';
export const PRETEND_REFUSED_KEY = 'refuse-this-key';
const LIFE = 30;

/** On the emulator, in tests, or where a project's functions/.env.<project> sets the switch. */
export function pretendAllowed(env: Record<string, string | undefined> = process.env): boolean {
    return env['FUNCTIONS_EMULATOR'] === 'true' || env['VITEST'] === 'true' || env['ARC_PAYMENTS_PRETEND'] === 'on';
}

/** How the pretend provider signs an event: the same shape as a real one's. */
export function pretendSignature(rawBody: Buffer, secret: string): string {
    return createHmac('sha256', secret).update(rawBody).digest('base64');
}

export const pretendConnector: PaymentConnector = {
    info: {
        id: PRETEND_ID,
        name: 'Pretend provider',
        fields: [
            { id: 'accountName', label: 'Account name', secret: false, publicName: true, required: true, pattern: /^[\w .-]{1,60}$/ },
            { id: 'secretKey', label: 'Secret key', secret: true, preview: true, required: true, pattern: /^\S{8,400}$/ },
            { id: 'webhookKeyId', label: 'Webhook key ID', secret: true, required: true, pattern: /^\S{4,200}$/ },
            { id: 'webhookSecret', label: 'Webhook secret', secret: true, required: true, pattern: /^\S{8,400}$/ },
            { id: 'keyExpiresOn', label: 'Key ends on', secret: false, required: false, expiry: true, pattern: /^\d{4}-\d{2}-\d{2}$/ },
        ],
        modes: ['test'],
        separateKeys: true,
        webhookByHand: false,
        signsEvents: true,
        canEndPage: true,
        pageLife: { settable: true, maxMinutes: 24 * 60, defaultMinutes: LIFE },
        canRefund: true,
        canRefundPart: true,
        // Not a provider a merchant picks: listed only where pretendAllowed() says.
        proven: false,
        maxReferenceLength: 200,
    },

    pageHost: () => PRETEND_HOST,

    async testKeys({ keys }) {
        return keys['secretKey'] === PRETEND_REFUSED_KEY ? { ok: false, failure: 'key-refused', detail: 'The pretend provider refused the keys' } : { ok: true };
    },

    async start({ keys }, input) {
        if (keys['secretKey'] === PRETEND_REFUSED_KEY) return { ok: false, failure: 'key-refused', detail: 'The pretend provider refused the keys' };
        const providerId = `pretend_${createHash('sha256').update(input.paymentId).digest('hex').slice(0, 24)}`;
        await db.collection(PRETEND_COLLECTION).doc(providerId).set({
            providerStatus: 'waiting',
            amountMinor: input.amountMinor,
            currency: input.currency,
            reference: input.reference,
            paymentId: input.paymentId,
        });
        return { ok: true, providerId, pageUrl: `https://${PRETEND_HOST}/pay/${providerId}`, lifeMinutes: input.lifeMinutes ?? LIFE };
    },

    async read({ keys }, ids) {
        if (keys['secretKey'] === PRETEND_REFUSED_KEY) return { ok: false, failure: 'key-refused', detail: 'The pretend provider refused the keys' };
        const snap = await db.collection(PRETEND_COLLECTION).doc(ids.providerId).get();
        if (!snap.exists) return { ok: false, failure: 'not-found', detail: 'The pretend provider does not know this payment' };
        const data = snap.data() ?? {};
        const providerStatus = String(data['providerStatus'] ?? 'waiting');
        // As Connect: an ended page can no longer be read, unless a payment was made on it.
        if (data['ended'] && (providerStatus === 'waiting' || providerStatus === 'cancelled')) return { ok: false, failure: 'not-found', detail: 'The pretend provider has ended this page' };
        const states: Record<string, ConnectorRead['state']> = {
            waiting: 'open',
            'waiting-approval': 'open',
            authorized: 'open',
            paid: 'paid',
            failed: 'failed',
            cancelled: 'cancelled',
            'charged-back': 'unclear',
        };
        return {
            ok: true,
            state: states[providerStatus] ?? 'open',
            providerStatus,
            amountMinor: typeof data['amountMinor'] === 'number' ? data['amountMinor'] : undefined,
            currency: typeof data['currency'] === 'string' ? data['currency'] : undefined,
            reference: typeof data['reference'] === 'string' ? data['reference'] : undefined,
            providerPaymentId: `${ids.providerId}_p`,
            mode: 'test',
            method: 'pretend',
            paymentExists: providerStatus !== 'waiting' && providerStatus !== 'cancelled',
        };
    },

    async end(_context, ids) {
        await db.collection(PRETEND_COLLECTION).doc(ids.providerId).set({ ended: true }, { merge: true });
        return { ok: true };
    },

    async refund(_context, ids) {
        return { ok: true, refundId: `${ids.providerId}_r${Date.now()}`, providerStatus: 'refunded' };
    },

    verifyEvent(rawBody, headers, keysByMode) {
        const signature = headerValue(headers, PRETEND_SIGNATURE_HEADER);
        const keyId = headerValue(headers, PRETEND_KEY_ID_HEADER);
        if (!signature || !keyId) return false;
        const keys = keysByMode.test;
        if (!keys || keys['webhookKeyId'] !== keyId || !keys['webhookSecret']) return false;
        const expected = Buffer.from(pretendSignature(rawBody, keys['webhookSecret']), 'utf8');
        const given = Buffer.from(signature, 'utf8');
        return expected.length === given.length && timingSafeEqual(expected, given);
    },

    parseEvent(rawBody) {
        try {
            const event = JSON.parse(rawBody.toString('utf8')) as { id?: unknown; type?: unknown; reference?: unknown };
            if (typeof event?.id !== 'string' || typeof event.reference !== 'string' || !event.id || !event.reference) return null;
            return { eventId: event.id, type: typeof event.type === 'string' ? event.type.slice(0, 40) : 'unknown', reference: event.reference };
        } catch {
            return null;
        }
    },
};
