# Premium Entitlement Contract — for the Downstream Client App

> **Audience:** AI agents and developers implementing **feature locking** in the
> client application that consumes ArcCMS data.
>
> **Division of responsibility:** ArcCMS (via the Dodo Payments integration)
> **records** whether a user is premium and which tier they hold. It does **not**
> enforce access. The **client app enforces** access by reading the fields below.
> This document is the contract between the two.

---

## 1. Source of truth

Entitlement lives on the Firestore **`users/{docId}`** document. The relevant
fields are written **only by Cloud Functions** (the payment webhook handler).
Firestore security rules forbid clients from setting them, so they are
trustworthy.

| Field | Type | Meaning |
|-------|------|---------|
| `isPro` | `boolean` | **Master gate.** `true` only while the user holds a paid entitlement. Absent/`false` ⇒ treat as a free user. |
| `premiumType` | `string` | The single active tier key, e.g. `"plus"`, `"gold"`, `"platinum"`. `null`/absent when not premium. |
| `premiumTierRank` | `number` | Internal rank used for "highest tier wins" (higher = more access). You may use it, but prefer your own mapping (§3) for clarity. |
| `premiumStatus` | `string` | One of `active`, `trialing`, `past_due`, `cancelled`, `expired`. Grant access only on `active` or `trialing`. |
| `premiumExpiresAt` | `timestamp` | End of the current paid period (or trial). Treat access as expired once `now` passes this, even if `isPro` is still `true` (it may be momentarily stale). |
| `dodoSubscriptionId` | `string` | The active Dodo subscription id (informational). |
| `dodoCustomerId` | `string` | The Dodo customer id (informational). |

A user holds **at most one active tier at a time**. A higher-tier purchase
replaces a lower one; cancellation/expiry clears `premiumType` and sets
`isPro: false`.

---

## 2. The canonical "is this feature unlocked?" rule

Copy this logic into the client. **Fail closed** — when in doubt, lock.

```ts
function isUnlocked(user, featureMinTierRank) {
  if (!user || user.isPro !== true) return false;

  const statusOk = user.premiumStatus === 'active' || user.premiumStatus === 'trialing';
  if (!statusOk) return false;

  // Even if isPro is stale, honor the expiry.
  if (user.premiumExpiresAt && Date.now() > toMillis(user.premiumExpiresAt)) return false;

  const rank = tierRank(user.premiumType); // from your own mapping (§3)
  return rank >= featureMinTierRank;
}
```

Notes:
- `toMillis()` converts a Firestore Timestamp to epoch milliseconds.
- Treat an **unknown** `premiumType` as the **lowest** tier (rank 0) — fail closed.
- If `premiumExpiresAt` is absent, do not infer "never expires" for a
  subscription; rely on `premiumStatus` flipping to `cancelled`/`expired`.

---

## 3. The tier → features mapping (owned by the client)

ArcCMS does not dictate what each tier unlocks — that is the client's policy.
Maintain a single mapping and derive everything from it:

```ts
const TIERS = {
  plus:     { rank: 1, features: ['remove_ads', 'export_csv'] },
  gold:     { rank: 2, features: ['remove_ads', 'export_csv', 'api_access'] },
  platinum: { rank: 3, features: ['remove_ads', 'export_csv', 'api_access', 'priority_support'] },
};

function tierRank(premiumType) {
  return TIERS[premiumType]?.rank ?? 0; // unknown ⇒ lowest, fail closed
}
```

Worked example — a user with `premiumType: "gold"`, `premiumStatus: "active"`:
- `api_access` requires rank ≥ 2 (gold) → **unlocked**.
- `priority_support` requires rank ≥ 3 (platinum) → **locked**.

> **Important:** keep this mapping in sync with the `premiumType` values and
> `tierRank` numbers configured on Products in ArcCMS (Admin → Products). The
> string values are the contract; agree on them with whoever configures products.

---

## 4. How to read the entitlement

**Recommended:** read the user's own `users/{docId}` document with the Firestore
client SDK and react to changes (`onSnapshot`) so access updates live when a
webhook lands.

```ts
import { doc, onSnapshot } from 'firebase/firestore';

// docId is the user's ArcCMS user document id (the same doc where `uid` === auth uid)
onSnapshot(doc(db, 'users', userDocId), (snap) => {
  const user = snap.data();
  applyEntitlement(user); // recompute unlocked features
});
```

If you only have the Firebase Auth `uid`, query
`users where uid == <uid> limit 1` to find the document.

**Optional future enhancement (NOT in v1):** mirroring `isPro`/`premiumType`
into Firebase Auth **custom claims** so they're available in the ID token
without a Firestore read. ArcCMS does **not** set these claims today — do not
rely on token claims for entitlement.

---

## 5. Hard rules & gotchas

1. **Never trust the checkout return URL.** Dodo redirects back with query
   params (`payment_id`, `status`, …) — these are **not** proof of entitlement.
   Access is authoritative only after the webhook has written the user fields.
2. **Allow for propagation delay.** Right after checkout the webhook may take a
   few seconds. Show a "finalizing your purchase" state and let the `onSnapshot`
   listener flip the UI when fields update.
3. **Fail closed.** Missing/unknown fields, unparseable timestamps, or unknown
   `premiumType` ⇒ treat as **not** entitled.
4. **Never let the client write these fields.** Firestore rules block it; don't
   build flows that attempt to (e.g. optimistic local "unlock").
5. **Handle revocation immediately.** On `cancelled`/`expired` (or a refund) the
   fields are cleared/flipped — re-lock as soon as the snapshot updates.
6. **Respect `premiumExpiresAt` over `isPro`.** If the period has lapsed, lock
   even if `isPro` hasn't been flipped yet.

---

## 6. Field examples

**Active subscriber (gold):**
```json
{
  "isPro": true,
  "premiumType": "gold",
  "premiumTierRank": 2,
  "premiumStatus": "active",
  "premiumExpiresAt": "2026-07-01T00:00:00Z",
  "dodoSubscriptionId": "sub_abc123",
  "dodoCustomerId": "cus_xyz789"
}
```

**Trialing user (platinum):**
```json
{
  "isPro": true,
  "premiumType": "platinum",
  "premiumTierRank": 3,
  "premiumStatus": "trialing",
  "premiumExpiresAt": "2026-06-12T00:00:00Z"
}
```

**Cancelled / expired user (no access):**
```json
{
  "isPro": false,
  "premiumType": null,
  "premiumTierRank": null,
  "premiumStatus": "cancelled"
}
```
