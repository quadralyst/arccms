# Merchant payments (F43)

Online payments on a merchant's own provider account. How it works and how to use it: `docs/app/merchant-payments.html`. This paper holds what was decided and what is still open.

## Decided with Gunjan (2026-11-05)

| | Decision |
|---|---|
| Keys | Firestore, `MerchantAccountKeys`, closed to every browser like `AiKeys`. All access is in `functions/src/merchant-payments/store.ts`, so moving to Secret Manager changes that file. |
| Feature | `merchant-payments`, off unless an app turns it on, because of the sweep every 2 minutes. |
| Unproven connectors | Gunjan supplies real keys and verifies in Arc with `npm run payments:proof`. `proven` stays false, and no merchant can pick a connector, until that passes. |
| What counts as paid | Strict: Connect `CAPTURED`, `PAID`, `COMPLETED`; Payrexx `confirmed`. `CAPTURE_REQUESTED` and any authorisation are not paid. |

## Assumptions, easy to change

- Payrexx through plain fetch, not the `payrexx` npm package (third party, last changed 2022, axios 0.21 and `request`). Connect through Worldline's `connect-sdk-nodejs` 8.3.3, pinned, not the 5.7.0 the brief read.
- The webhook address holds a random public id, one per account, kept when keys are replaced.
- `ARC_PAYMENTS_TRY` in a project's env file puts an unproven connector on trial; `ARC_PAYMENTS_PRETEND=on` allows the pretend provider beyond the emulator and tests.
- Connect's MyCheckout subdomain and country are required account fields with no default: the docs name no default subdomain.
- A connector's page domain: Connect `.worldline-solutions.com`, Payrexx exactly `<instance>.payrexx.com`.
- A paid result after a cancelled one is a second result with `late: true`; the app decides what to do with it. A person settles a held payment with `resolveHeldPayment`.
- Webhook switched off: no call found on either provider, so 3 finishes in a row with no event raise `webhook-silent`.
- A payment under way at its page's close is read on for 3 days (`UNFINISHED_LIMIT_MS`), then held for a person.
- Worldline's API key end date is typed by the merchant, as no call gives it.
- Connect's `merchantCustomerId` is the first 15 characters of the payment id, not a fixed word: a real run was refused with a 400 without it, and a fixed word would make all buyers one customer to fraud screening. Its effect on fraud screening is still to be seen.
- Only the World cluster of Connect; the India hosts are not offered.

## Still open, outside this repo

Is Connect what new merchants will sign? Do Connect and Payrexx take CHF and TWINT on the hosted page? Who holds Worldline's pre-production account?

## What only a real account can prove

The list is in `docs/app/merchant-payments.html#proof`. When a connector passes: set its `proven: true`, write the results into that page's "What counts as paid", and change the tables if the proof says so.
