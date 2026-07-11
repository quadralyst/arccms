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

_Reference: signup flow lives in `src/app/pages/(auth)/(signup)/signup.page.ts`; auth
state in `src/app/pages/(auth)/auth.store.ts`._
