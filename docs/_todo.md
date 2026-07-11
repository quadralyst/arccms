# TODO / Backlog

Running list of things to improve. Nothing here is built yet — these are notes to pick up later.

## User onboarding & signup verification

### 1. Improve the user onboarding flow
The current new-user signup is demo-grade and needs a proper design pass. Make the
first-run / signup / post-signup experience coherent (where a user lands, what they
see first, guidance for new users).

### 2. What to do when email/SMS is NOT configured — PARTLY DONE
**Done:** signup now skips the OTP step when email is disabled and creates the account
with `emailVerified: false`. When email is enabled it shows the OTP step. Config source:
`EmailConfigStatusService.isEmailConfigured()` ← `Settings/email_status.isEnabled`.
The hardcoded `123456` bypass was removed; only the generated code is accepted.
(`src/app/pages/(auth)/(signup)/signup.page.ts` → `checkEmail`, `verifyOtp`, `register`.)

**⚠️ New coupling introduced by removing the bypass:** the "email enabled" OTP path is
still a **client-side stub** — `sendOtp()` generates a code but never actually emails it.
So with `123456` gone, **enabling email in settings will BLOCK new signups at the OTP
step** (there's no way to deliver/enter the real code). Currently email is disabled, so
the skip path runs and signups work. Before enabling email, item #3 below (real email-OTP
delivery) MUST be built.

Still to decide/build:
- Real email-OTP: a backend callable that generates a code, emails it via the configured
  provider, and verifies server-side (replaces the client-side stub). Part of the email task.
- Optional: SMS channel, or admin-approval fallback.

### 3. Easy-to-use toggle: verify email at signup or not
Add a simple, admin-facing setting that chooses whether email verification is
required at signup:
- A single switch (e.g. in Settings) — "Require email verification on signup".
- When ON **and** an email provider is configured → send a real code/link via the
  configured provider, verify server-side, set `emailVerified` only after confirmation.
- When OFF (or no provider configured) → skip verification per the decision in (2).
- Should degrade sensibly: the toggle + the "no channel configured" handling from (2)
  must work together (don't require verification you can't perform).

- [ ] Review that send email is configured correctly and when it is turned of, all email related activities get disabled.

**Related:** real signup email verification is genuine email work — natural to bundle
with the deferred payments/lifecycle **email task** (see the Dodo payments phase plan).

---

## EMAIL — one dedicated task (deferred throughout)

All email work has been intentionally deferred to a single dedicated task. This is the
consolidated scope. Nothing below is built/verified end-to-end unless noted.

### E1. Payment lifecycle emails (deferred from the Dodo payments phases 1–5)
Backend scaffolding exists but the whole email piece was skipped, never wired/tested end-to-end:
- Helper: `functions/src/dodo-payments/paymentEmailHelper.ts` (`sendPaymentEmail` → writes an `EmailLogs` doc).
- Types: `PAYMENT_EMAIL_TYPES` in `functions/src/dodo-payments/types.ts` = `payment_succeeded_email`, `payment_failed_email`, `subscription_lifecycle_email`, `trial_ending_email`.
- Templates: `EmailTemplate` docs with `scope: 'payments'`; frontend `PAYMENT_EMAIL_DEFINITIONS` + the payment-settings template editor UI.
- Senders already call it: `handlePaymentEvent.ts` (succeeded/failed/on_hold/cancelled/expired/refunded) and `scanTrialEndings.ts` (trial_ending_email).
- **To do:** confirm default templates exist + are seeded, the `EmailLogs → send` trigger actually delivers via the configured provider, tags (`##PAYMENT_AMOUNT##`, `##RENEWAL_DATE##`, `##TRIAL_ENDS_AT##`, …) render, BCC from `Settings/email` works, and test each event end-to-end.

### E2. "Free updates ending" reminder email (from payments Phase 2)
Not built. One-time "lifetime + free updates for N years" products set `users/{id}.updatesUntil`.
Add a scheduled scan (mirror `scanExpiredEntitlements`/`scanTrialEndings`) that emails users whose
`updatesUntil` is approaching, guarded by a "reminder sent" flag. Needs a new email type + template.

### E3. Real signup email-OTP delivery (replaces the client-side stub)
Today `sendOtp()` generates a code in the browser and never sends it; the `123456` bypass was removed.
Build a backend callable that generates a code, **emails it via the configured provider**, and verifies
server-side; set `emailVerified: true` only after real confirmation. Until this exists, **enabling email
blocks new signups at the OTP step** (see item #2 above). Files: `src/app/pages/(auth)/(signup)/signup.page.ts`.

### E4. "Require email verification on signup" toggle (= item #3 above)
Admin switch that, when ON + provider configured, forces real email-OTP (E3); when OFF or no provider,
skips verification. Must degrade sensibly with the "no channel configured" handling (item #2).

### E5. Email-disabled kill-switch audit (= the `[ ]` note above)
When email is turned off (`Settings/email_status.isEnabled = false` / no valid provider), **all**
email-sending paths must be disabled — audit every sender: waitlist confirmations, broadcasts,
payment lifecycle emails (E1), trial/updates reminders (E2), signup OTP (E3). Nothing should attempt
to send when email is off.

### E6. Apply the "can't enable without valid config" invariant to onboarding
The admin Email Settings page now blocks enabling email unless a valid provider is configured
(done). The onboarding flow still writes `Settings/email_status.isEnabled` directly
(`src/app/pages/(onboarding)/onboarding-setup.service.ts`) — apply the same guard there.

### E7. SMS channel (optional / future)
Todo notes mention email/SMS, but no SMS exists. Out of scope unless explicitly wanted; if added,
it becomes another channel the signup-verification + kill-switch logic must account for.

---

_Reference: signup flow `src/app/pages/(auth)/(signup)/signup.page.ts`; auth store
`src/app/pages/(auth)/auth.store.ts`; email config `src/shared/services/email-config-status.service.ts`
+ `src/app/pages/admin/(settings)/email-setting/`; payment emails `functions/src/dodo-payments/paymentEmailHelper.ts`._
