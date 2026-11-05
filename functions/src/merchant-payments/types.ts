/**
 * Online payments on a merchant's own provider account (docs/app/merchant-payments.html).
 *
 * Arc's Payments feature sells the site's own plans through one account. This is the other
 * need: each customer of an app takes money from their own buyers on their own provider
 * account, and the money never passes through the site's owner.
 *
 * What an app sees, and what every connector takes and returns. A connector only speaks to
 * one provider and says what came back, in these words; the accounts, the records, the
 * checks against the app's own record and the delivery of a result are core's.
 */

/** Test or live, always named: nothing falls back from one to the other. */
export type PaymentMode = 'test' | 'live';

/** A record's status. `held` waits for a person; `starting` is a page being asked for. */
export type PaymentStatus = 'starting' | 'open' | 'paid' | 'failed' | 'cancelled' | 'held';

/** The final statuses a result carries to the app. */
export type PaymentResultStatus = 'paid' | 'failed' | 'cancelled';

/** One value a merchant types to connect. The app's screen shows it in its own words. */
export interface PaymentField {
    id: string;
    /** The provider's name for it, for the app to word its own label from. */
    label: string;
    /** Never comes back to any page, and is kept only where no browser can read. */
    secret: boolean;
    /** The value is the account's public name, which a page may show. */
    publicName?: boolean;
    /** The secret whose last 4 characters a page may show. */
    preview?: boolean;
    /** Must be given. An optional field may be left out. */
    required: boolean;
    /** What a value must look like. */
    pattern?: RegExp;
    /** The field holds the date the keys end, as YYYY-MM-DD (rule 10). */
    expiry?: boolean;
    /** A line for the app's own help text. */
    help?: string;
}

/** What a connector says about itself, so one screen of the app serves every provider. */
export interface PaymentConnectorInfo {
    id: string;
    name: string;
    fields: PaymentField[];
    /** The modes it can be connected in. A provider with no test system has only `live`. */
    modes: readonly PaymentMode[];
    /** Test and live take separate keys. */
    separateKeys: boolean;
    /** The owner adds the webhook address in the provider's own admin. */
    webhookByHand: boolean;
    /** The provider signs its events (rule 2). */
    signsEvents: boolean;
    /** An open page can be ended. */
    canEndPage: boolean;
    /** How long a page stays open: settable up to a limit, or fixed by the provider. */
    pageLife: { settable: true; maxMinutes: number; defaultMinutes: number } | { settable: false; minutes: number };
    canRefund: boolean;
    canRefundPart: boolean;
    /**
     * It has passed every rule on the provider's own test account, for each way of paying
     * (docs/app/merchant-payments.html#proof). Only then may a merchant pick it.
     */
    proven: boolean;
    /** The longest reference the provider takes. */
    maxReferenceLength: number;
}

export type ConnectorFailure = 'no-keys' | 'key-refused' | 'unavailable' | 'timeout' | 'not-found' | 'unreadable' | 'refused' | 'bad-page-address' | 'unsupported';

export interface ConnectorError {
    ok: false;
    failure: ConnectorFailure;
    /** Plain words, with nothing secret in them. */
    detail: string;
}

/** The account's values, as stored for one mode. */
export type PaymentKeys = Record<string, string>;

export interface ConnectorContext {
    mode: PaymentMode;
    keys: PaymentKeys;
    timeoutMs: number;
}

export interface ConnectorStartInput {
    /** The Arc record's id, so a retried request never makes a second page where the provider can tell. */
    paymentId: string;
    amountMinor: number;
    currency: string;
    reference: string;
    returnUrl: string;
    /** Minutes, where the provider lets Arc set it. */
    lifeMinutes?: number;
    /** The buyer's language, where the provider takes one. */
    language?: string;
}

/**
 * A page was made. `pageUrl` is checked by core against `pageHost` before anyone sees it
 * (rule 11). A provider whose page takes a form posted from a browser, as myPOS does, gives
 * the form here instead when it arrives, and `pageUrl` becomes a page of Arc's own.
 */
export interface ConnectorStarted {
    ok: true;
    providerId: string;
    pageUrl: string;
    /** When the provider closes the page, in minutes from now. */
    lifeMinutes: number;
}

/** What the provider says about a payment, read back from it. */
export interface ConnectorRead {
    ok: true;
    /** `unclear`: money may have moved, and only a person can say what it means. */
    state: 'open' | 'paid' | 'failed' | 'cancelled' | 'unclear';
    /** The provider's own word, for the record and the proof. */
    providerStatus: string;
    /** What the provider says was paid. A paid state with any of these missing is held. */
    amountMinor?: number;
    currency?: string;
    reference?: string;
    /** The provider's id for the payment, as apart from its page. */
    providerPaymentId?: string;
    /** The system the provider says the payment was on, where it says (rule 6). */
    mode?: PaymentMode;
    /** How the buyer paid, such as a card or TWINT: the provider's name for it, for the proof. */
    method?: string;
    /** A payment exists on this page, finished or not: an open one may yet become money, so it is never closed as unpaid. */
    paymentExists?: boolean;
}

/** What one delivery says, before anything is believed (rule 4). */
export interface ParsedEvent {
    /** The provider's id for the event, or a hash of its bytes where it gives none (rule 7). */
    eventId: string;
    /** The provider's word for what happened; only ever a label. */
    type: string;
    /** The app's reference, to find the record. */
    reference: string;
    /** The provider's id for the payment, to read it back. */
    providerPaymentId?: string;
}

export interface ConnectorRefund {
    ok: true;
    refundId: string;
    /** The provider's own word for the refund. */
    providerStatus: string;
}

/** The record's ids a read needs. */
export interface ProviderIds {
    providerId: string;
    /** From an earlier read, or a hint in an event, which a connector must not believe by itself. */
    providerPaymentId?: string;
    /** The app's reference on this record. */
    reference: string;
}

export type Headers = Record<string, string | string[] | undefined>;

/** One provider. Loads no slow library until a call needs it: the webhook uses only verify and parse (rule 8). */
export interface PaymentConnector {
    info: PaymentConnectorInfo;
    /** The one host a payment page may be on, or a suffix starting with a dot (rule 11). */
    pageHost(context: Pick<ConnectorContext, 'mode' | 'keys'>): string;
    /** A page on the provider's domain, but on its other system (rule 6). */
    pageOnWrongSystem?(hostname: string, mode: PaymentMode): boolean;
    /** A call to the provider: are these keys good, here, now? */
    testKeys(context: ConnectorContext): Promise<{ ok: true } | ConnectorError>;
    start(context: ConnectorContext, input: ConnectorStartInput): Promise<ConnectorStarted | ConnectorError>;
    read(context: ConnectorContext, ids: ProviderIds): Promise<ConnectorRead | ConnectorError>;
    end(context: ConnectorContext, ids: ProviderIds): Promise<{ ok: true } | ConnectorError>;
    refund(context: ConnectorContext, ids: ProviderIds, input: { amountMinor?: number; currency: string; reference: string; paymentId: string }): Promise<ConnectorRefund | ConnectorError>;
    /**
     * Whether an event was signed with a key the server holds, over these exact bytes
     * (rules 2, 3). Only for a connector that signs; one that does not leaves it out, and its
     * events only ever prompt a read back.
     */
    verifyEvent?(rawBody: Buffer, headers: Headers, keysByMode: Partial<Record<PaymentMode, PaymentKeys>>): boolean;
    /** The header a provider's address check sends, answered with its value as plain text. */
    verificationHeader?: string;
    /** Reads one delivery; null when it names no payment of ours. */
    parseEvent(rawBody: Buffer, headers: Headers): ParsedEvent | null;
}

/** What a page may read of an account (rule 1). Nothing here is secret. */
export interface PublicPaymentAccount {
    accountId: string;
    provider: string;
    mode: PaymentMode;
    publicName: string;
    last4: string;
    /** The modes keys are held for. */
    modesWithKeys: PaymentMode[];
    connectedAtIso: string;
    connectedBy: string;
    updatedAtIso: string;
    updatedBy: string;
    /** The address to show the owner, who adds it in the provider's admin where webhookByHand says so. */
    webhookAddress: string;
    keyExpiresOn?: string;
    /** The last payment update. */
    lastPaymentAtIso?: string;
    lastPaymentStatus?: PaymentStatus;
    /** What is wrong now, by alert type; empty when all is well. */
    problems: Partial<Record<PaymentAlertType, string>>;
}

export type PaymentFailureReason =
    | 'off'
    | 'not-offered'
    | 'mode-not-supported'
    | 'bad-input'
    | 'bad-field'
    | 'no-account'
    | 'account-incomplete'
    | 'no-keys-for-mode'
    | 'not-found'
    | 'reference-used'
    | 'busy'
    | 'open-payments'
    | 'not-held'
    | 'not-paid'
    | 'too-much'
    | ConnectorFailure;

export interface PublicAccountAnswer {
    ok: true;
    account: PublicPaymentAccount;
}

export interface PaymentFailure {
    ok: false;
    reason: PaymentFailureReason;
    /** Plain words for the app's log or its own message. Never anything secret. */
    detail: string;
}

export interface ConnectPaymentAccountInput {
    /** The app's own id for this customer, such as a business id. */
    accountId: string;
    provider: string;
    mode: PaymentMode;
    /** The values the connector's fields ask for. */
    fields: Record<string, unknown>;
    /** Who is connecting, for the record: the arccms_uid. */
    by: string;
}

export interface StartPaymentInput {
    accountId: string;
    /** Whole minor units: 1250 for CHF 12.50. */
    amountMinor: number;
    /** ISO 4217, upper case. */
    currency: string;
    /** The app's own reference, unique in the account. */
    reference: string;
    /** An https address the buyer returns to. It proves nothing about the payment. */
    returnUrl: string;
    /** How long the page stays open, where the provider allows it. Otherwise the answer says what it is. */
    lifeMinutes?: number;
    language?: string;
}

export interface StartedPayment {
    ok: true;
    paymentId: string;
    pageUrl: string;
    providerId: string;
    /** When the provider closes the page, ISO. */
    closesAtIso: string;
    /** The provider fixes the page's life, so `lifeMinutes` was not used. */
    lifeFixedByProvider: boolean;
    /** The same reference was started before and its page is still open. */
    existing: boolean;
    mode: PaymentMode;
}

/** A payment as an app sees it. */
export interface PaymentView {
    ok: true;
    paymentId: string;
    accountId: string;
    reference: string;
    status: PaymentStatus;
    amountMinor: number;
    currency: string;
    mode: PaymentMode;
    provider: string;
    providerId: string;
    /** The money came after the payment had failed or been cancelled. */
    late: boolean;
    /** Why it is held, in the words of `heldReasons`. */
    heldReasons: string[];
    refundedMinor: number;
    /** A refund with no answer yet: settle it with settleRefund once the provider's own account shows what happened. */
    refundingMinor?: number;
    closesAtIso: string;
    /** The provider's own last word, and how the buyer paid, for the proof and the app's log. */
    providerStatus?: string;
    method?: string;
    /** An event from the provider has arrived for it. */
    eventSeen: boolean;
    /** The provider answered just now. False: this is what Arc last knew, and `detail` says why. */
    checked: boolean;
    detail?: string;
}

/** The result, handed to the app's `onResult`. */
export interface PaymentResult {
    /**
     * The same for any second delivery after a crash: write with it as a document id and the
     * result is applied once, even then.
     */
    resultId: string;
    paymentId: string;
    accountId: string;
    reference: string;
    status: PaymentResultStatus;
    /** What the provider says was paid, for a paid result; otherwise what was asked. */
    amountMinor: number;
    currency: string;
    provider: string;
    providerId: string;
    mode: PaymentMode;
    /** Paid after the app had heard failed or cancelled, as when a buyer finishes after the app gave up. */
    late: boolean;
    /** A person decided, with resolveHeldPayment. */
    resolvedBy?: string;
}

export type PaymentAlertType = 'key-expiring' | 'key-refused' | 'webhook-silent' | 'payment-held' | 'delivery-failed';

/** Something the app should tell someone (rule 10). Each is said once, until it changes. */
export interface PaymentAlert {
    type: PaymentAlertType;
    accountId: string;
    provider: string;
    mode: PaymentMode;
    /** Plain words for a log; the app says it in its own. */
    detail: string;
    /** key-expiring: the day the keys end, and how many days are left. */
    expiresOn?: string;
    daysLeft?: number;
    /** payment-held, delivery-failed: which payment. */
    reference?: string;
    /** payment-held: what did not match. */
    reasons?: string[];
}

/** What `functions/src/custom/payments.ts` exports. */
export interface PaymentHooks {
    /** Called with each result. A throw or a rejection is delivered again later, with the same resultId. */
    onResult?: (result: PaymentResult) => unknown;
    onAlert?: (alert: PaymentAlert) => unknown;
}
