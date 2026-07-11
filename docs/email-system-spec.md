# ArcCMS Comprehensive Email & Notification System — Build Spec

**Status:** Approved for phased build (interview completed 2026-07-11)
**Branch context:** builds on `feat/dodo-payments-phases`.

> **This document is the single source of truth for all email & notification work.**
> The former `docs/_todo.md` "EMAIL — one dedicated task" items were absorbed here and
> removed from that file. E-numbers used below refer to those absorbed items:
> **E1** payment lifecycle emails · **E2** "free updates ending" reminder · **E3** real
> signup email-OTP delivery · **E4** "require email verification on signup" toggle ·
> **E5** email-disabled kill-switch audit · **E6** onboarding email-enable invariant ·
> **E7** SMS channel (explicit non-goal).

---

## 0. Decision log (from PM interview)

| # | Decision | Choice |
|---|----------|--------|
| D1 | Notifications scope | In-app notification center for users + admin→user announcements + system-event notifications |
| D2 | Notification → email trigger | Per-type admin config **and** per-user preference center |
| D3 | WYSIWYG editor | Block-based builder, open-source, in-house (JSON design → email-safe HTML). No Unlayer, no tiptap-only enhancement |
| D4 | Drip sophistication | **Linear sequences, scoped per list/campaign.** Removing a contact from a list exits them from that list's drips |
| D5 | Audience model | **Unified `Contacts` + `Lists`** (auto-synced from waitlists, signups, customers; CSV import) |
| D6 | Consent model | Category-based (transactional vs marketing) + global suppression list + one-click unsubscribe + preference page. Full-GDPR/double-opt-in deferred |
| D7 | Providers | Keep SMTP / Gmail / Resend as-is. No Secret Manager migration, no new providers (deferred) |
| D8 | Phase 1 focus | Foundations first (pipeline, kill-switch, unsubscribe), then transactional (payments/OTP), then features |
| D9 | Extra built-in emails | Welcome-on-signup ✔, admin alerts/digest ✔. Win-back ✘, security emails ✘ (deferred) |
| D10 | Broadcast v2 | Target Lists/segments ✔, schedule-for-later ✔. Campaign analytics ✘, A/B testing ✘ (deferred) |
| D11 | Extensibility | Generic **event bus** (`AppEvents` collection + admin-configurable event mappings) |
| D12 | Branding | Global **brand kit** (logo, colors, footer, socials set once); templates stay content-only |

### Explicit non-goals (deferred, do not build)
SMS channel (E7) · A/B subject testing · campaign analytics dashboard · win-back/inactivity drips · security emails (password-changed etc.) · Secret Manager migration · additional providers (SES/Mailgun/Postmark) · double opt-in / GDPR export hooks · visual journey builder.

---

## 1. Current state (baseline this spec builds on)

- **Send pipeline:** writing a doc to `EmailLogs` fires `onEmailLogCreate` (`functions/src/email-log/createEmailLog.ts`) → `sendMail()` (`functions/src/mail-config/mailConfig.ts`) → nodemailer (SMTP/Gmail) or Resend fetch. `sendMail` bails silently if `Settings/email.isEnabled !== true`.
- **Settings:** `Settings/email` (full config incl. plaintext creds), public mirror `Settings/email_status { isEnabled }`, admin UI at `src/app/pages/admin/(settings)/email-setting/`.
- **Templates:** Firestore `EmailTemplate` collection; `##TAG##` merge fields resolved by `processEmailTemplate` in `functions/src/utils/emailTemplateHelper.ts`; edited with tiptap via `src/shared/components/email-template-editor/`.
- **Waitlist emails:** OTP + welcome via triggers under `functions/src/waitlists/`; broadcast engine in `functions/src/email-log/processBroadcast.ts` + `continueBroadcast.ts` (chunked, rate-limited, resumable).
- **Payment emails (E1):** scaffolding in `functions/src/dodo-payments/paymentEmailHelper.ts`, called from `handlePaymentEvent.ts` and `scanTrialEndings.ts` — never verified end-to-end, default templates possibly unseeded.
- **Known defects to fix here:** unsubscribe link built with empty userId (`emailTemplateHelper.ts:189`); unsubscribe not checked at send time; rate limits/quota enforced only in broadcast path; no send retry; signup OTP is a client-side stub that never emails (`src/app/pages/(auth)/(signup)/signup.page.ts`); onboarding writes `email_status.isEnabled` without the valid-provider guard (E6).

---

## 2. Architecture overview

```
                        ┌────────────────────────────────────────────┐
  EMAIL SOURCES         │              EMAIL CORE (functions)         │
                        │                                            │
  waitlist triggers ──▶ │  queueEmail()  ── kill-switch check         │
  auth (OTP/welcome) ─▶ │      │         ── feature-toggle check      │
  payment events ─────▶ │      │         ── category/consent check    │
  notifications ──────▶ │      │         ── suppression check         │
  broadcasts ─────────▶ │      ▼                                     │
  drip scheduler ─────▶ │  EmailLogs doc ──▶ onEmailLogCreate         │
  AppEvents bus ──────▶ │                     └▶ sendMail()           │
                        │                         ├─ quota/rate limit │
                        │                         ├─ provider send    │
                        │                         └─ retry scan (5m)  │
                        └────────────────────────────────────────────┘
```

**Core rules (apply everywhere, every phase):**

1. **Master kill-switch.** `Settings/email.isEnabled === false` (or missing/invalid provider) ⇒ **no email is ever sent, by any feature**. Enforced in exactly two chokepoints: `queueEmail()` (refuses to enqueue, writes a `skipped` log) and `sendMail()` (belt-and-braces bail). No sender may write to `EmailLogs` directly after Phase 1 — everything goes through `queueEmail()`.
2. **Feature toggles.** Each email-producing feature has its own admin toggle under `Settings/email.features` (see §3.1). Master OFF overrides all; a feature toggle OFF disables only that feature. In-app notifications keep working when email is off — only their email delivery stops.
3. **Categories.** Every email carries `category: 'transactional' | 'marketing'`.
   - *Transactional* (OTP, receipts/payment lifecycle, security-relevant): sent whenever email is enabled; ignores marketing consent; still respects suppression `reason: 'bounce'` (don't burn sender reputation on dead addresses).
   - *Marketing* (broadcasts, drips, announcements, waitlist welcome): requires contact `consent.marketing === 'subscribed'`, checked against the suppression list, and every rendered email must contain `##UNSUBSCRIBE_LINK##` (compiler enforces it) + `List-Unsubscribe` header.
4. **One template system.** All templates live in `EmailTemplate` (extended, §3.3), all merge via `##TAG##`, all render inside the brand-kit shell.

---

## 3. Data model (new/extended)

> Conventions: collection names in PascalCase to match existing (`EmailLogs`, `EmailTemplate`). All timestamps are Firestore `Timestamp`. `emailHash = sha256(lowercase(trim(email)))` — same scheme as the existing `email_lookup`.

### 3.1 `Settings/email` — extensions
```ts
{
  ...existing fields (isEnabled, activeProvider, senderName/Email, replyTo, bccEmail,
     smtp/gmail/resend, providerRateLimits, autoPurge),
  features: {                     // all default TRUE; all moot when isEnabled=false
    waitlistEmails: boolean,      // OTP + welcome + waitlist broadcasts
    authEmails: boolean,          // signup OTP + welcome-on-signup
    paymentEmails: boolean,       // payment lifecycle + trial/updates reminders
    notificationEmails: boolean,  // notification→email delivery
    broadcasts: boolean,
    drips: boolean,
    adminAlerts: boolean,         // instant admin alerts + daily digest
  },
  requireSignupVerification: boolean,  // E4 toggle (default false)
  adminDigest: { enabled: boolean, hourUtc: number },  // default disabled, 08:00
  unsubscribeSecret: string,      // random, generated once on first save (HMAC for unsub tokens)
}
```

### 3.2 `Settings/email_brand` — brand kit (new doc)
```ts
{
  logoUrl: string, logoWidth: number,
  primaryColor: string, backgroundColor: string, contentBackgroundColor: string,
  textColor: string, linkColor: string, fontFamily: string,   // from a safe-font whitelist
  footerText: string,            // supports ##COMPANY_NAME##, ##UNSUBSCRIBE_LINK##, ##PREFERENCES_LINK##
  physicalAddress: string,
  socialLinks: Array<{ platform: 'x'|'linkedin'|'github'|'youtube'|'instagram'|'facebook', url: string }>,
}
```

### 3.3 `EmailTemplate` — extensions
```ts
{
  ...existing (waitlistId?, scope?, type, senderEmail, senderName, subject,
     template /* compiled HTML — stays the send format */, previewText?, isActive),
  category: 'transactional' | 'marketing',
  design?: object,               // block-editor JSON (Phase 4); absent = legacy tiptap HTML
  editorVersion: 'html' | 'blocks',
  updatedAt, updatedBy,
}
```
New `type` values added across phases: `signup_otp_email`, `signup_welcome_email`, `updates_ending_email`, `notification_generic_email`, `admin_alert_email`, `admin_digest_email`, plus per-drip-step templates (referenced by id, `scope: 'drip'`).

### 3.4 `EmailLogs` — extensions
```ts
{
  ...existing,
  category: 'transactional' | 'marketing',
  source: 'waitlist'|'auth'|'payment'|'notification'|'broadcast'|'drip'|'event'|'test',
  contactId?: string,
  status: 'pending'|'success'|'failed'|'retrying'|'deferred'|'skipped'|'suppressed',
  attempts: number, maxAttempts: number,   // default max 3
  nextAttemptAt?: Timestamp,
  skipReason?: 'email_disabled'|'feature_disabled'|'template_inactive'|'unsubscribed'|'suppressed'|'quota',
}
```

### 3.5 `Contacts/{contactId}` (new; contactId = emailHash)
```ts
{
  email: string, name?: string, firstName?: string,
  userId?: string,                       // linked auth user, if any
  sources: Array<'waitlist'|'signup'|'customer'|'import'|'manual'>,
  listIds: string[],                     // membership; drives drips & broadcasts
  consent: {
    marketing: 'subscribed'|'unsubscribed'|'pending',
    marketingChangedAt?: Timestamp,
  },
  notificationPrefs?: Record<string, { email: boolean }>,  // keyed by notification type key
  createdAt, updatedAt, lastEmailedAt?,
}
```

### 3.6 `Lists/{listId}` (new)
```ts
{
  name: string, description?: string,
  type: 'manual' | 'system',   // system lists are auto-maintained (see below), not deletable
  memberCount: number,          // maintained by membership functions
  createdAt, updatedAt,
}
```
System lists (seeded, auto-maintained): `all-users` (every registered user), `all-customers` (any paying user), one list per waitlist (`waitlist-{id}`, membership mirrors verified waitlist members). Membership is stored **on the contact** (`listIds` array) — single write to move someone, `array-contains` queries for targeting. All membership changes go through two helpers: `addContactToLists()` / `removeContactFromLists()` (they also update `memberCount` and fire drip enrollment/exit, Phase 7).

### 3.7 `Suppression/{emailHash}` (new)
```ts
{ email: string, reason: 'bounce'|'complaint'|'unsubscribe'|'manual', at: Timestamp, detail?: string }
```
Written by: unsubscribe flow, webhook handler (hard bounce / complaint events), admin UI. Checked in `queueEmail()`: marketing ⇒ any reason blocks; transactional ⇒ only `bounce`/`complaint` block.

### 3.8 `Notifications/{id}` (new; flat collection)
```ts
{
  userId: string,                // recipient (auth uid)
  type: string,                  // key into the notification-type registry
  title: string, body: string, link?: string, icon?: string,
  read: boolean, readAt?: Timestamp,
  createdAt: Timestamp, createdBy: 'system'|'admin:{uid}'|'event:{type}',
  emailDelivery?: { requested: boolean, emailLogId?: string, skippedReason?: string },
  announcementId?: string,       // when fanned out from an announcement
}
```

### 3.9 `Settings/notification_types` (new doc — the registry)
```ts
{ types: Record<string /* typeKey */, {
    label: string, description: string,
    category: 'transactional'|'marketing',       // controls the email rules
    defaultChannels: { inApp: boolean, email: boolean },
    userConfigurable: boolean,                   // shows in the user preference center
    emailTemplateType?: string,                  // defaults to notification_generic_email
    enabled: boolean,
}>}
```
Seeded types: `payment_succeeded`, `payment_failed`, `subscription_changed`, `trial_ending`, `updates_ending`, `announcement`, and admin-audience types `admin_new_signup`, `admin_payment_received`, `admin_payment_failed`, `admin_webhook_failure`.

### 3.10 `Announcements/{id}` (new)
```ts
{
  title, body, link?,
  audience: { kind: 'all'|'role'|'list'|'users', role?: string, listId?: string, userIds?: string[] },
  sendEmail: boolean,
  status: 'draft'|'sending'|'sent'|'failed',
  counts: { targeted: number, notified: number, emailed: number },
  createdAt, createdBy, sentAt?,
}
```

### 3.11 `AppEvents/{id}` + `Settings/event_mappings` (new — the event bus)
```ts
// AppEvents doc — product code writes these; the email system consumes them
{ type: string, userId?: string, contactEmail?: string, data?: Record<string, any>,
  createdAt: Timestamp, processed: boolean, processedAt?, results?: object }

// Settings/event_mappings
{ mappings: Record<string /* event type */, {
    enabled: boolean,
    createNotification?: { typeKey: string, titleTemplate: string, bodyTemplate: string, link?: string },
    sendEmail?: { templateType: string, category: 'transactional'|'marketing' },
    addToLists?: string[], removeFromLists?: string[],
    enrollInDrip?: string,        // campaignId (Phase 7)
}>}
```

### 3.12 `DripCampaigns/{id}` + `DripEnrollments/{id}` (new, Phase 7)
```ts
// DripCampaigns
{
  name: string, listId: string,               // the list this campaign belongs to (D4)
  status: 'draft'|'active'|'paused'|'archived',
  trigger: 'list_join',                        // v1: joining the list enrolls you
  enrollExistingOnActivate: boolean,
  steps: Array<{ id: string, templateId: string, delayHours: number /* after prev step (step 0: after enrollment) */ }>,
  exit: { onListLeave: true /* always, per D4 */, onUnsubscribe: true /* always */ },
  counts: { enrolled: number, completed: number, exited: number },
  createdAt, updatedAt,
}
// DripEnrollments  (id = `${campaignId}_${contactId}`, natural dedup)
{ campaignId, listId, contactId, status: 'active'|'completed'|'exited',
  currentStep: number, nextSendAt: Timestamp, enrolledAt, exitedReason? }
```

### 3.13 `BroadcastEmails` — extensions (Phase 6)
```ts
{ ...existing engine fields,
  audience: { kind: 'list'|'waitlist', listId?: string, waitlistId?: string,
              filters?: Array<{ field: 'premiumType'|'source'|'createdAfter', op: '=='|'>=', value: any }> },
  scheduledAt?: Timestamp,   // status 'scheduled' until due
}
```

---

## 4. Firestore security rules (cross-phase requirement)

- `Contacts`, `Suppression`, `EmailLogs`, `AppEvents`, `DripEnrollments`: **no client access** (functions only), except admins may read for the admin UIs.
- `Notifications`: user may read/update-`read` only docs where `userId == auth.uid`; create/delete = functions/admin only.
- `Lists`, `DripCampaigns`, `Announcements`, `EmailTemplate`, `Settings/email*`, `Settings/notification_types`, `Settings/event_mappings`: admin-only writes.
- Unsubscribe/preference pages never touch Firestore from the client directly — they call HTTP functions with the HMAC token (works for non-user contacts too).

---

# 5. PHASES

> Each phase is independently shippable and ends with a **Verification** checklist. Run backend checks against the Firebase emulator suite where possible; anything marked **[live]** needs a real provider (use a test Resend key or a throwaway Gmail). Unit tests: Vitest from repo root (`npm run test`) — functions tests are included in the root config.

---

## Phase 1 — Send-pipeline foundations & kill-switch integrity

**Objective:** one hardened chokepoint for all email, with retry, universal rate limiting, working unsubscribe, and the kill-switch guaranteed everywhere (E5, E6).

### Scope — backend (`functions/src/email-core/` new module)
1. **`queueEmail(params)`** — the only sanctioned way to create an `EmailLogs` doc. Performs, in order: master kill-switch check → feature toggle check (caller passes `source`) → template `isActive` check → category/consent check (Phase 3 will add Contacts; until then consent = existing `isSubscribed` for waitlist recipients) → suppression check → writes `EmailLogs` with `status:'pending'`, `category`, `source`, `attempts:0`. Blocked sends write the log with `status:'skipped'|'suppressed'` + `skipReason` (auditable, never silent).
2. **Migrate every existing sender** to `queueEmail()`: `emailTemplateHelper.createOtpEmailLog/createWelcomeEmailLog`, `paymentEmailHelper.sendPaymentEmail`, `broadcastHelper.processRecipientBatch`, `scanTrialEndings`.
3. **`sendMail()` hardening:**
   - Enforce provider quota/rate limits (`emailCounter.checkQuota`) for **all** sends, not just broadcasts. Quota exhausted ⇒ `status:'deferred'` + `nextAttemptAt`.
   - Transient failure ⇒ `status:'retrying'`, `attempts++`, `nextAttemptAt = now + 5min * 2^attempts`; after `maxAttempts` ⇒ `failed`.
   - New scheduled function `retryPendingEmails` (every 5 min): picks up `retrying`/`deferred` docs where `nextAttemptAt <= now`, re-runs `sendMail`. Re-checks the kill-switch each attempt.
4. **Unsubscribe, fixed:** HMAC-token links (`/unsubscribe?e={emailHash}&t={hmac}`) generated by the tag resolver — fixes the empty-userId bug at `emailTemplateHelper.ts:189`. New HTTP function `handleUnsubscribe` validates the token, sets the recipient unsubscribed (waitlist `isSubscribed:false` now; `Contacts.consent` from Phase 3 on), writes a `Suppression` doc. Add `List-Unsubscribe` + `List-Unsubscribe-Post` headers on all marketing sends.
5. **Kill-switch audit (E5):** grep-level sweep — no code path outside `queueEmail` writes `EmailLogs`; add a repo unit test that asserts (source-scan style, per the existing cloud-function testing pattern) no other file contains `collection('EmailLogs').add|doc(...).set`.
6. **Onboarding guard (E6):** `src/app/pages/(onboarding)/onboarding-setup.service.ts` must apply the same "can't enable email without a valid provider" coercion the Email Settings page uses.

### Scope — frontend
- Email Settings page: add the **Features** toggle group (§3.1) with the master switch visually gating them (disabled + explanatory hint when master is off).
- EmailLogs admin view (if present) shows new statuses + `skipReason`.

### Out of scope
Contacts/Lists (Phase 3), any new email types.

### ✅ Phase 1 verification
1. `npm run test` — all green, including the new "no direct EmailLogs writes" scan test and unit tests for `queueEmail` gating (each toggle off ⇒ `skipped` log with correct `skipReason`).
2. Emulator: with `Settings/email.isEnabled=false`, trigger a waitlist join with OTP → an `EmailLogs` doc appears with `status:'skipped'`, `skipReason:'email_disabled'`; **no** provider call attempted (check emulator function logs).
3. Emulator: enable email but set `features.waitlistEmails=false` → waitlist OTP is skipped with `feature_disabled`; a payment event email (features.paymentEmails=true) still queues as `pending`.
4. **[live]** Enable email with a real test provider, trigger a waitlist OTP → email arrives; `EmailLogs.status='success'`, `attempts=1`.
5. **[live]** Break the provider (wrong SMTP password), trigger a send → log goes `retrying` with `nextAttemptAt` set; fix the password; within ~5–10 min the retry scan flips it to `success`.
6. **[live]** Send a marketing-category email (waitlist welcome) → footer unsubscribe link resolves (no empty id), clicking it shows the confirmation page, the recipient's `isSubscribed` flips to false, a `Suppression` doc exists; sending them another welcome email produces `status:'suppressed'`.
7. Onboarding flow: attempt to enable email during onboarding without a configured provider → blocked, same as the settings page.

---

## Phase 2 — Transactional completion (auth + payments)

**Objective:** every transactional email a launching product needs, verified end-to-end. Clears E1–E4 + welcome-on-signup.

### Scope
1. **Seed default templates** (idempotent seeding function or on-first-read fallback) for all payment types + `signup_otp_email`, `signup_welcome_email`, `updates_ending_email`. All marked `category:'transactional'` except welcome (marketing).
2. **E1 — payment lifecycle emails end-to-end:** verify `paymentEmailHelper` (now via `queueEmail`) for succeeded / failed / on-hold / cancelled / expired / refunded + `trial_ending_email`; tags `##PAYMENT_AMOUNT## ##CURRENCY## ##RENEWAL_DATE## ##TRIAL_ENDS_AT## ##SUBSCRIPTION_PLAN##` render; `Settings/email.bccEmail` honored.
3. **E2 — updates-ending reminder:** scheduled scan (mirror `scanTrialEndings`) over `users.updatesUntil` within a 14-day window, `updatesEndingReminderSent` dedup flag, sends `updates_ending_email`.
4. **E3 — real signup OTP:** callable `requestSignupOtp` (generates 6-digit code, stores hash + expiry (10 min) + attempt counter (max 5) in `signup_otps/{emailHash}`, sends via `queueEmail`) and callable `verifySignupOtp` (server-side check; on success marks verification). Replace the client-side stub in `signup.page.ts`. Rate-limit resends (min 60s between requests).
5. **E4 — "Require email verification on signup" toggle** (`Settings/email.requireSignupVerification`): ON + email enabled ⇒ OTP step mandatory, `emailVerified:true` only after server verify; OFF or email disabled ⇒ skip step, `emailVerified:false` (existing behavior). Admin setting lives on the Email Settings page; degrade rule: toggle shown as forced-off when email is disabled.
6. **Welcome-on-signup (D9):** after registration completes, `onUserCreate` emits a `signup_welcome_email` (marketing category, template can be deactivated).

### ✅ Phase 2 verification
1. `npm run test` — new unit tests: OTP hash/expiry/attempt logic, toggle matrix (email on/off × verification on/off ⇒ correct signup path), template seeding idempotency.
2. Emulator seeding run: `EmailTemplate` contains one active doc per new type; running the seeder twice creates no duplicates.
3. **[live]** Full signup with verification ON: register → OTP email arrives (correct branding, code) → wrong code rejected → right code accepted → user doc `emailVerified:true` → welcome email arrives.
4. Signup with verification OFF: no OTP step, `emailVerified:false`, welcome email still sent (email enabled).
5. Signup with email disabled: no OTP step, no emails, **signup does not block** (regression check: the pre-spec client-side OTP stub blocked signups whenever email was enabled).
6. **[live]** Dodo test-mode payment succeeded + refund → both emails arrive with correct amounts/currency; BCC copy received; `EmailLogs` shows `usedTags` populated, `unmappedTags` empty.
7. Emulator: set a user `updatesUntil` = 7 days out, run the scan manually → one `updates_ending_email` queued, flag set; re-run → nothing new.

---

## Phase 3 — Contacts, Lists & consent

**Objective:** the unified audience layer (D5) + category consent and preference center (D6). Prerequisite for notifications prefs, broadcasts v2, drips.

### Scope
1. **Contacts sync (functions):** upsert helpers + triggers — `onUserCreate`/`onUserDelete` (source `signup`, join/leave `all-users`), waitlist verify (source `waitlist`, join `waitlist-{id}` list), first successful payment (source `customer`, join `all-customers`). Backfill script/callable to build Contacts from existing users + waitlist members (run once, idempotent).
2. **Lists:** CRUD (admin), system lists seeded + maintained, `addContactToLists`/`removeContactFromLists` helpers as the single mutation path.
3. **Consent wiring:** `queueEmail` marketing gate now reads `Contacts.consent.marketing`; unsubscribe flow (Phase 1) updates the Contact; waitlist `isSubscribed` kept in sync (legacy readers keep working).
4. **Preference center:** public page `/email-preferences?e={emailHash}&t={hmac}` via HTTP function — shows marketing on/off + (from Phase 5) per-notification-type email toggles; `##PREFERENCES_LINK##` tag added to the brand-kit footer.
5. **CSV import (admin):** upload → parse → preview (valid/invalid/duplicate counts) → import as contacts with `consent.marketing:'subscribed'` **only** if the admin affirms consent (checkbox with warning), else `'pending'` (excluded from marketing sends). Add to a chosen list.
6. **Admin UI:** Contacts page (search, view, edit consent, manual add/suppress) + Lists page (create, member list, add/remove members, CSV import entry).

### ✅ Phase 3 verification
1. `npm run test` — sync trigger tests (user create ⇒ contact + `all-users` membership; delete ⇒ cleanup), consent-gate tests in `queueEmail`.
2. Emulator: run backfill on seeded data → every user + verified waitlist member has a Contact with correct `sources` and `listIds`; run again → no dupes, counts stable.
3. New signup → Contact appears with `userId` linked, member of `all-users`; complete a test payment → `all-customers` added.
4. CSV import of 5 rows (1 malformed, 1 duplicate) → preview shows 3/1/1; import; contacts exist on the chosen list; the no-consent path yields `consent.marketing:'pending'` and a test broadcast to that list skips them (`skipReason:'unsubscribed'`).
5. **[live]** Open a marketing email → preferences link opens the center with correct state; toggle marketing off → Contact updated + Suppression written; transactional email (OTP) still delivers to that address; marketing email is suppressed.
6. Move a contact out of a list in the admin UI → `listIds` and `memberCount` both correct.

---

## Phase 4 — Brand kit & block-based WYSIWYG editor

**Objective:** true WYSIWYG (D3) — admins compose emails from blocks, never touching HTML/CSS; one brand kit (D12) styles everything.

### Scope
1. **Brand kit:** `Settings/email_brand` (§3.2) + admin settings page with live email-frame preview. Compiler wraps every template's content in the branded shell (header logo, body container, footer with address/socials/unsubscribe/preferences links). `showPoweredBy` behavior unchanged.
2. **Block editor (Angular, `src/shared/components/email-block-editor/`):**
   - Blocks v1: heading, paragraph (rich-ish text: bold/italic/link — reuse tiptap *inside* the text block only), image (upload to Storage), button, divider, spacer, two-columns, social row, raw-HTML block (advanced escape hatch, collapsed by default).
   - Merge tags inserted as chips → serialize to `##TAG##`; per-context tag palette (reuse `getPlaceholders()` data).
   - Desktop/mobile preview toggle; "Send test email" button (uses `queueEmail` with `source:'test'`).
   - **Compile at save time in the frontend:** design JSON → email-safe table HTML (inline styles, 600px, bulletproof buttons, alt text). Store both `design` and compiled `template`. The send pipeline keeps sending stored HTML — no server-side compiler needed.
3. **Adoption + migration:** template editors (waitlist templates page, payment settings, and all new types) use the block editor for `editorVersion:'blocks'` docs; legacy docs open read-only in the old tiptap view with an "Upgrade to blocks" action (starts from a blank/blockified version — no lossy auto-conversion). Re-author the seeded default templates as block designs.
4. **Marketing guard:** compiler refuses to save a marketing-category template whose footer lacks `##UNSUBSCRIBE_LINK##` (brand-kit footer provides it by default).

### ✅ Phase 4 verification
1. `npm run test` — compiler unit tests: each block type → expected HTML snapshot; tag chips survive round-trip; unsubscribe-guard test.
2. Set brand kit (logo, colors, footer) → open any template preview → shell reflects it; change primary color → button colors update in previews of *other* templates without editing them.
3. Author a template using every block type without touching the HTML tab; save; Firestore doc has both `design` and compiled `template`; **[live]** send test email → renders correctly in Gmail web + a mobile client (manual check: layout, images, button).
4. Legacy tiptap template still sends unchanged; "Upgrade to blocks" produces an editable block version.
5. Try saving a marketing template with the unsubscribe tag removed via the raw-HTML block → save blocked with a clear error.

---

## Phase 5 — Notifications & event bus

**Objective:** in-app notification center + admin announcements + system-event notifications (D1), notification→email per-type + per-user prefs (D2), generic `AppEvents` bus (D11), admin alerts/digest (D9).

### Scope
1. **Notification core:** `Notifications` collection (§3.8) + registry (§3.9, seeded). Trigger `onNotificationCreate`: look up type config → if `defaultChannels.email` && user pref allows && `features.notificationEmails` ⇒ `queueEmail` with the type's template (default `notification_generic_email` with `##TITLE## ##BODY## ##LINK##`); record outcome in `emailDelivery`.
2. **User UI:** bell icon in the app header (unread badge, realtime), dropdown of recent + `/notifications` page (list, mark read / mark all read), and a notification-preferences section (per `userConfigurable` type: email on/off) — stored on the user's Contact and editable both in-app and via the public preference center.
3. **Announcements (admin→users):** composer (title, body, link, audience: all / role / list / specific users, `sendEmail` checkbox) → callable fan-out (batched, resumable for large audiences, mirroring the broadcast-chunk pattern) creating Notification docs; counts updated on the Announcement.
4. **Event bus:** `AppEvents` + `Settings/event_mappings` (§3.11). `onAppEventCreate`: resolve mapping → create notification and/or queue email and/or list add/remove (+ drip enroll once Phase 7 lands); mark `processed` with per-action results. Exported helper `emitAppEvent(type, payload)` for product code; wire existing internal moments to emit events (`user.signed_up`, `payment.succeeded`, `payment.failed`, `waitlist.joined`) *in addition to* their direct behavior — mappings for these ship disabled to avoid double-sends, they exist as configurable hooks.
5. **Admin alerts + digest:** `admin_*` notification types fan out to all `role=='admin'` users on the relevant events (gated by `features.adminAlerts`); scheduled `sendAdminDigest` (daily at `adminDigest.hourUtc`) emails a summary (new signups, payments, failed emails, webhook failures in last 24h) when enabled.
6. **Admin config UI:** Notification Types page (per type: enabled, channels, user-configurable) + Event Mappings page (list/edit mappings per event type).

### ✅ Phase 5 verification
1. `npm run test` — onNotificationCreate decision-matrix tests (type email off / user pref off / feature off / master off ⇒ correct `skippedReason`; all on ⇒ email queued).
2. Emulator: create a `Notifications` doc for a test user → bell badge increments in the app; open it → `read:true`, badge clears.
3. **[live]** Complete a test payment → user gets an in-app `payment_succeeded` notification **and** its email; turn that type's email channel off in the registry → next payment: notification only, `emailDelivery.skippedReason` set.
4. User turns off a `userConfigurable` type's email in their prefs → next such event: in-app only. Same result when done via the public preference-center link.
5. Announcement to a 3-user list with `sendEmail:true` → 3 Notification docs, 3 emails, counts `{targeted:3, notified:3, emailed:3}`; one of the 3 has unsubscribed from marketing → `emailed:2`, their notification still appears in-app.
6. Master email switch OFF → announcements/notifications still create in-app items; zero emails (skipped logs only).
7. Write an `AppEvents` doc for a custom type with a mapping (notification + list add) → both actions occur, `processed:true`; unknown event type → marked processed with a "no mapping" result, no crash.
8. **[live]** Enable admin alerts: a new signup produces an admin notification + email to each admin; enable digest, run it manually → one summary email with correct 24h counts.

---

## Phase 6 — Broadcasts v2

**Objective:** broadcasts target any List with simple filters, can be scheduled (D10), and are composed in the block editor.

### Scope
1. **Audience:** `BroadcastEmails.audience` (§3.13) — pick a List; optional filters (`premiumType`, `source`, `createdAfter`); live recipient-count preview (respecting consent + suppression) before sending. Recipient resolution happens server-side at send time from `Contacts` (not a frozen inline array), keeping the existing chunk/rate-limit/resume engine (`processBroadcast` / `continueBroadcast`) but paging over the contact query.
2. **Scheduling:** compose now, `scheduledAt` later ⇒ `status:'scheduled'`; scheduled function (every 5 min) flips due broadcasts to `'queued'`; cancel-before-due supported.
3. **Composer:** block editor + test send + audience picker + schedule picker; legacy waitlist-broadcast entry points converge on this composer (waitlist = its system list).
4. **Consent enforcement:** every recipient passes through `queueEmail` marketing gates (subscribed + not suppressed) — skips are counted and shown on the broadcast summary (`sent / skipped / failed`).

### ✅ Phase 6 verification
1. `npm run test` — recipient-resolution tests (filters, consent exclusion), scheduler flip test.
2. Create a list of 4 contacts (1 unsubscribed) → composer preview shows 3 eligible; **[live]** send now → 3 delivered, summary shows 3 sent / 1 skipped; `EmailLogs` has the skipped doc with `skipReason:'unsubscribed'`.
3. Filter check: broadcast to `all-users` with `premiumType == 'pro'` → only pro users receive.
4. Schedule a broadcast 10 min out → status `scheduled`; it sends within ~5 min of the target time; schedule another and cancel it → never sends.
5. Kill-switch: schedule a broadcast, then disable email before it's due → it does **not** send; logs show skipped; re-enabling does not auto-fire stale scheduled sends older than a grace window (define: 24h) — they park as `failed` with a clear reason.
6. Large-list smoke: 600-contact seeded list on emulator → chunking/resume works (`_broadcast_continue` docs appear), all logs eventually created.

---

## Phase 7 — Drip campaigns

**Objective:** linear, per-list drip sequences (D4): list join enrolls, list leave/unsubscribe exits.

### Scope
1. **Model:** `DripCampaigns` + `DripEnrollments` (§3.12).
2. **Enrollment:** `addContactToLists` enrolls the contact into every `active` campaign on that list (dedup by natural id — a contact never re-enters a campaign they already completed/exited); `removeContactFromLists` exits enrollments (`exitedReason:'left_list'`). Unsubscribe exits all marketing enrollments (`'unsubscribed'`). Activating a campaign with `enrollExistingOnActivate` backfills current members (batched).
3. **Scheduler:** `processDripQueue` every 15 min — query `status=='active' && nextSendAt <= now`, and for each: re-verify (campaign still active, contact still on list, still subscribed, not suppressed, email+drips features on) → `queueEmail(source:'drip', category:'marketing')` → advance `currentStep`/`nextSendAt` or mark `completed`. Per-run cap + continuation (reuse the broadcast-chunk pattern) so big backlogs drain safely. Paused campaign ⇒ enrollments hold (nextSendAt untouched); resume continues where they were.
4. **Admin UI:** campaigns page per list — step builder (ordered steps: pick/create template with the block editor, delay in days+hours), status controls (activate/pause/archive), enrollment stats, and a per-campaign enrollments view (who's on which step).
5. **Delete/archive semantics:** archiving exits all active enrollments; templates referenced by steps can't be deleted while a non-archived campaign uses them.

### ✅ Phase 7 verification
1. `npm run test` — enrollment/exit matrix (join ⇒ enrolled; leave list ⇒ exited; unsubscribe ⇒ exited; completed contact re-joining ⇒ NOT re-enrolled), scheduler step-advance + re-verify tests.
2. Emulator, with short delays (delayHours honored in minutes via a test-only override or 0-delay steps): 3-step campaign, add a contact to the list → enrollment created at step 0 with correct `nextSendAt`; run scheduler manually 3× → 3 `EmailLogs` in order, enrollment `completed`, campaign counts updated.
3. Mid-sequence exit: enroll a contact, let step 1 send, **remove them from the list** → enrollment `exited/left_list`; scheduler runs again → no step-2 email. Repeat via unsubscribe link → same result with `'unsubscribed'`.
4. Move between lists: contact moves from list A (campaign A) to list B (campaign B) → A exited, B enrolled at step 0.
5. Pause/resume: pause after step 1 → nothing sends while paused; resume → sequence continues from step 2.
6. Kill-switch & feature toggle: disable `features.drips` (or master email) → scheduler run produces only `skipped` logs, enrollments do **not** advance (they retry when re-enabled — verify a step is not lost).
7. **[live]** End-to-end: real 2-step campaign with 1h delay on a test list → both emails arrive branded, unsubscribe in email #1 prevents email #2.

---

## Phase 8 — Hardening, docs & final audit

**Objective:** close the loop on reliability and boilerplate reusability.

### Scope
1. **Full kill-switch regression audit (E5 final):** scripted checklist across every source (waitlist, auth, payment, notification, announcement, broadcast, drip, event bus, digest, test-send) × (master off / feature off / template inactive / unsubscribed / suppressed) — automated where possible as source-scan + emulator tests.
2. **Open tracking enablement path:** document + settings for `TRACKING_PIXEL_URL`/`live_url` (currently empty in `constant.ts` — move to config so per-product deploys don't edit source); verify pixel + webhook update `isOpened`.
3. **Ops surfaces:** Email health card on the admin dashboard (last 24h: sent/failed/retrying/skipped, quota usage per provider); failed-email admin alert type (uses Phase 5 alerts) when failure rate spikes.
4. **Boilerplate docs:** `docs/email-system.md` developer guide — how a product built on ArcCMS adds a custom event (AppEvents + mapping), adds a notification type, adds an email template type, seeds brand kit; plus the admin-facing "email setup" runbook (provider config → brand kit → toggles).
5. **Cleanup:** delete dead code paths (client-side OTP stub remnants, legacy direct-EmailLogs writers), dedupe frontend/functions constant duplication (template types, provider limits) into a shared source of truth, resolve the `EmailTemplate` first-match-lookup nondeterminism (unique doc ids per type/scope).

### ✅ Phase 8 verification
1. `npm run test` — entire suite green; audit-matrix tests present for every source×gate combination.
2. Run the documented admin runbook from a **fresh emulator project** (no seeded data): onboarding → provider setup → brand kit → enable features → each feature demonstrably works or is cleanly disabled. This proves the boilerplate story.
3. **[live]** Open a real email → `EmailLogs.isOpened` flips via pixel; provider webhook (Resend) updates delivery status.
4. Dashboard card matches `EmailLogs` reality after a mixed test batch (some success, one forced failure).
5. Grep audit: zero direct `EmailLogs` writes outside `email-core`; zero references to the removed `123456`-era stub code.

---

## 6. Suggested build order & dependencies

```
Phase 1 (foundations) ──▶ Phase 2 (transactional) ──▶ Phase 3 (contacts/lists)
                                                          │
                              Phase 4 (brand kit + editor)◀┤  (4 can start after 1; only its
                                                          │   template-adoption step needs 2–3)
                                                          ▼
                                          Phase 5 (notifications + event bus)
                                                          ▼
                                          Phase 6 (broadcasts v2)
                                                          ▼
                                          Phase 7 (drips)
                                                          ▼
                                          Phase 8 (hardening + docs)
```

## 7. Open items to confirm during the build (small, non-blocking)

1. Admin audience definition for alerts/digest: proposed = `users.role == 'admin'` — confirm the exact role values in use.
2. Digest default send hour (proposed 08:00 UTC) and content list.
3. Whether the existing waitlist admin UI should eventually merge into the Lists UI (proposed: keep both; waitlists surface as system lists) — decide during Phase 3.
4. Stale-scheduled-broadcast grace window after re-enabling email (proposed 24h, Phase 6 verification #5).
5. Image storage path/size limits for editor uploads (proposed: Firebase Storage `email-assets/`, 1 MB cap, auto-resize to ≤1200px wide).
