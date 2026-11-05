/**
 * Where merchant payments keep things, and the small facts about them.
 *
 *   MerchantAccounts/{accountId}          what a page may read of an account (rule 1)
 *   MerchantAccountKeys/{accountId}       the provider's keys: no browser, ever
 *   MerchantWebhooks/{webhookId}          which account a webhook address is for
 *   MerchantPayments/{paymentId}          one payment, no buyer's details
 *   MerchantPaymentEvents/{eventKey}      one delivery, its id and where to look, for 7 days
 *
 * Keys are read here and nowhere else, so moving them to Secret Manager changes this file.
 */
import { createHash, randomBytes } from 'node:crypto';
import { arcFunctionsRegion } from '../arc-config.js';
import { db } from '../init.js';
import { arcFunctionName } from '../function-names.js';
import type { PaymentKeys, PaymentMode, PaymentStatus, PublicPaymentAccount } from './types.js';

export const ACCOUNTS = 'MerchantAccounts';
export const ACCOUNT_KEYS = 'MerchantAccountKeys';
export const WEBHOOKS = 'MerchantWebhooks';
export const PAYMENTS = 'MerchantPayments';
export const EVENTS = 'MerchantPaymentEvents';

/** The function that takes every provider's events. */
export const WEBHOOK_FUNCTION = 'merchantPaymentWebhook';

/** The id of one account's one payment: the same reference is always the same record. */
export function paymentIdFor(accountId: string, reference: string): string {
    return createHash('sha256').update(`${accountId}\u0000${reference}`).digest('hex').slice(0, 40);
}

export function eventKeyFor(provider: string, webhookId: string, eventId: string): string {
    return createHash('sha256').update(`${provider}\u0000${webhookId}\u0000${eventId}`).digest('hex').slice(0, 40);
}

/** A public id for an address: random, so an address says nothing about whose it is. It proves nothing either. */
export function newWebhookId(): string {
    return randomBytes(16).toString('hex');
}

export function webhookAddress(webhookId: string, env: Record<string, string | undefined> = process.env): string {
    const project = env['GCLOUD_PROJECT'] ?? env['GCP_PROJECT'] ?? '';
    return `https://${arcFunctionsRegion(env)}-${project}.cloudfunctions.net/${arcFunctionName(WEBHOOK_FUNCTION)}/${webhookId}`;
}

export interface AccountKeysDoc {
    provider: string;
    webhookId: string;
    modes: Partial<Record<PaymentMode, PaymentKeys>>;
}

export async function readAccountKeys(accountId: string): Promise<AccountKeysDoc | null> {
    const snap = await db.collection(ACCOUNT_KEYS).doc(accountId).get();
    if (!snap.exists) return null;
    const data = snap.data() ?? {};
    return { provider: String(data['provider'] ?? ''), webhookId: String(data['webhookId'] ?? ''), modes: (data['modes'] ?? {}) as AccountKeysDoc['modes'] };
}

export interface AccountDoc extends Omit<PublicPaymentAccount, 'webhookAddress'> {
    webhookId: string;
    /** Each alert's last word, so it is said once (rule 10). */
    alertsSaid?: Record<string, string>;
    /** Payments the sweep found finished with no event in between (rule 10). */
    silentFinishes?: number;
}

export async function readAccount(accountId: string): Promise<AccountDoc | null> {
    const snap = await db.collection(ACCOUNTS).doc(accountId).get();
    return snap.exists ? (snap.data() as AccountDoc) : null;
}

/** The record of one payment. */
export interface PaymentRecord {
    paymentId: string;
    accountId: string;
    reference: string;
    provider: string;
    mode: PaymentMode;
    status: PaymentStatus;
    amountMinor: number;
    currency: string;
    /** What the provider said was paid. */
    paidMinor?: number;
    paidCurrency?: string;
    providerId: string;
    providerPaymentId?: string;
    providerStatus?: string;
    /** How the buyer paid: the provider's name for it. */
    method?: string;
    pageUrl: string;
    late: boolean;
    heldReasons: string[];
    refundedMinor: number;
    /** A refund was asked for and not answered yet, so a second cannot be asked on top of it. */
    refundingMinor?: number;
    refundCount?: number;
    /** When the provider was last read, so a flood of unsigned events cannot become a flood of reads. */
    lastReadAtMs?: number;
    /** The provider's payment id from the last event: a hint, checked before it is believed. */
    eventHint?: string;
    createdAtMs: number;
    closesAtMs: number;
    /** Present while the sweep should read it again; a plain number, so one field's index finds them. */
    nextCheckAtMs?: number;
    checks: number;
    /** An event arrived for it. */
    eventSeen: boolean;
    /** Results waiting to reach the app, oldest first. */
    pending: PendingResult[];
    /** Present while something waits to reach the app; when the sweep should try it again. */
    deliveryNextAtMs?: number;
    deliveryAttempts: number;
    deliveryClaimedAtMs?: number;
    resolvedBy?: string;
}

/** Something waiting to reach the app: a result, or `held`, which goes to onAlert. */
export interface PendingResult {
    status: 'paid' | 'failed' | 'cancelled' | 'held';
    late: boolean;
    resolvedBy?: string;
}
