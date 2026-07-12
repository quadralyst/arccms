# ArcCMS Email & Notification System — Pre-Launch Test Plan

A step-by-step plan for a developer to verify **every** email & notification
scenario built in Phases 1–8 before going live. Work top-to-bottom; each item
has **Steps** and the **Expected** result.

Legend:
- **[unit]** — covered by the automated suite (`npm run test`). Listed so you
  know it's already proven; no manual action needed.
- **[logs]** — verify from Firestore `EmailLogs` / admin **Email Logs** page.
  Works with the **Debug Provider (Log Only)** active — no real email leaves
  the system.
- **[live]** — needs a real provider (or a throwaway Resend/Gmail) to confirm
  actual delivery + rendering in a real inbox.

---

## 0. Setup (do this first)

1. **Deploy** to the test Firebase project:
   ```
   firebase deploy --only functions,firestore:rules,firestore:indexes
   ```
   > Indexes matter — this project uses composite indexes (`firestore.indexes.json`).
   > Wait until the console shows all indexes **Enabled** before testing queries.
2. **Build & serve** the frontend against that project.
3. **Seed** the system: sign in as admin → **Email → Announcements** (opens and
   runs `seedEmailTemplates`), or call the `seedEmailTemplates` callable. This
   seeds email templates, the notification-type registry, event mappings and the
   system lists.
4. **Configure a provider** for all **[logs]** tests: admin → **Settings → Email**
   → select **Debug Provider (Log Only)** → enable email. It needs no
   credentials and no connection test — every email is composed and recorded in
   `EmailLogs` but never actually sent. A prominent banner appears on the admin
   dashboard while it's active, so it's never mistaken for a live setup. Switch
   to SMTP/Gmail/Resend (and **Test connection**) only for **[live]** tests.
5. Create two accounts: one **admin**, one ordinary **user**.

### How to verify email without an inbox
Every send writes an `EmailLogs` doc. Open admin → **Email Logs** (or Firestore
`EmailLogs`) and inspect: `status`, `skipReason`, `category`, `source`,
`attempts`, and the fully-rendered `processedSubject` / `processedTemplate`.
With **Debug Provider (Log Only)** active, successful sends show
`status:'success'`, `logOnly:true`, `messageId:'debug-log-provider:...'` and the
exact composed HTML — no provider is called and no quota is consumed.

---

## 1. Send-pipeline foundations & kill-switch (Phase 1)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 1.1 | No direct EmailLogs writes **[unit]** | — | `noDirectEmailLogWrites.spec.ts` green |
| 1.2 | queueEmail gating matrix **[unit]** | — | each gate → correct `skipped`/`suppressed` + `skipReason` |
| 1.3 | Master kill-switch **[logs]** | Disable email (master off). Trigger a waitlist OTP (join a waitlist). | `EmailLogs` doc `status:'skipped'`, `skipReason:'email_disabled'`; no provider call |
| 1.4 | Feature toggle **[logs]** | Enable email; set **Waitlist emails** off. Trigger a waitlist OTP; also trigger a payment email. | OTP → `skipped`/`feature_disabled`; payment → `pending`/`success` |
| 1.5 | Real send **[live]** | Switch to a real provider (SMTP/Gmail/Resend), test the connection. Trigger a waitlist OTP. | Email arrives; `status:'success'`, `attempts:1` |
| 1.6 | Retry/backoff **[live]** | Set a wrong SMTP password; trigger a send. | Log goes `retrying` with `nextAttemptAt`; fix password; within ~5–10 min `retryPendingEmails` flips it to `success` |
| 1.7 | Quota defer **[logs]** | Set a tiny `providerRateLimits.perDay` and exceed it. | Over-quota send → `deferred`/`quota` + `nextAttemptAt` |
| 1.8 | Unsubscribe (HMAC) **[live]** | Send a marketing email (waitlist welcome). Click the footer **Unsubscribe**. | Link resolves (no empty id); confirmation page; recipient `isSubscribed:false`; `Suppression/{emailHash}` doc exists |
| 1.9 | Suppression enforced **[logs]** | Send the same recipient another marketing email. | `status:'suppressed'` |
| 1.10 | Onboarding provider guard (E6) **[live]** | Run onboarding; try to enable email without a valid provider. | Blocked / stays disabled (same as settings page) |
| 1.11 | Features UI gating **[live]** | Settings → Email with master off. | Feature toggles disabled + hint; enabling master enables them |

---

## 2. Transactional emails (Phase 2)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 2.1 | Template seeding idempotent **[unit/logs]** | Run `seedEmailTemplates` twice. | One active `EmailTemplate` per type; no duplicates |
| 2.2 | Signup OTP end-to-end **[live]** | Settings → require signup verification ON + email enabled. Register a new user. | OTP email arrives; wrong code rejected; right code accepted; user `emailVerified:true` |
| 2.3 | OTP throttle/expiry/attempts **[unit]** | — | 60s resend throttle, 10-min expiry, 5-attempt cap |
| 2.4 | Verification OFF **[logs]** | Toggle off; register. | No OTP step; `emailVerified:false`; welcome email still queued |
| 2.5 | Email disabled → signup not blocked **[live]** | Disable email; register. | No OTP, no emails, **signup completes** (regression) |
| 2.6 | Welcome-on-signup **[logs]** | Register (email enabled). | `signup_welcome_email` queued (marketing) |
| 2.7 | Payment emails **[live]** | Dodo test-mode payment succeeded + refund. | Both emails arrive with correct amount/currency; BCC copy; `usedTags` populated, `unmappedTags` empty |
| 2.8 | Updates-ending scan (E2) **[logs]** | Set a user `updatesUntil` = 7 days out; run `scanUpdatesEnding`. | One `updates_ending_email` queued; `updatesEndingReminderSent` set; re-run → nothing new |

---

## 3. Contacts, Lists & consent (Phase 3)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 3.1 | Sync triggers **[unit]** | — | user create → contact + `all-users`; delete → cleanup |
| 3.2 | Backfill **[logs]** | Audience → Contacts → **Backfill**. Re-run. | Every user + verified waitlist member has a Contact with correct `sources`/`listIds`; re-run → no dupes, counts stable |
| 3.3 | New signup + payment **[logs]** | Register; then complete a test payment. | Contact appears with `userId` + `all-users`; after payment → `all-customers` |
| 3.4 | CSV import **[live]** | Contacts → Import 5 rows (1 malformed, 1 duplicate). | Preview shows 3/1/1; import to a list; no-consent path → `consent:'pending'` (excluded from marketing) |
| 3.5 | Preference center **[live]** | Open a marketing email → **Preferences** link. Toggle marketing off. | Contact updated + `Suppression` written; transactional (OTP) still delivers; marketing suppressed |
| 3.6 | List membership counts **[logs]** | Move a contact out of a list (admin). | `listIds` and `memberCount` both correct |

---

## 4. Brand kit & block editor (Phase 4)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 4.1 | Compiler + guard **[unit]** | — | each block → HTML; tag round-trip; marketing unsubscribe guard |
| 4.2 | Brand kit preview **[live]** | Email → Brand Kit: set logo/colors/footer; change primary color. | Live preview reflects it; button colors update in previews without editing designs |
| 4.3 | Author + save **[live]** | Email → Composer: author with every block type; Save. | Doc has both `design` + compiled `template`; send test → renders in Gmail + mobile |
| 4.4 | Legacy unchanged **[live]** | Send a legacy tiptap template. | Sends unchanged; "Upgrade to blocks" produces an editable block version |
| 4.5 | Marketing guard **[live]** | Remove `##UNSUBSCRIBE_LINK##` from a marketing template (raw block). | Save blocked with a clear error |

---

## 5. Notifications & event bus (Phase 5)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 5.1 | Decision matrix **[unit]** | — | type off / user pref off / feature off / master off → correct `skippedReason`; all on → email queued |
| 5.2 | Bell badge **[live]** | Create a `Notifications` doc for a user. | Bell badge increments (realtime); opening marks read; badge clears; shows **9+** at ≥10 unread |
| 5.3 | Payment → in-app + email **[live]** | Complete a test payment. | User gets in-app `payment_succeeded` **and** its email; turn that type's email off → next payment: notification only, `emailDelivery.skippedReason` set |
| 5.4 | User pref off **[live]** | User turns a `userConfigurable` type's email off (in `/notifications` or preference center). | Next such event: in-app only |
| 5.5 | Announcement **[live]** | Announce to a 3-user list with **send email** on; one user unsubscribed from marketing. | 3 Notification docs; counts `{targeted:3, notified:3, emailed:2}`; unsubscribed user still gets the in-app item |
| 5.6 | Master off, in-app survives **[logs]** | Disable email; send an announcement. | In-app items created; zero emails (skipped logs only) |
| 5.7 | Event bus **[logs]** | Write an `AppEvents` doc for a mapped, enabled type (notification + list add); and one unknown type. | Both actions occur, `processed:true`; unknown → processed with `no_mapping`, no crash |
| 5.8 | Admin alerts + digest **[live]** | Enable admin alerts; register a new user. Enable digest; run `sendAdminDigest` in the configured hour. | Each admin gets an alert notification + email; one digest email with correct 24h counts |

---

## 6. Broadcasts v2 (Phase 6)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 6.1 | Resolution/consent **[unit]** | — | filter + consent-exclusion tests; scheduler flip test |
| 6.2 | Send now + summary **[live]** | List of 4 contacts (1 unsubscribed). Broadcasts → preview → send now. | Preview shows 3 eligible; 3 delivered; summary 3 sent / 1 skipped; `EmailLogs` skip doc `skipReason:'unsubscribed'` |
| 6.3 | Filter **[logs]** | Broadcast to `all-users` with `premiumType == pro`. | Only pro users receive |
| 6.4 | Schedule + cancel **[live]** | Schedule 10 min out → status `scheduled`. Also schedule one and cancel it. | Fires within ~5 min of target; cancelled one never sends |
| 6.5 | Kill-switch + stale grace **[logs]** | Schedule, then disable email before it's due. | Does not send; skipped logs; not fired late; if >24h overdue → parked `failed` |
| 6.6 | Large-list smoke **[logs]** | 600-contact list. | Chunking/resume works (`_broadcast_continue` docs); all logs eventually created |

---

## 7. Drip campaigns (Phase 7)

> Tip: use **0-delay** steps (or a small `delayHours`) so `processDripQueue` sends
> on the next run.

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 7.1 | Enrollment/exit + scheduler **[unit]** | — | join → enrolled; leave/unsubscribe → exited; completed re-join → NOT re-enrolled; step-advance + re-verify |
| 7.2 | Full sequence **[logs]** | 3-step campaign; add a contact to the list; run `processDripQueue` 3×. | Enrollment at step 0 with `nextSendAt`; 3 `EmailLogs` in order; enrollment `completed`; counts updated |
| 7.3 | Mid-sequence exit **[logs]** | After step 1, remove the contact from the list (then repeat with unsubscribe). | Enrollment `exited/left_list` (then `unsubscribed`); no further steps |
| 7.4 | Move between lists **[logs]** | Move a contact from list A (campaign A) to list B (campaign B). | A exited; B enrolled at step 0 |
| 7.5 | Pause/resume **[logs]** | Pause after step 1; run scheduler; resume. | Nothing sends while paused; resume continues from step 2 |
| 7.6 | Kill-switch/feature hold **[logs]** | Disable `features.drips` (or master); run scheduler. | Only `skipped` logs; enrollments do **not** advance (step not lost); resume after re-enabling |
| 7.7 | End-to-end **[live]** | Real 2-step campaign with a 1h delay on a test list. | Both emails arrive branded; unsubscribing in email #1 prevents email #2 |

---

## 8. Hardening & ops (Phase 8)

| # | Test | Steps | Expected |
|---|------|-------|----------|
| 8.1 | Debug Provider (Log Only) **[logs]** | Select it as the active provider (no config needed), enable email, trigger any send. Also confirm the admin dashboard banner appears while it's active. | `EmailLogs` `status:'success'`, `logOnly:true`, `messageId:'debug-log-provider:...'`, full `processedTemplate`; **no** provider call, quota/counter not touched; dashboard shows the "Debug Provider active" banner |
| 8.2 | Kill-switch audit **[unit]** | — | source scan: zero direct `EmailLogs` writes outside `email-core` |
| 8.3 | Email health card **[live]** | Admin → Email Logs after a mixed batch. | 24h card shows sent/failed/retrying/deferred/skipped/suppressed matching reality |
| 8.4 | Open tracking **[live]** | Set `Settings/email.trackingPixelUrl`; open a real email. | `EmailLogs.isOpened` flips via the pixel |
| 8.5 | Indexes **[live]** | After deploy, exercise retry, broadcast audience, notifications, drips, digest. | No "missing index" errors in function logs |

---

## 9. Full-suite gate

Run the automated suite before sign-off:

```
npm run test
```

Everything email/notification-related should be green. (Note: an unrelated
pre-existing failure in `src/app/pages/admin/(settings)/settings.page.spec.ts`
— settings-category ordering — predates this work and is not part of the email
system.)
