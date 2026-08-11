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

### Which starting state are you in?

- **Fresh project** (no data): follow this section, then work top-to-bottom.
- **Existing deployment** (real signups): do **not** start here. Follow
  `docs/audience-migration-runbook.md` first — it covers the deploy order and the twelve
  migration callables — then come back and use this guide to verify.

### Deploy, in this order

The order is not interchangeable:

```bash
npx firebase-tools deploy --only functions          # 1
npx firebase-tools deploy --only firestore:indexes  # 2
#                                                     3. frontend build
npx firebase-tools deploy --only firestore:rules    # 4  ← last
```

- **Functions before rules**, or the U5 lockdown returns `permission-denied` on every
  signup: the rules forbid the client writes that `finalizeFormSignup` has to make instead.
- **Frontend before rules**, or the tightened member-doc read rule breaks the public
  leaderboard and user-details pages on the older bundle.
- **Indexes are asynchronous.** Wait for the Firebase console to show every index
  **Enabled**, not Building. A drip flush query failed silently on this project because a
  `FAILED_PRECONDITION` was swallowed by a `try/catch`.

Never trust a deploy's exit code — require an explicit `Successful create/update operation`
per function and confirm with `firebase functions:list`.

Then confirm the public callables are reachable:

```bash
bash functions/scripts/check-callable-access.sh joinForm requestFormOtp verifyFormOtp \
  finalizeFormSignup creditReferral getPublicLeaderboard getPublicMemberView
```

All seven must show `✅ reachable`. A newly created callable does not always receive
`allUsers → roles/run.invoker` automatically; the script prints the fix.

### Two serving origins

Public-facing behaviour must be tested from an origin that has **never** held an admin
session. Firebase Auth persistence is per-origin, so on a logged-in origin `isAdmin()`
satisfies the very client reads the rules deny, and a broken build looks healthy. This has
already caused one false pass.

Run two dev servers — one for admin work, one strictly public — and **assert** the public
one has no session before trusting any result on it (read IndexedDB
`firebaseLocalStorageDb` → `firebaseLocalStorage`; there must be no
`stsTokenManager.accessToken`).
1. **Seed** the system: sign in as admin → **Email → Announcements** (opens and
   runs `seedEmailTemplates`), or call the `seedEmailTemplates` callable. This
   seeds email templates, the notification-type registry, event mappings and the
   system lists.
2. **Configure a provider** for all **[logs]** tests: admin → **Settings → Email**
   → select **Debug Provider (Log Only)** → enable email. It needs no
   credentials and no connection test — every email is composed and recorded in
   `EmailLogs` but never actually sent. A prominent banner appears on the admin
   dashboard while it's active, so it's never mistaken for a live setup. Switch
   to SMTP/Gmail/Resend (and **Test connection**) only for **[live]** tests.
3. Create two accounts: one **admin**, one ordinary **user**.

> Per-form OTP and welcome templates no longer need seeding. They are created on demand:
> any path that needs one calls `ensureWaitlistTemplates`, so a form that missed the create
> trigger — or whose template was deleted — heals itself the moment a signup arrives.

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

---

## 9. Unified audience — signup, forms, lists (U1–U7)

Everything here is **[logs]** unless marked. Run the public steps on the session-free
origin from §0; on a logged-in origin these tests can pass while the build is broken.

### 9.1 Signup is server-authoritative

| # | Steps | Expected |
|---|---|---|
| 1 | Submit the public form with a new address | Member doc created under `Waitlists/{formId}/users`. `EmailLogs` shows the OTP email, `status: success`. |
| 2 | Submit the **same** address again | **No** duplicate member doc. Exactly one `joinForm: created member` line in `firebase functions:log` across both submits. |
| 3 | Submit again within 60s | `Please wait Ns before requesting another code` — the resend throttle, not a fault. |
| 4 | Add a new input to the form's HTML (e.g. `name="company"`) and sign up | The value appears in `Contacts.fields.company` with no code change. |

**Why step 2 matters:** the duplicate check is server-side (`joinForm` does find-or-create in
one transaction). The old client-side check was a read-then-write race, and it required
public read on member documents.

### 9.2 The exposure is closed — [security]

Unauthenticated, using only the web API key from the deployed bundle:

```bash
curl -s "https://firestore.googleapis.com/v1/projects/<project>/databases/(default)/documents/WaitlistedUsers?key=<web-api-key>&pageSize=3&mask.fieldPaths=email"
```

Expected `PERMISSION_DENIED`. Repeat for `Waitlists/{formId}/users`, that member's
`referrals` subcollection, and `WaitlistedUsers/{id}/referrals`. **If any returns documents,
stop** — subscriber emails are readable by anyone with the bundle's API key.

### 9.3 Verification and queue position

| # | Steps | Expected |
|---|---|---|
| 1 | Enter the wrong code 5× | Locked out; member stays `isConfirmed: false`. |
| 2 | Enter the correct code | `isConfirmed: true`, `emailVerified: true`, `queuePosition` assigned by the server. |
| 3 | Try to set `emailVerified`/`queuePosition` by unauthenticated REST PATCH, **using a value that differs from the stored one** | `PERMISSION_DENIED`. These are functions-only. |

> **The "differs" part is load-bearing.** The rule is
> `diff(resource.data).affectedKeys().hasOnly([...])`. Writing a field its *current*
> value produces an empty diff, and `hasOnly` on an empty set is vacuously true — so the
> write is allowed and the probe reports a leak that is not there. Executing this guide
> produced exactly that false alarm on `emailVerified`, which was already `true`.

| 4 | Turn the form's OTP template **Active** off, then sign up | Confirms with `emailVerified: false` — never claimed as verified. |
| 5 | Delete the form's OTP template, then sign up | The default is recreated and the OTP still sends. Deleting is not the off switch; deactivating is. |

### 9.4 Referrals

| # | Steps | Expected |
|---|---|---|
| 1 | Sign up via `?ref=CODE`, then verify | Referrer's `totalReferrals` +1 exactly. Record lands under `Waitlists/{formId}/users/{referrerId}/referrals`. |
| 2 | Refer the same address twice | One record only. |
| 3 | Use your own code | Nothing recorded. |
| 4 | Delete a referred member (admin) | Referrer's count −1 **once**, not twice. |

Steps 2–4 are enforced server-side in `creditReferral`; in the browser they were advisory.

### 9.5 Templates work out of the box

| # | Steps | Expected |
|---|---|---|
| 1 | Create a new form | Its OTP + welcome templates exist immediately. |
| 2 | Check the welcome subject | `Welcome to ##WAITLIST##` — resolves to the form's name on a **sent** email. |
| 3 | Open Templates → uncheck **Active** | A confirmation dialog naming the consequence. Declining changes nothing. |
| 4 | Confirm it | Template inactive **and** `Waitlists/{id}.otpEnabled` false — the flag the public form reads. |

> A **skipped** email shows raw `##TAGS##` in the log. Skipped emails never reach a
> provider, so `processedSubject` is never computed. Correct, not a merge-tag failure.

### 9.6 Public pages — [logs]

| # | Check | Expected |
|---|---|---|
| 1 | Public leaderboard | Renders; **masked** addresses only (`ab***@example.com`). No raw address anywhere in the payload. |
| 2 | User-details page | Position and referral stats correct. |
| 3 | A leaderboard link from an **already-sent** email (legacy `waitlistedUserId`) | Still resolves. |
| 4 | Member count on the form | Renders from the form doc's `totalSignups` (confirmed members — deliberately not the raw member count). |

### 9.7 Lists, disable, and audits

| # | Steps | Expected |
|---|---|---|
| 1 | List hub → Members / Broadcasts / Sequence | Counts match the form's members. |
| 2 | Disable a contact, then trigger any send | `EmailLogs` shows `skipped` / `contact_disabled`. Re-enable → sends resume. |
| 3 | Email Logs table | A gated email reads **Skipped** (neutral), not a green "Success". |
| 4 | `npm run test` | Includes `waitlistedUsersRetired.spec.ts` and `listMembershipChokepoint.spec.ts` — the source-scan audits that catch a reader left pointed at a moved collection. |

### 9.8 Retired surfaces

| # | Check | Expected |
|---|---|---|
| 1 | `/admin/waitlists/subscribers` | Gone. The route was removed; Audience → Contacts supersedes it. |
| 2 | `WaitlistedUsers` | Frozen — unauthenticated write returns `PERMISSION_DENIED`; a signup creates no registry record. |
| 3 | Admin → Data → Export | Still offers `WaitlistedUsers`, deliberately, so legacy data can be backed up before an operator deletes it. |

## 10. Full-suite gate

Run the automated suite before sign-off:

```
npm run test
```

Everything email/notification-related should be green. (Note: an unrelated
pre-existing failure in `src/app/pages/admin/(settings)/settings.page.spec.ts`
— settings-category ordering — predates this work and is not part of the email
system.)
