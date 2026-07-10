import { Timestamp } from 'firebase-admin/firestore';

/**
 * Shared types for the Dodo Payments integration.
 *
 * Collections:
 *   Settings/dodo-payments  → single config document (secrets masked on read in the UI layer)
 *   Products                → mirror of Dodo products + tiering/entitlement metadata
 *   Transactions            → normalized payment records (admin UI + user history)
 *   WebhookEvents           → raw, verbatim webhook payloads (forensics + idempotency)
 */

/** Firestore Settings/dodo-payments document. */
export interface DodoPaymentsSettings {
  enabled?: boolean;
  mode?: 'test' | 'live';
  testApiKey?: string;
  liveApiKey?: string;
  /** Standard-Webhooks signing secret used by client.webhooks.unwrap(). */
  webhookSecret?: string;
  brandId?: string;
  successUrl?: string;
  cancelUrl?: string;
  createdAt?: Timestamp;
  updatedAt?: Timestamp;
}

/**
 * A headcount-based pricing tier. Tiers are evaluated in ascending `maxCount`
 * order: the active tier for a buyer is the first whose `maxCount` is greater
 * than the number of confirmed purchases so far. A `maxCount <= 0` means
 * "everyone else" (unbounded — must be the last tier).
 *
 * The authoritative redemption cap is enforced by the Dodo discount code's own
 * usage limit (set when creating the code in Dodo) — the local counter only
 * selects which code to apply.
 */
export interface PricingTier {
  label: string;
  maxCount: number;
  /** Dodo discount code applied for this tier ('' = full price, no discount). */
  discountCode: string;
  /** Display-only percentage shown in the admin UI / pricing page. */
  discountPct: number;
}

/** Firestore Products document (the fields the backend relies on). */
export interface ProductDoc {
  id?: string;
  name: string;
  description?: string;
  features?: string[];
  active: boolean;
  dodoProductId: string;
  type: 'one_time' | 'subscription';
  /** Entitlement granted on successful purchase, e.g. 'plus' | 'gold' | 'platinum'. */
  premiumType: string;
  /** Higher rank wins when a user already holds an entitlement. */
  tierRank: number;
  interval?: 'month' | 'year';
  trialDays?: number;
  /**
   * One-time products only: length of the included "free updates" window. Access
   * itself is lifetime (never auto-revoked); `updatesUntil` on the user is set to
   * purchase date + this span. Both may be set; they add together.
   */
  updatesYears?: number;
  updatesDays?: number;
  tiers: PricingTier[];
  /** Count of confirmed purchases — incremented once per successful payment. */
  purchaseCount: number;
}

export type TransactionStatus = 'succeeded' | 'failed' | 'refunded' | 'pending';

/** Firestore Transactions document. */
export interface TransactionDoc {
  userId: string;
  userEmail: string;
  dodoPaymentId?: string;
  dodoSubscriptionId?: string;
  productId: string;
  premiumType: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  type: 'one_time' | 'subscription';
  tierApplied?: string;
  eventType: string;
  /**
   * Stable dedup key. `pay:<payment_id>` when a payment id is present, otherwise
   * `sub:<subscription_id>:<eventType>:<period>` so subscription-only events
   * (which carry no payment id) are still idempotent across redeliveries.
   */
  idempotencyKey: string;
  createdAt: Timestamp;
}

/** Firestore WebhookEvents document (raw forensic log). */
export interface WebhookEventDoc {
  eventType: string;
  rawPayload: unknown;
  headers: Record<string, string>;
  signatureValid: boolean;
  receivedAt: Timestamp;
  processed: boolean;
  processingError?: string;
}

/**
 * Minimal shape of a Dodo webhook payload we depend on.
 * See https://docs.dodopayments.com/developer-resources/webhooks
 */
export interface DodoWebhookPayload {
  business_id?: string;
  type: string;
  timestamp?: string;
  data: DodoWebhookData;
}

export interface DodoWebhookData {
  payload_type?: string;
  payment_id?: string;
  subscription_id?: string;
  total_amount?: number;
  settlement_amount?: number;
  currency?: string;
  status?: string;
  next_billing_date?: string;
  trial_period_days?: number;
  customer?: { customer_id?: string; email?: string; name?: string };
  metadata?: Record<string, string>;
  [key: string]: unknown;
}

/** Entitlement fields written onto a users/{id} document. */
export interface UserEntitlement {
  isPro: boolean;
  premiumType: string | null;
  premiumTierRank: number | null;
  premiumStatus: 'active' | 'trialing' | 'past_due' | 'cancelled' | 'expired' | null;
  premiumExpiresAt: Timestamp | null;
  dodoSubscriptionId: string | null;
  dodoCustomerId: string | null;
  /**
   * Timestamp of the webhook event that last drove this entitlement. Used to
   * discard out-of-order deliveries (e.g. a delayed `active` arriving after a
   * `cancelled`). Null when no ordered event has been applied yet.
   */
  premiumEventAt?: Timestamp | null;
  /**
   * One-time purchases only: the end of the included free-updates window
   * (purchase date + product.updatesYears/updatesDays). Access is lifetime; this
   * date only governs update eligibility and is never used to revoke `isPro`.
   */
  updatesUntil?: Timestamp | null;
}

export const PAYMENT_EMAIL_TYPES = [
  'payment_succeeded_email',
  'payment_failed_email',
  'subscription_lifecycle_email',
  'trial_ending_email',
] as const;

export type PaymentEmailType = (typeof PAYMENT_EMAIL_TYPES)[number];
