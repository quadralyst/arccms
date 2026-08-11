# TODO / Backlog

Running list of things to improve. Nothing here is built yet — these are notes to pick up later.

> **✉️ EMAIL:** all email & notification work is specced and tracked **exclusively** in
> [`docs/email-system-spec.md`](email-system-spec.md) — the single source of truth.
> No email tasks live in this file. (The former "EMAIL — one dedicated task" section,
> items E1–E7, was absorbed into the spec: E1–E4 → Phase 2, E5 → Phases 1 & 8,
> E6 → Phase 1, E2 → Phase 2; E7/SMS remains an explicit non-goal.)

## User onboarding & signup

### 1. Improve the user onboarding flow
The current new-user signup is demo-grade and needs a proper design pass. Make the
first-run / signup / post-signup experience coherent (where a user lands, what they
see first, guidance for new users).

### 2. Signup email verification — moved to the email spec
All signup-verification work (real email-OTP delivery, the "require email verification
on signup" toggle, degrade-when-email-not-configured rules) is owned by
`docs/email-system-spec.md` (Phase 2; kill-switch rules in Phases 1 & 8).

**Current behavior (status, not a task):** signup skips the OTP step when email is
disabled and creates the account with `emailVerified: false`. The hardcoded `123456`
bypass was removed and the OTP sender is still a client-side stub — so **enabling email
in settings before spec Phase 2 ships will block new signups at the OTP step.** Email is
currently disabled, so signups work.

---

_Reference: signup flow `src/app/pages/(auth)/(signup)/signup.page.ts`; auth store
`src/app/pages/(auth)/auth.store.ts`._
