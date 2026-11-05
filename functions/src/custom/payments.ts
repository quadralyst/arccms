/**
 * What the app does when a merchant's payment finishes (docs/app/merchant-payments.html).
 * Arc CMS ships this empty and never edits it again.
 *
 * `onResult` hears each paid, failed or cancelled result, and `onAlert` hears what someone
 * should be told: a key ending or refused, a webhook gone silent, a payment held for a
 * person. Never imported by the webhook, so its answer stays quick whatever this file loads.
 */
import type { PaymentHooks } from '../app-kit/index.js';

export const PAYMENT_HOOKS: PaymentHooks = {};
