import { Timestamp } from 'firebase-admin/firestore';

/**
 * Shared types for the payments integration.
 *
 * Currently only Dodo Payments is wired up, but the stored records are kept
 * gateway-neutral (a `provider` discriminator + `provider*` id fields) so a second
 * gateway (Stripe, Razorpay, …) can be added without a data migration. The raw
 * Dodo payload shape lives in `DodoWebhookData`; everything we persist is neutral.
 *
 * Collections:
 *   Settings/dodo-payments  → single config document (secrets masked on read in the UI layer)
 *   Products                → mirror of gateway products + tiering/entitlement metadata
 *   Transactions            → normalized payment records (admin UI + user history)
 *   WebhookEvents           → raw, verbatim webhook payloads (forensics + idempotency)
 */

/** Payment gateways the schema is prepared for. Only 'dodo' is active today. */
export type PaymentProvider = 'dodo' | 'stripe' | 'razorpay';

/** The single active provider. Centralised so records are tagged consistently. */
export const PAYMENT_PROVIDER: PaymentProvider = 'dodo';

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
  /** Display-only effective price for this tier (in major units), e.g. 15 for $15/mo. */
  price?: number;
}

/** Firestore Products document (the fields the backend relies on). */
export interface ProductDoc {
  id?: string;
  name: string;
  description?: string;
  features?: string[];
  active: boolean;
  /**
   * Gateway product id per provider, e.g. { dodo: 'prod_123' }. A product can map
   * to a different id in each gateway. Use {@link providerProductId} to resolve.
   */
  providerProductIds?: Partial<Record<PaymentProvider, string>>;
  type: 'one_time' | 'subscription';
  /** Display-only list price (major units) and ISO currency, e.g. 29 / 'USD'. */
  price?: number;
  currency?: string;
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
  /**
   * Prepaid credits granted per successful charge — once for a one-time purchase,
   * and again on each subscription renewal (a recurring allowance). 0/undefined =
   * not a credit product.
   */
  creditsGranted?: number;
  tiers: PricingTier[];
  /** Count of confirmed purchases — incremented once per successful payment. */
  purchaseCount: number;
}

/** Resolve a product's gateway product id for a provider (defaults to the active one). */
export function providerProductId(product: ProductDoc, provider: PaymentProvider = PAYMENT_PROVIDER): string | undefined {
  return product.providerProductIds?.[provider];
}

export type TransactionStatus = 'succeeded' | 'failed' | 'refunded' | 'pending';

/** Firestore Transactions document. */
export interface TransactionDoc {
  userId: string;
  userEmail: string;
  /** Which gateway processed this charge. */
  provider: PaymentProvider;
  providerPaymentId?: string;
  providerSubscriptionId?: string;
  productId: string;
  premiumType: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  type: 'one_time' | 'subscription';
  tierApplied?: string;
  /** Discount code applied at checkout — part of the grandfathering audit trail. */
  discountCode?: string;
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
  /** Which gateway delivered this event. */
  provider: PaymentProvider;
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
  /** Which gateway granted the current entitlement. */
  provider?: PaymentProvider;
  providerSubscriptionId: string | null;
  providerCustomerId: string | null;
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
  /**
   * Grandfathering audit trail — the deal the user locked in at purchase. Lets
   * support answer "what price/tier was I promised?" even if the Dodo discount
   * code is later changed or removed.
   */
  premiumTierLabel?: string | null;
  premiumDiscountCode?: string | null;
}

/** Why a credit ledger entry was written. */
export type CreditLedgerReason = 'purchase' | 'renewal' | 'refund' | 'consume' | 'adjustment';

/**
 * Append-only prepaid-credit ledger entry. The user's `creditBalance` is the
 * running sum of these deltas, so the balance is always auditable / rebuildable.
 */
export interface CreditLedgerDoc {
  userId: string;
  /** Signed change: positive = grant, negative = debit (already clamped so balance ≥ 0). */
  delta: number;
  reason: CreditLedgerReason;
  /** Balance immediately after this entry was applied. */
  balanceAfter: number;
  /** Gateway that drove a grant/refund entry; absent for in-app 'consume' entries. */
  provider?: PaymentProvider;
  productId?: string;
  providerPaymentId?: string;
  providerSubscriptionId?: string;
  note?: string;
  createdAt: Timestamp;
}

export const PAYMENT_EMAIL_TYPES = [
  'payment_succeeded_email',
  'payment_failed_email',
  'subscription_lifecycle_email',
  'trial_ending_email',
] as const;

export type PaymentEmailType = (typeof PAYMENT_EMAIL_TYPES)[number];
