# Test Instructions — `feat/dodo-payments-phases`

> Filename uses the branch name with `/` replaced by `-` (filesystems can't contain `/`).
> This file is intentionally **uncommitted** — it's a working scratchpad for manual QA.

Target environment: **a real test Firebase project** (no emulator).

---

## What Phase 1 changed (what you're verifying)

Phase 1 is **correctness fixes** to the webhook processing pipeline. Nothing in the
UI changed. All four fixes live in the Firestore-trigger that processes webhook
events (`WebhookEvents` doc created → `handlePaymentEvent` runs).

| # | Fix | Symptom it prevents |
|---|-----|---------------------|
| 1 | Subscription-only events are idempotent (dedup on `idempotencyKey`, not just `payment_id`) | Redelivered `subscription.active`/`renewed` creating duplicate `Transactions` |
| 2 | `purchaseCount` increments **once per buyer** (atomic `CountedBuyers/{key}` marker) | Renewals / recurring charges inflating the buyer counter → wrong pricing tier for the next buyer |
| 3 | Out-of-order guard (`premiumEventAt`) | A delayed `subscription.active` resurrecting access after a `cancelled` |
| 4 | `markPastDue` is scoped to the active subscription | A failure on an *old* subscription knocking out a user's *current* one |

---

## 0. Prerequisites & deploy

```bash
# point the CLI at your TEST project (never prod)
firebase use <your-test-project-id>

# build + deploy just the functions (this is where all Phase 1 changes are)
cd functions && npm run build && cd ..
firebase deploy --only functions

# (optional, only if not already deployed on the test project)
firebase deploy --only firestore:rules,firestore:indexes
```

Confirm these functions show as deployed in the Firebase console → Functions:
`handlePaymentEvent`, `dodoWebhook`, `createCheckoutSession`, `scanTrialEndings`.

---

## 1. Seed baseline test data

Create these in **Firestore console → Start collection / Add document**.

### `users/testUser1`
```
uid:            "testUser1"      (string)  ← findUserRef matches on this
email:          "qa@example.com" (string)
isPro:          false            (boolean)
```

### `Products/prodSub1`  (a subscription product)
```
name:           "QA Monthly"     (string)
active:         true             (boolean)
dodoProductId:  "dodo_test_123"  (string)
type:           "subscription"   (string)
premiumType:    "gold"           (string)
tierRank:       2                (number)
interval:       "month"          (string)
trialDays:      0                (number)
purchaseCount:  0                (number)
tiers:          []               (array — empty is fine for Phase 1)
```

> Phase 1 does **not** touch tier resolution or checkout — a bare product is enough.
> Keep `purchaseCount` visible; you'll watch it change.

---

## 2. Three ways to test

- **Approach A (most precise for Phase 1):** inject `WebhookEvents` documents
  directly. Drives `handlePaymentEvent` end-to-end without needing Dodo, and lets
  you craft the exact edge cases (renewals, out-of-order, cross-subscription
  failures) that are otherwise hard to reproduce.
- **Approach B:** full Dodo **test-mode** checkout, for confirming the real webhook
  wiring (signature, endpoint URL) works.
- **Approach C (self-contained UI):** the buyer journey through ArcCMS's own new
  public screens (`/pricing` → `/checkout/success` → `/account`). Best for a
  human-visible end-to-end demo.

Use **Approach A** to validate the Phase 1 logic precisely; use **C** for a
self-contained end-to-end walkthrough; **B** is subsumed by C (C uses the same
real Dodo checkout).

---

## Approach A — Inject `WebhookEvents` documents

The trigger fires on **document creation** in `WebhookEvents`. Each injected doc
only needs a `rawPayload` map; the handler ignores the rest.

### Easiest method: a tiny admin script

Create `scripts/inject-webhook.js` (this file can stay uncommitted too):

```js
// Usage: GOOGLE_APPLICATION_CREDENTIALS=./sa.json node scripts/inject-webhook.js <id> <path-to-payload.json>
const admin = require('firebase-admin');
const fs = require('fs');
admin.initializeApp(); // uses GOOGLE_APPLICATION_CREDENTIALS + project from that key
const db = admin.firestore();

(async () => {
  const [, , id, file] = process.argv;
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  await db.collection('WebhookEvents').doc(id).set({
    rawPayload: payload,
    eventType: payload.type,
    signatureValid: true,
    processed: false,
    receivedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  console.log('Injected WebhookEvents/' + id, '(type:', payload.type + ')');
  process.exit(0);
})();
```

Get a service-account key from Firebase console → Project settings → Service
accounts → Generate new private key, save as `scripts/sa.json` (do **not** commit).

> **Alternative (no script):** you can add each doc by hand in the Firestore
> console. `rawPayload` is a **map**, and `rawPayload.data` is a nested **map**.
> The script is far less error-prone for the nested payloads below.

Each test below gives you a payload JSON file and the expected result. **Important:**
because the whole point is idempotency, re-running a test needs either a **new doc
id** *and* fresh identifiers, or a reset (see [Resetting](#5-resetting-between-runs)).

---

### Test A1 — First subscription activation: counts once + grants access

`payload-A1.json`
```json
{
  "type": "subscription.active",
  "timestamp": "2026-07-10T10:00:00.000Z",
  "data": {
    "subscription_id": "sub_QA1",
    "payment_id": "pay_QA1",
    "total_amount": 4999,
    "currency": "USD",
    "next_billing_date": "2026-08-10T10:00:00.000Z",
    "status": "active",
    "customer": { "customer_id": "cus_QA1", "email": "qa@example.com", "name": "QA User" },
    "metadata": { "userId": "testUser1", "productId": "prodSub1", "premiumType": "gold", "tierRank": "2", "tierLabel": "Early bird" }
  }
}
```
Run: `node scripts/inject-webhook.js a1 payload-A1.json`

**Expect:**
- `Products/prodSub1.purchaseCount` → **1**
- New `Transactions` doc: `status: "succeeded"`, `amount: 49.99`, `idempotencyKey: "pay:pay_QA1"`, `tierApplied: "Early bird"`
- `users/testUser1`: `isPro: true`, `premiumType: "gold"`, `premiumTierRank: 2`, `premiumStatus: "active"`, `dodoSubscriptionId: "sub_QA1"`, `premiumEventAt` ≈ 2026-07-10T10:00
- `CountedBuyers/sub:sub_QA1` doc now exists
- `WebhookEvents/a1.processed` → true

---

### Test A2 — Renewal does NOT inflate the counter  ⭐ core fix

After A1, inject a renewal (new payment id, same subscription):

`payload-A2.json`
```json
{
  "type": "subscription.renewed",
  "timestamp": "2026-08-10T10:00:00.000Z",
  "data": {
    "subscription_id": "sub_QA1",
    "payment_id": "pay_QA1_renew1",
    "total_amount": 4999,
    "currency": "USD",
    "next_billing_date": "2026-09-10T10:00:00.000Z",
    "status": "active",
    "customer": { "customer_id": "cus_QA1", "email": "qa@example.com" },
    "metadata": { "userId": "testUser1", "productId": "prodSub1", "premiumType": "gold" }
  }
}
```
Run: `node scripts/inject-webhook.js a2 payload-A2.json`

**Expect:**
- `purchaseCount` stays **1** (no new buyer)
- A new `Transactions` doc IS recorded (`idempotencyKey: "pay:pay_QA1_renew1"`)
- `users/testUser1.premiumExpiresAt` moves forward to 2026-09-10

---

### Test A3 — Recurring `payment.succeeded` carrying a subscription id does NOT count  ⭐ core fix

Some gateways emit renewals as `payment.succeeded` with a `subscription_id`. This
must not add a buyer.

`payload-A3.json`
```json
{
  "type": "payment.succeeded",
  "timestamp": "2026-09-10T10:00:00.000Z",
  "data": {
    "subscription_id": "sub_QA1",
    "payment_id": "pay_QA1_renew2",
    "total_amount": 4999,
    "currency": "USD",
    "customer": { "email": "qa@example.com" },
    "metadata": { "userId": "testUser1", "productId": "prodSub1", "premiumType": "gold" }
  }
}
```
Run: `node scripts/inject-webhook.js a3 payload-A3.json`

**Expect:** `purchaseCount` stays **1**; transaction still recorded; no
`CountedBuyers/pay:pay_QA1_renew2` doc is created.

---

### Test A4 — Duplicate delivery is idempotent

Re-deliver the **same** activation event under a different doc id:

Run: `node scripts/inject-webhook.js a4 payload-A1.json`  (reuses A1's payload)

**Expect:**
- **No** new `Transactions` doc (dedup on `idempotencyKey: "pay:pay_QA1"`)
- `purchaseCount` stays **1** (`CountedBuyers/sub:sub_QA1` already exists)
- `WebhookEvents/a4.processed` → true (processed, but a no-op)

---

### Test A5 — Out-of-order events don't resurrect access  ⭐ core fix

Cancel first (later timestamp), then deliver a **stale** `active` (earlier timestamp).

`payload-A5-cancel.json`
```json
{
  "type": "subscription.cancelled",
  "timestamp": "2026-09-15T12:00:00.000Z",
  "data": {
    "subscription_id": "sub_QA1",
    "customer": { "email": "qa@example.com" },
    "metadata": { "userId": "testUser1", "productId": "prodSub1" }
  }
}
```
`payload-A5-late-active.json`
```json
{
  "type": "subscription.active",
  "timestamp": "2026-09-15T11:59:00.000Z",
  "data": {
    "subscription_id": "sub_QA1",
    "payment_id": "pay_QA1_late",
    "status": "active",
    "next_billing_date": "2026-10-15T12:00:00.000Z",
    "customer": { "email": "qa@example.com" },
    "metadata": { "userId": "testUser1", "productId": "prodSub1", "premiumType": "gold", "tierRank": "2" }
  }
}
```
Run:
```bash
node scripts/inject-webhook.js a5a payload-A5-cancel.json      # cancel wins
node scripts/inject-webhook.js a5b payload-A5-late-active.json # arrives late, older ts
```

**Expect after both:** `users/testUser1` stays revoked — `isPro: false`,
`premiumStatus: "cancelled"`. The late activation is discarded because its
timestamp precedes the stored `premiumEventAt`. (A transaction row may still be
written for the late event — that's fine; only the *entitlement* is guarded.)

---

### Test A6 — A failure on a different subscription doesn't touch the active one  ⭐ core fix

Reset the user to an active subscription first (re-run A1 with fresh ids, or set
`users/testUser1` to `isPro: true`, `premiumStatus: "active"`,
`dodoSubscriptionId: "sub_QA1"`, and clear `premiumEventAt`). Then deliver a
failure for a **different** subscription:

`payload-A6.json`
```json
{
  "type": "subscription.failed",
  "timestamp": "2026-09-20T09:00:00.000Z",
  "data": {
    "subscription_id": "sub_OTHER",
    "payment_id": "pay_other_fail",
    "customer": { "email": "qa@example.com" },
    "metadata": { "userId": "testUser1", "productId": "prodSub1" }
  }
}
```
Run: `node scripts/inject-webhook.js a6 payload-A6.json`

**Expect:** `users/testUser1.premiumStatus` stays **`active`** (the failure was for
`sub_OTHER`, not the user's active `sub_QA1`). A failed transaction is still recorded.

> Sanity counter-check: send the same payload but with `subscription_id: "sub_QA1"`
> → `premiumStatus` should flip to `past_due`.

---

### Reading the logs

For any test, watch the function logs:
```bash
firebase functions:log --only handlePaymentEvent
```
You'll see the guard decisions, e.g. `Skipping entitlement grant — stale (out-of-order) event`,
`Buyer sub:sub_QA1 already counted …`, `Skipping past-due — different active subscription`.

---

## Approach B — Full Dodo test-mode checkout (wiring confidence)

Do this once to confirm the live webhook path works end-to-end.

1. **Configure settings** — admin UI → Settings → Payments, or the
   `Settings/dodo-payments` doc directly:
   - `enabled: true`, `mode: "test"`
   - `testApiKey`: your Dodo **test** API key
   - `webhookSecret`: the signing secret from the Dodo webhook you'll create in step 3
   - `successUrl` / `cancelUrl`: any page on your test site
2. **Point the product at a real Dodo test product** — set `Products/prodSub1.dodoProductId`
   to a product id that exists in your Dodo **test** dashboard.
3. **Register the webhook in Dodo** (test mode) → URL is the deployed function:
   `https://<region>-<project>.cloudfunctions.net/dodoWebhook`
   (find the exact URL in Firebase console → Functions → `dodoWebhook`).
   Copy its signing secret back into `webhookSecret` (step 1).
4. **Run a checkout** — sign in on your test site, go to `/pricing`, click Buy. You'll
   be redirected to Dodo's hosted checkout.
5. **Pay with a Dodo test card** (from Dodo's docs, e.g. a `4242…` style test card).
6. **Verify** the same end state as Test A1: a `WebhookEvents` doc appears
   (`signatureValid: true`), a `Transactions` row is written, `purchaseCount`
   increments once, and your user gets `isPro: true`.
7. **Negative check:** if signature verification fails you'll get HTTP 401 at the
   endpoint and no `WebhookEvents` doc — that means `webhookSecret` is wrong.

---

## Approach C — End-to-end via ArcCMS's own public screens (self-contained) ⭐

The branch adds public test screens **inside ArcCMS**, so you can run the whole
buyer journey without any external client. New routes:

| Route | Purpose |
|-------|---------|
| `/pricing` | Lists active products; a signed-in user clicks Subscribe/Buy → Dodo checkout (already existed; the buyer-gate bug is now fixed). |
| `/checkout/success` | Dodo `return_url` landing. Polls the user doc (~45s) until the webhook grants `isPro`, then confirms. |
| `/checkout/cancel` | Dodo `cancel_url` landing. |
| `/account` | The signed-in user's entitlement (isPro, tier, status, expiry, updates-until) **and** their transaction history. Primary verification surface. |

A lightweight nav (ArcCMS · Pricing · My Account · Sign in/out) links them.

### C.0 One-time wiring
1. **Point the return URLs at the new screens** — admin UI → Settings → Payments (or the
   `Settings/dodo-payments` doc). Use **absolute** URLs for your environment:
   - `successUrl` → `https://<your-host>/checkout/success` (dev: `http://localhost:5173/checkout/success`)
   - `cancelUrl`  → `https://<your-host>/checkout/cancel`
2. **Enable payments** and set `mode: test` + your Dodo **test** API key + `webhookSecret`
   (same as Approach B step 1).
3. **Register the Dodo webhook** at your deployed `dodoWebhook` function URL (Approach B step 3).
4. **Have at least one active Product** whose `dodoProductId` points at a Dodo **test** product
   (reuse `Products/prodSub1`, but it must be a real Dodo test product for checkout to open).

### C.1 Create a regular (non-admin) test buyer
- Open `/signup` and register a new account (role defaults to `user`).
- Note: the app's `isAuthenticated` signal is `false` for plain `user` accounts; the pricing
  page's buy gate was changed to key off the actual signed-in user, so a regular user can now
  purchase. If a buyer is bounced to `/signup`, they simply aren't signed in.

### C.2 Run the journey
1. Sign in as the buyer → go to **`/pricing`** → click **Subscribe/Buy** on a plan.
2. You're redirected to **Dodo hosted checkout** (test mode). Pay with a Dodo **test card**.
3. Dodo redirects back to **`/checkout/success`**. It shows "Confirming your payment…", polls,
   and flips to **"You're all set!"** once the webhook grants the entitlement (usually a few seconds).
   - If it times out, click **Check again**, or open `/account` — the grant may just be slow.
4. Open **`/account`** and verify:
   - **Status** chip shows `PRO · <premiumType>` and the lifecycle status (`active`/`trialing`).
   - **Renews / expires** matches Dodo's next billing date; **Free updates until** appears once
     Phase 2 lands (blank for now).
   - **Transaction history** lists the payment (amount, plan, `succeeded`, event type).
5. **Cancel-path check:** start another checkout and abandon it → you land on `/checkout/cancel`.

### C.3 Verifying the Phase 1 fixes through the UI
The injected-event tests (Approach A) are still the precise way to exercise the Phase 1 edge
cases, but you can spot-check a couple from the UI/data:
- After the first successful subscription, `Products/<id>.purchaseCount` = 1 and `/account` shows Pro.
- Trigger a renewal (Dodo test renewal, or inject `subscription.renewed` per Approach A2): `/account`
  gains a new transaction row and the expiry moves forward, but `purchaseCount` stays 1.
- Inject an out-of-order `cancelled` then late `active` (Approach A5): `/account` stays non-Pro.

### C.4 Local dev vs deployed
- **Deployed hosting** (recommended): `firebase deploy --only functions,hosting` and use your
  hosting domain in the URLs above — Dodo can redirect to it and the webhook can reach the function.
- **Local `npm run dev` (port 5173):** the screens work locally, but Dodo can't redirect a real
  browser to `localhost` unless you're on the same machine, and Dodo's webhook can't reach
  `localhost` — so for a true end-to-end run, deploy, or use a tunnel (e.g. ngrok) for the webhook
  and a localhost `successUrl`. For pure UI checks (screens render, `/account` reads state), local
  dev + Approach-A injected events is enough.

---

## Phase 2 — Entitlement dates & enforcement

Phase 2 adds two things: a **free-updates window** for one-time "lifetime" products,
and a **daily safety net** that force-expires subscriptions whose renewal webhook
never arrived.

### What changed
| Area | Change |
|------|--------|
| Product | New `updatesYears` field (admin Products form, shown for **one-time** products). Access stays lifetime; this only sizes the updates window. |
| Entitlement | On a one-time purchase, `grantEntitlement` sets `users/{id}.updatesUntil = purchaseDate + updatesYears` (set once — never slid on re-delivery). Subscriptions are unaffected. |
| New function | `scanExpiredEntitlements` (scheduled, daily 08:00 UTC) force-expires any subscription whose `premiumExpiresAt` is older than **now − 3 days** (grace). Lifetime one-time grants (no `dodoSubscriptionId`, no `premiumExpiresAt`) are never touched. Reuses the existing `premiumStatus + premiumExpiresAt` index. |
| UI | `/account` shows "Free updates until"; `/pricing` shows "One-time · lifetime access · N years of free updates" for one-time products. |

### P2.1 — One-time free-updates window
1. In admin → Products, create a **one-time** product (`type: one_time`), set **Free-updates years** = e.g. `2`, and point `dodoProductId` at a Dodo test product.
2. Buy it (Approach C via `/pricing`, or inject a `payment.succeeded` per Approach A with **no** `subscription_id` and `metadata.productId` = the one-time product).
   - Injected payload note: include a `timestamp` — `updatesUntil` is computed from it (falls back to "now" if absent).
3. Verify on `/account` (and in `users/{uid}`):
   - `isPro: true`, `premiumStatus: active`, **`premiumExpiresAt` empty** (lifetime), **`updatesUntil` = purchase date + 2 years**.
   - Re-deliver the same event → `updatesUntil` does **not** move (set-once).

### P2.2 — Expiry safety net (`scanExpiredEntitlements`)
Simulate a subscription whose cancellation webhook was missed:
1. Take a user with an **active subscription** entitlement (`isPro: true`, `premiumStatus: active`, `dodoSubscriptionId: sub_X`).
2. In Firestore, set their `premiumExpiresAt` to a date **more than 3 days in the past**.
3. Trigger the scan. In the Firebase console → Functions, run **`scanExpiredEntitlements`** manually (or `gcloud scheduler jobs run <job>`; or temporarily lower `GRACE_DAYS` / the schedule and redeploy for a live tick).
4. Verify: the user becomes `isPro: false`, `premiumStatus: expired`, `premiumType`/`premiumTierRank` cleared.
5. **Negative check:** a **one-time lifetime** user (has `updatesUntil`, `premiumExpiresAt` empty, **no** `dodoSubscriptionId`) is left **untouched** even if you give them a stale date — they have no subscription id, so the sweep skips them.

> The unit tests already cover both behaviours: `dodoEntitlements.spec.ts`
> (updatesUntil set-once, subscriptions excluded) and
> `dodoScanExpiredEntitlements.spec.ts` (subscription expired, lifetime skipped).

---

## 5. Resetting between runs

Because the fixes are idempotent, a clean re-run needs fresh state:

- Delete the `CountedBuyers` docs you created (e.g. `sub:sub_QA1`, `pay:pay_QA1`).
- Delete the `Transactions` docs from the run (or use new `payment_id`s next time).
- Reset `Products/prodSub1.purchaseCount` to `0`.
- Reset `users/testUser1` to `{ isPro: false }` and **delete** its `premiumEventAt`,
  `premiumStatus`, `dodoSubscriptionId` fields (stale `premiumEventAt` will make new
  events look out-of-order).
- Always inject under a **new** `WebhookEvents` doc id — the trigger only fires on create.

A quick reset helper (optional): `scripts/reset.js`
```js
const admin = require('firebase-admin');
admin.initializeApp();
const db = admin.firestore();
(async () => {
  await db.doc('Products/prodSub1').update({ purchaseCount: 0 });
  await db.doc('users/testUser1').set({ isPro: false }, { merge: true });
  await db.doc('users/testUser1').update({
    premiumEventAt: admin.firestore.FieldValue.delete(),
    premiumStatus: admin.firestore.FieldValue.delete(),
    dodoSubscriptionId: admin.firestore.FieldValue.delete(),
    premiumType: admin.firestore.FieldValue.delete(),
    premiumTierRank: admin.firestore.FieldValue.delete(),
  });
  for (const c of ['CountedBuyers', 'Transactions']) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
  console.log('reset done');
  process.exit(0);
})();
```

---

## 6. Pass criteria checklist

- [ ] A1: activation counts once, grants access, `CountedBuyers/sub:sub_QA1` created
- [ ] A2: renewal recorded, `purchaseCount` unchanged, expiry moves forward
- [ ] A3: recurring `payment.succeeded` with sub id does **not** count
- [ ] A4: duplicate delivery creates no new transaction and no extra count
- [ ] A5: late `active` after `cancelled` does **not** restore `isPro`
- [ ] A6: failure on a different subscription leaves active status untouched (and same-sub failure → `past_due`)
- [ ] B (optional): real Dodo test-mode checkout produces the A1 end state with `signatureValid: true`
- [ ] C: `/pricing` → checkout → `/checkout/success` confirms Pro → `/account` shows entitlement + transaction (self-contained UI)
- [ ] P2.1: one-time purchase sets `updatesUntil` = purchase + N years, keeps lifetime access, set-once on re-delivery
- [ ] P2.2: `scanExpiredEntitlements` force-expires a stale subscription but leaves lifetime one-time grants untouched

---

## Notes / gotchas

- **Region in the webhook URL** — match your functions region (check the console).
- **`findUserRef` matching** — it looks up `users` where `uid == metadata.userId`,
  falling back to `email`. Your seed user's `uid` field must equal the payload's
  `metadata.userId` (`"testUser1"`).
- **Amounts are in minor units** — `total_amount: 4999` → `$49.99` in the transaction.
- **Unrelated pre-existing test failure:** `src/app/pages/admin/(settings)/settings.page.spec.ts`
  fails on `dev` already (a settings-route ordering assertion) — not from this branch.
- **Next phase (2):** `updatesUntil` for the "lifetime access + free updates for X
  years" model, plus a daily entitlement-expiry sweep as a safety net for missed webhooks.
```
