# TODO / Backlog

Running list of things to improve. Nothing here is built yet — these are notes to pick up later.

## User onboarding & signup verification

### 1. Improve the user onboarding flow
The current new-user signup is demo-grade and needs a proper design pass. Make the
first-run / signup / post-signup experience coherent (where a user lands, what they
see first, guidance for new users).

### 2. Decide what to do when email/SMS is NOT configured
Today signup does **not** use email at all — verification is faked:
- `sendOtp()` generates a 6-digit code **in the browser** (`Math.random()`) and shows a
  "code sent to your email" toast, but **nothing is actually sent**
  (`src/app/pages/(auth)/(signup)/signup.page.ts` → `sendOtp`, `verifyOtp`).
- `verifyOtp()` accepts the client-generated code **or the hardcoded `123456`**.
- The account is created with `emailVerified: true` hardcoded — no real ownership check.

So email/SMS configuration is currently irrelevant to signup, and the "OTP" is
universally bypassable. We need a real answer for the no-email/no-SMS case, e.g.:
- Gracefully skip verification (and mark `emailVerified: false`) when no channel is configured, **or**
- Block signup / show a clear "verification unavailable" state, **or**
- Fall back to admin approval.
Decide the intended behaviour and remove the `123456` bypass for production.

### 3. Easy-to-use toggle: verify email at signup or not
Add a simple, admin-facing setting that chooses whether email verification is
required at signup:
- A single switch (e.g. in Settings) — "Require email verification on signup".
- When ON **and** an email provider is configured → send a real code/link via the
  configured provider, verify server-side, set `emailVerified` only after confirmation.
- When OFF (or no provider configured) → skip verification per the decision in (2).
- Should degrade sensibly: the toggle + the "no channel configured" handling from (2)
  must work together (don't require verification you can't perform).

**Related:** real signup email verification is genuine email work — natural to bundle
with the deferred payments/lifecycle **email task** (see the Dodo payments phase plan).

---

_Reference: signup flow lives in `src/app/pages/(auth)/(signup)/signup.page.ts`; auth
state in `src/app/pages/(auth)/auth.store.ts`._
