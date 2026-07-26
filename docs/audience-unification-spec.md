# ArcCMS Audience & Email Unification — Build Spec

**Status:** Approved for phased build (discussion completed 2026-07-15)
**Branch:** `feat/audience-unification` (builds on `feat/email-system`, i.e. email-spec Phases 1–7)
**Companion doc:** `docs/email-system-spec.md` remains the source of truth for the send
pipeline, kill-switch rules, categories, and the collections it defines. This spec governs
the **audience layer** (Forms / Lists / Contacts) and the **convergence of the legacy
waitlist email surfaces** onto the unified system.

---

## 0. Decision log

| # | Decision | Choice |
|---|----------|--------|
| U-D1 | Conceptual model | Industry-standard five layers: one global **Contacts** audience · **Lists** (static groups) · **Tags** (global labels on contacts) · **Forms** (capture surfaces, each owning its double-opt-in/OTP email) · messaging (broadcasts + sequences + transactional plane). Matches Kit / MailerLite / Mailchimp architecture. |
| U-D2 | Waitlist = Form | A waitlist is a **signup form with gamification enabled** (referrals, queue position, leaderboard). The Firestore collection keeps the name `Waitlists` (no data rename); admin UI reframes as **"Signup Forms"** with a waitlist/gamification toggle. UI label only — cheap to revisit. |
| U-D3 | Form → List decoupling | Every form has `targetListIds[]` (default: its auto-created list). Multiple forms may feed one list; one form may feed several. |
| U-D4 | Unverified signups | Contact is created **at signup** with `consent.marketing:'pending'`, flipped to `'subscribed'` on OTP verification. Pending contacts are visible in list views (badge) but automatically excluded from all marketing sends by the existing `queueEmail` consent gate. |
| U-D5 | Per-form OTP email | The OTP/verification email is the form's **double-opt-in confirmation email** — per-form template (content + layout), industry standard. OTP generation moves **server-side** (mirrors `requestSignupOtp`). |
| U-D6 | Welcome email | Becomes **day-0 step of a per-list Sequence** (drip, `trigger:'list_join'`), with an **instant-send fast path** for `delayHours:0` steps (no 15-min scheduler wait). Direct welcome trigger retired after parity is verified. |
| U-D7 | Feature gating | Form OTP emails stay under `features.waitlistEmails` (transactional). Sequences (including the migrated welcome) are governed by `features.drips`. One email, one owner. |
| U-D8 | Tags | Per-waitlist tags migrate to **global `Contacts.tags[]`**. Saved dynamic **Segments are deferred** (post-U7); multi-list + filter broadcast audiences cover the near-term targeting cases. |
| U-D9 | `WaitlistedUsers` | Retired — it pre-dates `Contacts` and duplicates its dedup job. Replaced by Contact (audience truth) + per-form funnel state. Highest-risk migration ⇒ isolated in its own late phase (U6) with a dual-read window. |
| U-D10 | Person records target state | Two per person: `Contacts/{emailHash}` (consent, lists, tags, identity) + the form-member doc (`Waitlists/{id}/users`, kept as **funnel state**: verification, queuePosition, referrals, formData). |
| U-D12 | Form-fed membership is read-only; admins **disable** instead | A contact's membership of a `waitlist-{id}` list is **not** editable in the List hub — it is derived from the funnel doc, so hand-removing it would desync the audience from the form's own member list. Manual-list membership stays fully editable. Instead the admin can **disable a contact** (`Contacts.disabled: true`), which stops **all** email to them (checked in `queueEmail`, `skipReason:'disabled'`) while leaving them counted and visible. Distinct from `consent.marketing:'unsubscribed'`, which is the contact's *own* choice — disabling is an admin action and is reversible. **Consequence to accept:** because it blocks transactional mail too, a disabled person cannot receive a signup/verification OTP — see U4 scope note. |
| U-D11 | Migration style | Every phase ships with an **idempotent admin callable** for backfill (precedent: `backfillContacts`). Additive first → dual-write/dual-read → cutover → delete. Dry-run first (callables support `{dryRun:true}`), and export Firestore before any id-rewriting step. |

### Explicit non-goals (deferred)
Saved segments UI · renaming the `Waitlists` Firestore collection · double opt-in for
non-form sources (CSV import keeps its consent checkbox flow) · multi-step form builder ·
A/B testing · campaign analytics (per email spec).

---

## 1. Target object model

```
Form (Waitlists/{id})            List (Lists/{id})            Contact (Contacts/{emailHash})
├ slug, uiConfig, fields         ├ type: manual|form-fed      ├ email, name, userId?
├ doubleOptIn (otpEnabled)       ├ memberCount                ├ consent.marketing:
├ otp template (per-form)        │                            │   pending|subscribed|unsubscribed
├ gamification on/off            │◀── membership listIds[] ───┤
└ targetListIds[] ──────────────▶│                            ├ tags[]        (global, U2)
                                 │                            └ sources[]
   Form-member doc (funnel state,
   Waitlists/{id}/users/{uid})           List detail page (U4):
   ├ verification state                  ├ Members tab   (contacts, pending badge)
   ├ queuePosition, referrals            ├ Broadcasts tab (audience = this list)
   └ formData                            └ Sequence tab  (drip; welcome = day 0)

Messaging: broadcasts/announcements target {include: listIds[], exclude: listIds[], filters[]}
Transactional plane unchanged: OTP, signup, payment emails — all via queueEmail.
```

Key existing code this builds on:
- `functions/src/email-core/contacts.ts` — `upsertContact`, `addContactToLists`,
  `ensureList`, `waitlistListId()`; consent enum already includes `'pending'`.
- `functions/src/email-core/contactSync.ts:53` — `onWaitlistVerifiedContact` (today the
  only place the waitlist list is created — lazily).
- `functions/src/email-core/dripEnrollment.ts` / `processDripQueue.ts` — list-join
  enrollment already fires from `addContactToLists`.
- `functions/src/auth/signupOtp.ts` — the server-side OTP pattern U5 copies.
- `src/app/pages/admin/(audience)/` — Contacts/Lists pages to extend.

---

## 2. Complexity assessment

Overall: **medium-large refactor, ~7 phases.** No new infrastructure — every phase
recombines machinery that already exists (contacts sync, drip engine, broadcast engine,
queueEmail gates). Risk is concentrated in exactly one place:

| Phase | Size | Risk | Why |
|-------|------|------|-----|
| U1 Eager lists + hygiene backfills | S | Low | Additive; idempotent backfills |
| U2 Pending contacts + global tags | M | Low-Med | New sync point at signup; consent gate already handles `pending` |
| U3 Form → List decoupling | S-M | Low | Additive field + membership routing |
| U4 List hub + unified audience picker | M | Low-Med | Mostly UI; one audience type change |
| U4.5 Contact custom fields | M | Low-Med | Additive field store + tag resolver change; backfill has a conflict case |
| U5 Welcome→day-0 + server-side OTP | M-L | Med | Behavioral cutover of two live email flows; fixes the double-OTP bug |
| U6 Retire `WaitlistedUsers` | L | **High** | Data migration; leaderboard/referral queries move |
| U7 Template/editor consolidation + cleanup | M | Low | Deletion + one id-normalization migration |

U1–U5 each deliver user-visible value and are independently shippable. U6 is deliberately
sequenced after the email wins so the risky migration blocks nothing. U7 is the final
sweep (pairs with email-spec Phase 8).

---

## 2.1 Full-software impact map (audit completed 2026-07-15)

Result of a repo-wide sweep of every surface touching `Waitlists`, `Waitlists/{id}/users`,
`WaitlistedUsers`, `Lists`, `Contacts`, tags, referrals, and the leaderboard. **Owner
phase** = where the surface is updated; verification for that phase must include it.

### Frontend surfaces

| Surface | Depends on | Impact | Owner |
|---|---|---|---|
| **Main admin dashboard** (`(dashboard)/dashboard.page.ts`) — total/7-day/verified counts, recent signups, per-waitlist cards | `WaitlistedUsers` counts + `Waitlists/{id}/users` counts | **Breaks in U6** if untouched. Re-point growth widgets to `Lists.memberCount` + `Contacts` (possible once U2 creates contacts at signup) | **U4** (re-point) · U6 (verify parity) |
| **Per-waitlist dashboard** (`(waitlists)/dashboard/`) — verification rate, source/device breakdowns, top referrers, CSV export | `Waitlists/{id}/users` funnel docs (`signupMetadata`, `totalReferrals`, `isConfirmed`) | **Survives** — funnel docs stay per U-D10. Only `totalSignups`/referral-source reads change | U6 (parity check) |
| **Subscribers page** (`(waitlists)/subscribers/`) | Entire `WaitlistedUsers` collection | Obsolete — becomes a Contacts view (`source:'waitlist'`) or is dropped (open item 4) | U6 |
| **Joined-users page + view-user-detail** incl. `deleteUser()` multi-collection batch (referral graph in `WaitlistedUsers`) | Both person stores + referrals | Batch rewrite when referrals re-home | U6 |
| **Tags pages/stores** (`WaitlistUserTags_{waitlistId}` dynamic collections, member `tags[]`) | Per-waitlist client-managed tag collections | Migrate to global `Tags` + `Contacts.tags[]`; retire the `WaitlistUserTags_*` rules carve-out | U2 |
| **Waitlist templates page** | `EmailTemplate`, `BroadcastEmails`, member subcollection | Broadcast tab → list hub (U4); OTP/welcome editing (U5); editor swap (U7) | U4/U5/U7 |
| **Data export/import** (`(data)/data-constants.ts` + export/import pages) | Declares `Waitlists`, `WaitlistedUsers`, subcollection handling | Add `Contacts`/`Lists`/`Tags` entries (U2–U3); remove `WaitlistedUsers` (U6) | U2–U3, U6 |
| **Side navbar + routes** (`side-navbar.component.ts` builds per-waitlist submenus from `WaitlistAdminStore`; `app.routes.ts` waitlist/admin routes) | Nav structure | "Signup Forms" reframe + list-hub links; `subscribers` route retired in U6 | U3/U4 |
| **Public join wizard + embedded forms** (`WaitlistFormService`, `index.page.ts` form hydration, live `[data-waitlist-count]` widgets) | `Waitlists` doc + subcollection count + `WaitlistService` | Survives (funnel docs stay); OTP calls swap to callables in U5; count widgets keep reading the subcollection |U5 |
| **Public leaderboard / user-details pages** | `WaitlistedUsers` via `getOptimizedLeaderboard` + `WaitlistService` | Re-pointed with the leaderboard migration | U6 |
| **Public unsubscribe pages** (`unsubscribe-handling/` writes `WaitlistedUsers` + subcollection **from the client**) | Legacy client-side consent writes | Replace with the token-based `handleUnsubscribe` HTTP flow; routes become thin views | U5 |
| **Onboarding** (`onboarding-setup.service.ts` seeds an initial waitlist) | `Waitlists` doc shape | Label/field additions only (`targetListIds`, gamification default) | U3 |
| Account page, user area, public-page-renderer, Analytics dashboard UI | — | **Unaffected** (verified: no references) | — |

### Backend surfaces

| Surface | Impact | Owner |
|---|---|---|
| OTP triggers `onWaitlistedUsersCreate/Update` + client-doc OTP path | Deleted; replaced by `requestFormOtp`/`verifyFormOtp` | U5 |
| Welcome paths in `onWaitlistUserCreate/Update` | Guarded no-op (U5), deleted (U7) | U5/U7 |
| Referral triggers `onReferralCreate/Update` + `utils/referralHelper.ts` **dual-writes** to both person stores | Re-homed with referrals | U6 |
| `getOptimizedLeaderboard` callable (queries `WaitlistedUsers` / subcollection; `collectionName` is part of its public contract) | Re-pointed; keep param accepted-but-ignored for old clients | U6 |
| `handleUnsubscribe` legacy legs (writes `WaitlistedUsers.isSubscribed` + collectionGroup `users`) | Legs removed after U6 cutover; `Contacts` + `Suppression` legs already correct | U6 |
| `contactSync.onWaitlistVerifiedContact` (bridge: verify-time, consent `subscribed`) | Moves to signup-time with `pending`, flip on verify | U2 |
| `onWaitlistsDelete` (recursive subcollection delete; **does not clean the mirrored List/Contacts membership — orphan risk today**) | Add List + membership cleanup | U1 |
| `ensureWaitlistExists` public callable | Keep name (deploy contract); gains `targetListIds` defaults | U3 |
| `backfillContacts` | Retires after final U6 run | U6/U7 |
| `onUserCreateContact` (app users → `subscribed`) | **Unchanged** — `pending` applies to form signups only; app signups keep existing consent behavior | U2 (test only) |
| AnalyticsDashboard functions (pure GA4, no audience reads) | **Unaffected** (verified) | — |

### Security rules & indexes (`firestore.rules`, `firestore.indexes.json`)

| Item | Impact | Owner |
|---|---|---|
| `Waitlists/{id}/users` unauth-update whitelist (**clients may write `emailVerified`, `verificationCode`, `totalReferrals` today**) | Lock down when OTP/verification goes server-side — this is a security fix, not just cleanup | U5 |
| `Waitlists/{id}` unauth `totalSignups` increment carve-out | Removed when counts move server-side | U6 |
| `WaitlistedUsers` + referrals rule blocks | Deleted at cutover | U6 |
| `WaitlistUserTags_*` wildcard rules (unauth `usageCount` update) | Retired with global tags | U2 |
| `Contacts` composite indexes — **none exist**; new queries need them (`listIds array-contains` + consent; leaderboard ordering if Contacts-based) | Add to `firestore.indexes.json` (source-controlled, not console-only) | U2 (consent) / U6 (leaderboard) |
| Latent gap: leaderboard's default `WaitlistedUsers` path has **no source-controlled composite index** (console-created only) | Fixed implicitly by U6 re-point; document for existing deployments | U6 |

### Deploy-surface compatibility (existing products call these by name/URL)

- **Callable names are public contract:** `getOptimizedLeaderboard`, `ensureWaitlistExists`,
  `requestSignupOtp`/`verifySignupOtp`, admin callables. No renames — new capabilities are
  new callables; changed callables stay signature-compatible (extra params optional).
- **HTTP URLs are embedded in already-sent emails:** `/unsubscribe` (incl. RFC 8058
  one-click POST), `/email-preferences`, `trackEmailOpen`, webhook. Paths and token formats
  must never change.
- Firestore trigger deletions (`onWaitlistedUsers*`, `onReferral*`) are deploy-diff
  removals — safe, but the runbook must sequence data migration **before** the deploy that
  removes them.

### THE TESTING MODEL (read before writing or running any verification step)

**There is no emulator. This project is tested against the live dev Firebase project.**

- **Frontend:** runs **locally** — `npm run dev` at `http://localhost:5173`.
- **Backend:** Cloud Functions, Firestore data, rules and indexes all live in the **dev
  Firebase project** (`xlm-project-864ff`, the `default` alias in `.firebaserc`). The app has
  **no `connectFirestoreEmulator`/`connectFunctionsEmulator` calls anywhere in `src/`**.

Consequences that shape every phase:

1. **Functions run only from the last deploy.** Editing `functions/src/**` changes nothing in
   the browser until you build and deploy:
   ```
   cd functions && npm run build
   firebase deploy --project default --only "functions:<name>,functions:<name>"
   ```
2. **Rules and indexes likewise need deploying:**
   `firebase deploy --project default --only firestore:rules,firestore:indexes`
3. **Verify the deploy landed — do not trust the exit code.** A U3-era deploy reported
   `exit 0` while pushing **none** of the requested functions. Always confirm:
   ```
   firebase functions:list --project default | grep <functionName>
   ```
4. **The data is shared and real.** Test data (forms, contacts, tags) persists and is visible
   to anyone else on the project. Migration callables run against real records — take a
   Firestore export before any destructive or id-rewriting step.
5. **`firebase` may be missing from PATH** — it is installed per-Node-version under nvm. Use
   `npx firebase-tools …` (note: `npx firebase` is the wrong package name) or
   `nvm use 22.17.0`.

Because of all this, phase verification steps below say **"Dev project:"**, never
"Emulator:" — they assume the phase's functions/rules are already deployed. Wiring up the
emulator suite so phases can be verified without touching a shared project remains a
worthwhile separate task, but it is **not** how this work is currently validated.

**Verifying without an admin browser session** (used from U1 onward): a node script that
reuses the Firebase CLI credentials exactly as `functions/scripts/call-seed.cjs` does
(refresh token from `~/.config/configstore/firebase-tools.json` → temp ADC file →
`GOOGLE_APPLICATION_CREDENTIALS`), imports the **compiled** helper from `functions/lib/**`,
and asserts Firestore state. This exercises real product code against the real project.
Note `createCustomToken` does **not** work on CLI credentials (no service-account signer),
so admin-guarded callables can't be invoked this way — test their underlying helper, or
click the button in the admin UI.

**Verify rendered content, not HTTP status.** The public not-found page returns **200**, so a
status-code check passes on a completely broken admin route (see the routing note below).

### ⚠️ BLOCKER: admin callables are unreachable from the UI (found 2026-07-26)

**Every `onCall` admin function returns HTTP 403 at the Cloud Run layer**, before any
of our code runs. The function log says *"The request was not authenticated … Empty
Authorization header value"* — the underlying Cloud Run service is missing the
`allUsers` → `roles/run.invoker` binding that the callable protocol needs (app-level
auth still happens inside, via `request.auth`).

This is **not specific to the audience work**: `backfillContacts` and
`adminAddContact` (email-spec Phase 3) are affected too, so the Contacts page's
Backfill and Add-contact buttons cannot ever have worked from the browser. Verified
403: `backfillContacts`, `adminAddContact`, `adminSetContactDisabled`,
`adminSetContactTags`, `adminUpsertContactField`, `adminDeleteContactField`,
`adminSetContactFields`, `migrateTagsToContacts`, `migrateFormDataToContactFields`,
`migrateWelcomeToSequences`, `backfillFormLists`, `backfillPendingContacts`,
`normalizeWaitlistTemplateIds`, `stampFormTargetLists`.
Not affected (return 400, i.e. reachable): `requestFormOtp`, `verifyFormOtp`.

`firebase deploy` does **not** repair it — redeploying a single function was tried and
the 403 persisted. The fix is a one-off IAM grant per service, which needs project
IAM rights:

```
gcloud run services add-iam-policy-binding <lowercased-function-name> \
  --region=us-central1 --member=allUsers --role=roles/run.invoker \
  --project=xlm-project-864ff
```
(or Cloud Console → Cloud Run → service → Security → allow unauthenticated). If an
org policy such as Domain Restricted Sharing blocks `allUsers`, that policy has to be
exempted for these services instead.

**Consequence for verification:** every admin *button* that calls a callable is
untestable until this is fixed — disable/enable contact, field CRUD, all migration
buttons. Admin surfaces that only *read* Firestore (List hub, Fields table, Contacts,
dashboard counts) work fine and have been verified against real data. The migrations
themselves were exercised by invoking the compiled helpers directly (see §2.1
verification pattern), so the logic is proven even though the buttons are not.

### Convention: admin routes go in `app.routes.ts`, explicitly

`app.config.ts` uses `provideFileRouter(withExtraRoutes(routes))`, so Analog file-based
routes and `app.routes.ts` coexist — but **every admin feature route is declared
explicitly** (`admin/settings`, `admin/data`, `admin/waitlists`, `admin/email/*`,
`admin/users`, `admin/products`, `admin/transactions`, `admin/notifications`), each
loading `admin.page.ts` as the shell with the page as a child and `roleGuard` on the
parent. A handful of older pages (`(dashboard)`, `(contacts)`, `(lists)`, `(media)`) rely
on file-based routing instead.

**New admin pages must add an explicit route.** A file-based-only admin page resolves
server-side (correct SSR `<title>`) but does not reliably reach the client route table;
after hydration it falls through to the public `:contentTypeSlug/:urlSlug` route and
renders **"Content Not Found" in the public shell** — which is what happened to
`/admin/contact-tags` in U2 (fixed 2026-07-17).

**Verify rendered content, not HTTP status:** that public not-found page returns **200**,
so a `curl -o /dev/null -w %{http_code}` check passes on a completely broken route. Assert
on the page text (a working guarded admin route shows the 403 page when unauthenticated).

### Known defect class: SSR realtime listeners (NG0205)

`@angular/fire` captures the injector when `onSnapshot` is called and runs the
callback inside it. A listener registered during SSR outlives the request injector that
was torn down when the response was rendered, so the next snapshot fires against a
destroyed injector — NG0205 on a Firestore timer, uncaught, **killing the dev/SSR server
process**. Fixed in `WaitlistAdminStore` (2026-07-17); the guard pattern is
`if (!isPlatformBrowser(this.platformId)) return;`, matching `DbService`/`AudienceService`.

Same-shape risk in other root services that call `onSnapshot` without a browser guard —
audit before/while touching them: `media-manager.service.ts`,
`published-contents.service.ts`, `global-message.service.ts`, `site-usage.service.ts`,
`user-setting.service.ts`. Any new realtime listener added in U2–U7 must carry the guard
and be idempotent (share one listener; re-subscribing must not orphan the previous one).

### Test blast radius

~24 frontend spec files and ~15 functions spec files touch affected surfaces (inventory in
phase checklists). **Untested surfaces that will change:** subscribers page, per-waitlist
dashboard, user-details, unsubscribe-handling, `audience.service`, `broadcast.service`,
`drip.service`, contacts/lists pages. **Rule: before refactoring an unspecced surface, add
a characterization test of its current behavior in the same phase.**

---

# 3. PHASES

> Conventions: every phase ends with **Deploy first**, **Manual verification** (steps
> marked **[live]** need a real email provider) and **What to expect next**.
> `npm run test` from repo root (Vitest) must be green at every phase boundary.
> Every backfill is an admin-only callable, idempotent, and logged.
>
> **Read the testing model first (§2.1): no emulator — deploy to the dev project.** `npm run dev` runs the
> frontend against the real Firebase project, so any phase touching `functions/**` or
> `firestore.rules` is invisible in the browser until deployed. Testing before deploying
> produces convincing false negatives — this already happened once in U1.
> Every phase consults the **impact map (§2.1)** — surfaces it owns are part of its
> verification. Before refactoring a surface with no existing spec file, write a
> characterization test of current behavior first (same phase).

---

## Phase U1 — Lists become real: eager creation + data hygiene

**Status:** built 2026-07-15 (`feat/audience-unification`) — awaiting the manual
verification below. Unit tests green.

**Objective:** every waitlist (existing and new) is visible in Audience → Lists from the
moment it exists; known data-hygiene defects fixed before anything builds on top.

### Scope
1. **Eager list creation:** `onWaitlistsCreate` calls `ensureList(waitlistListId(id), {name, type:'system'})` so a brand-new waitlist appears in Audience → Lists immediately with `memberCount: 0`.
2. **List rename sync:** editing a waitlist's name updates the list's name (small trigger or shared update path).
3. **Backfill callable `backfillFormLists`:** iterates `Waitlists`, `ensureList` for each; safe to re-run.
4. **Template doc-id normalization:** fix the dual id scheme (`onWaitlistsCreate` writes `${type}_${waitlistId}`; the templates page writes `${waitlistId}_${type}`). Pick **`${waitlistId}_${type}`** (matches the admin page), update `onWaitlistsCreate`, and ship callable `normalizeWaitlistTemplateIds` that merges/renames existing docs (admin-edited copy wins over seeded copy). Remove the third inline copy of default template HTML from `onWaitlistsCreate` — seed from the single functions-side default source.
5. **List UI affordance:** Lists page shows form-fed lists with a "Form" badge and a link to the owning form.
6. **Delete-path cleanup (orphan fix):** `onWaitlistsDelete` additionally removes the mirrored `waitlist-{id}` list and pulls the listId from member contacts (via `removeContactFromLists`) — today it leaves orphaned lists/membership.

### 🚀 Deploy first (nothing below is testable until this runs)

```
cd functions && npm run build
firebase deploy --project default --only "functions:onWaitlistsCreate,functions:onWaitlistsUpdate,functions:onWaitlistsDelete,functions:backfillFormLists,functions:normalizeWaitlistTemplateIds"
```
No rules or index changes in U1. *(Deployed and verified end-to-end on 2026-07-17.)*

### ✅ Manual verification
1. **The reported bug:** create a new waitlist → **without any signup**, Audience → Lists
   shows it immediately (memberCount 0, **Form** badge, "View form" action). Rename the
   waitlist → the list name follows.
2. Audience → Lists → **Sync form lists** (`backfillFormLists`): every pre-existing
   waitlist gets its list. Press twice → no duplicates, counts unchanged.
3. `normalizeWaitlistTemplateIds` with `{dryRun:true}` first → inspect the keep/remove
   plan; then run for real → one template doc per (waitlist, type), the admin-edited copy
   kept; re-run → no-op. **Export `EmailTemplate` before the real run.**
4. Create another waitlist → exactly 2 template docs, ids `${waitlistId}_${type}`.
5. Delete a waitlist that has verified members → its list is removed and the listId
   disappears from every member contact's `listIds` (no orphaned lists or membership).

### What to expect next (U2)
Lists exist but only show **verified** members. U2 makes every signup visible immediately
as a *pending* contact, and moves tags onto the contact — after U2 the Audience section is
the complete, truthful picture of everyone who ever signed up.

---

## Phase U2 — Pending contacts at signup + global tags

**Status:** built 2026-07-17 (`feat/audience-unification`) — awaiting the manual
verification below. Unit tests green.

**Deviations from the original scope, decided during the build:**
1. **The tag collection is `ContactTags`, not `Tags`.** The CMS already owns
   `Tags_{slug}` content-taxonomy collections with a *public-read* wildcard rule; a bare
   `Tags` beside them is a rules mistake waiting to happen. Tag doc ids are a slug of the
   label, which is what merges the per-form duplicates on migration.
2. **No composite indexes were added (scope item 8 dropped).** An audit of every
   `Contacts` query found only `doc()` gets and `where('listIds','array-contains',…)` —
   all served by automatic single-field indexes. Consent/source/premium filtering is
   in-memory (`broadcastAudience.passesSimpleFilters`), and the admin Contacts page loads
   a capped 500 and filters client-side. The item assumed query-level filtering that does
   not exist; indexes would cost write latency for nothing. Revisit in U4/U6, when
   multi-list audiences and a Contacts-based leaderboard introduce real composite queries.
3. **Retiring the `WaitlistUserTags_*` rules moved to U6/U7** (scope item 7). Those
   collections still back the per-waitlist tags page and the joined-users member UI, which
   retire with the member docs. The migration is deliberately **non-destructive**: legacy
   tags and member `tags[]` stay put, so both UIs keep working during the transition.

**Objective:** the audience layer reflects reality: a contact exists from the moment of
signup (`pending`), becomes mailable on verification (`subscribed`); tags are global on
the contact.

### Scope
1. **Contact-at-signup:** on waitlist member creation (unverified), `upsertContact` with `consent:'pending'`, `source:'waitlist'`, joined to the form's list(s). On verification, existing `onWaitlistVerifiedContact` flips consent to `'subscribed'` (never downgrades an already-`subscribed`/`unsubscribed` contact — a returning subscriber who joins a second waitlist must not regress to pending).
2. **Gate audit:** confirm (tests) that `queueEmail` marketing gate + broadcast recipient resolution + drip re-verify all exclude `pending` — they should already via `consent !== 'subscribed'`; add explicit test cases.
3. **Global tags:** add `tags: string[]` to `Contacts`; new `Tags` collection (id, name, color) seeded from the existing per-waitlist tags; migrate waitlist tag assignments onto contacts (callable `migrateTagsToContacts`); `defaultTagId` on a form applies the tag to the contact at signup. Waitlist tags admin page becomes the global Tags page (Audience → Tags).
4. **UI:** Contacts page: consent column shows Pending badge; filter by consent and by tag. List drawer: member list shows pending badge; header shows `X subscribed · Y pending`.
5. **Backfill callable `backfillPendingContacts`:** unverified members across all waitlists → pending contacts with correct list membership.
6. **Scope guard:** `pending`-at-signup applies to **form signups only** — app-user contact creation (`onUserCreateContact`) keeps its existing consent behavior (add a test locking this in).
7. **Tags migration detail:** the per-waitlist `WaitlistUserTags_{waitlistId}` dynamic collections migrate into the global `Tags` collection; member-doc `tags[]` assignments copy onto `Contacts.tags[]`; the `WaitlistUserTags_*` wildcard security-rules block (incl. the unauth `usageCount` carve-out) is retired.
8. **Indexes:** add source-controlled composite indexes to `firestore.indexes.json` for the new `Contacts` queries (`listIds array-contains` + `consent.marketing`; tag filters as needed) — `Contacts` currently has none.
9. **Data export/import:** add `Contacts`, `Lists`, `Tags` to `(data)/data-constants.ts` so the export/import module covers the new audience collections.

### 🚀 Deploy first (nothing below is testable until this runs)

```
cd functions && npm run build
firebase deploy --project default --only "functions:migrateTagsToContacts,functions:adminSetContactTags,functions:onContactTagDelete,functions:backfillPendingContacts,functions:onWaitlistUserCreateContact,functions:onWaitlistVerifiedContact"
firebase deploy --project default --only firestore:rules
```
Rules are **required**: `ContactTags` is unreadable without them and the Tags page renders
empty. No index deploy (deviation 2). Then rebuild/serve the frontend.

### ✅ Manual verification

**A. Migrate your existing data** (runbook steps 1, 4, 5)
1. Audience → Contacts → **Backfill**. One button runs both passes in order: app users +
   verified members, then the unverified backlog as `pending`. The toast reports all three
   counts. Press it twice → counts stable (both passes are idempotent).
2. Audience → Tags → **Import waitlist tags**. Toast reports tags imported + assignments
   copied. Press again → `0 new`, counts unchanged.

**B. The bug this phase fixes — the audience was under-reporting**
3. Join one of your waitlists from its public page and **stop at the OTP screen, don't
   verify**. Audience → Contacts: they appear *immediately* with a **Pending** badge and
   are counted in the form's list. Before U2 they were invisible until they verified.
4. Now enter the OTP → the contact flips to **Subscribed** and the count chips move.

**C. Pending contacts are counted but never mailable (the safety property)**
5. With a pending contact on a list, send a broadcast to that list → the summary counts
   them as **skipped**, and their `EmailLogs` doc carries `skipReason:'unsubscribed'`.
   Verify them, re-send → now delivered.

**D. Global tags — targeting "a type of user" across forms**
6. If the same label existed on two waitlists, Audience → Tags now shows **one** tag whose
   usage count spans both. Click **View contacts** → the Contacts page opens filtered to
   that tag, listing people from both forms. That cross-form targeting is the whole point.
7. Contacts page: the **subscribed / pending / unsubscribed** chips filter the table; the
   **Consent** and **Tag** dropdowns filter; **Clear** resets.
8. Open a contact → toggle a tag: saves immediately, drawer stays open, and the usage count
   on the Tags page follows.
9. Set a form's default tag (waitlist edit drawer) → sign up through that form → the new
   contact carries the tag automatically.
10. Delete a tag that is on N contacts → it disappears from those contacts too, not just
    from the Tags page (`onContactTagDelete`; allow a few seconds).

**E. Regressions worth confirming**
11. Register a **normal app account** → its contact is **not** pending. The pending rule is
    form-signups only.
12. A contact who unsubscribed, then signs up to a form again → stays **unsubscribed**.
    Verifying an address must never resurrect an opt-out.
13. Data → Export shows the new **Audience** group (Contacts, Lists, Contact Tags,
    Suppression). These carry consent state — treat exports as sensitive.

### What to expect next (U3)

Contacts and lists are truthful now, but each form is still hard-wired 1:1 to its own
list — so two forms can't feed one audience, and "waitlist" is still a special thing
rather than "a form with gamification on". U3 breaks that coupling.

**Tasks, in build order:**
1. `Waitlists/{id}.targetListIds: string[]` + `stampFormTargetLists` callable to set
   `[waitlist-{id}]` on existing forms.
2. Route every membership write (signup + verify, in `contactSync`) through
   `targetListIds` instead of the hard-coded `waitlistListId(waitlistId)`.
3. `gamificationEnabled: boolean` on the form; gate the referral/leaderboard/queue UI on
   the public page behind it.
4. Form edit drawer: a "Feeds lists" multi-select (own system list preselected and locked,
   per open item 1) + the gamification toggle.
5. Admin nav/labels reframe to **Signup Forms** (UI copy only — no Firestore rename).
6. Tests: membership routing to several lists, dedup when one person uses both forms,
   `stampFormTargetLists` idempotency.

**Deploy for U3:** `contactSync` triggers + the new `stampFormTargetLists` callable; no
rules or index changes expected.

**What you'll be able to do afterwards:** create a manual list ("Beta users"), point two
different forms at it, and have both forms' signups land in one audience you can broadcast
to once — while each form still keeps its own list. That's the groundwork for U4's list
hub, where each list gets its own Broadcasts and Sequence tabs.

---

## Phase U3 — Form → List decoupling

**Status:** built + deployed 2026-07-17 (`feat/audience-unification`) — awaiting the manual
verification below. Full suite green (233 files / 4054 tests).

Functions live in the dev project: `stampFormTargetLists`, `onWaitlistUserCreateContact`,
`onWaitlistVerifiedContact` (updated), plus the U2 set that had never actually shipped
(`migrateTagsToContacts`, `adminSetContactTags`, `onContactTagDelete`,
`backfillPendingContacts`). **A prior deploy reported exit 0 while pushing none of these** —
always confirm with `firebase functions:list` rather than trusting the deploy's exit code.

The ~51 suite failures seen during U3 (`index.page`, `content-partials`) were pre-existing
from commits `5a445ea`/`f5543bd` — `HomeComponent` transitively injects `Firestore` with no
test provider — and were fixed separately, not by U3.

**Objective:** a form is a capture surface that feeds configurable list(s); "waitlist" is
just a form with gamification on.

### Scope
1. **Model:** `Waitlists/{id}.targetListIds: string[]` (default `[waitlist-{id}]`, stamped by callable `stampFormTargetLists` for existing docs). All membership writes on signup/verify route through `targetListIds`.
2. **Gamification flag:** `gamificationEnabled: boolean` (default true for existing waitlists) — gates referral link/leaderboard/queue-position UI + tags in emails. A form with it off is a plain signup form.
3. **Admin UI reframe:** nav section becomes **Signup Forms**; form edit drawer gains a "Feeds lists" multi-select (its own system list preselected, non-removable for now) and the gamification toggle. No Firestore rename.
4. **Drip/broadcast interplay:** joining via a form enrolls the contact in sequences of **every** target list (already the semantics of `addContactToLists`).

### ✅ Manual verification
> Requires deploy first (see below): `stampFormTargetLists` + the two changed contact-sync
> triggers. See §2.1 — test against the dev project after deploying.
1. **Feeds lists:** Audience → Lists, create a manual list "Beta users". Signup Forms → edit Form A and Form B, tick "Beta users" under Feeds lists, save. Sign up + verify on each → in Audience → Contacts, both people are on "Beta users" **and** each form's own `waitlist-{id}` list.
2. **Union, no double-count:** the same email signs up via both forms → one contact, member of the union of lists; "Beta users" memberCount counts them once.
3. **Gamification off:** edit a form, untick Gamification, save. Open its public page, sign up → success screen shows "Thanks for signing up" with **no** referral code / leaderboard / queue position. Signup still records the contact + list membership.
4. **Gamification on (regression):** an untouched form still shows referral link, leaderboard button, and position — unchanged.
5. Run `stampFormTargetLists` (dry-run first): every form gets `targetListIds` with its own list leading; re-run → all `alreadyOk`, nothing changed.
6. Nav reads **Signup Forms** (label only; the route is still `/admin/waitlists`).

### What to expect next (U4)
Every list — manual or form-fed — is now a first-class audience. U4 gives each list the
industry-standard workspace: Members / Broadcasts / Sequence tabs, and one shared audience
picker (multi-list include/exclude + filters) across broadcasts and announcements. The
legacy per-waitlist broadcast composer is retired here.

---

## Phase U4 — List hub (Members | Broadcasts | Sequence) + one audience model

**Status:** ✅ complete 2026-07-18 (`feat/audience-unification`). Full suite green
(234 files / 4075 tests). Backend deployed and verified.

All scope delivered:
- `Contacts.disabled` admin kill-switch + `queueEmail` gate (`skipReason:'contact_disabled'`).
- Multi-list audiences: `include[]`/`exclude[]`, stateless send-once across lists, compound
  resume cursor, preview == send by construction — plus the composer's multi-select picker.
- List hub at `/admin/lists/:listId` (Members | Broadcasts | Sequence), read-only membership
  for form-fed lists (U-D12), "New broadcast/sequence for this list" via `?listId=`.
- Announcements share the include/exclude shape (and `exclude` applies to `all`/`role` too,
  resolved through one up-front email set).
- Legacy per-waitlist composer retired: its tab now points at the list hub, and
  `processBroadcast` parks **new** inline-`recipients[]` docs while still draining pre-cutoff
  and part-sent ones.
- Main dashboard reads `Contacts` instead of `WaitlistedUsers` — the collection U6 retires
  now has no dashboard dependency. Nav gains a per-form "Audience & emails" link; Subscribers
  is labelled `(legacy)`.

**Two defects found and fixed while doing this:**
1. **Announcements "By list" announced to everyone.** The option existed with no list picker,
   so the page sent `{kind:'list'}` with no `listId`, and `resolveAudience` fell through to
   the all-users branch. Now has a real picker plus a `canPublish()` guard.
2. **Retiring the legacy composer would have hidden all past sends.** Pre-U4 broadcasts carry
   only `waitlistId` and no `audience`, so the hub's audience filter could not see them. The
   hub now matches on both.

**Deploy note (keep):** an earlier deploy reported **exit 0 while every function errored**,
yet one function was live afterwards — a partial, silently-misreported deploy. Never trust
the exit code; require an explicit "Successful create/update" line per function, and note
that `functions:list` proves only that a function *exists*, not that it carries new code.

**Objective:** one place per list for "who's in it, what we sent, what runs automatically";
one audience shape everywhere; legacy waitlist broadcast path retired.

### Scope
1. **List detail page** (`Audience → Lists → {list}`): tabs **Members** (contacts, consent badges, add/remove), **Broadcasts** (history filtered to this list + "New broadcast" preselecting it), **Sequence** (the drip campaigns for this list — the existing drip builder surfaced per-list).
2. **Unified audience shape:** extend `BroadcastAudience` to `{ include: listIds[], exclude?: listIds[], filters?: [...] }` (contact-level dedup is free — membership lives on the contact). `previewBroadcastAudience` handles the new shape. **Announcements adopt the same shape** and the same picker component (their `role`/`userIds` kinds fold in as filter kinds).
3. **Retire the legacy composer:** waitlist templates page's Broadcast tab becomes a redirect to the list hub's Broadcasts tab. Guard `processBroadcast` against **new** inline-`recipients[]` docs (legacy branch kept one release for in-flight docs, then deleted in U7).
4. **Form page linkage:** the form's admin dashboard links to its list hub ("Audience & emails →").
5. **Main admin dashboard re-point:** the growth widgets (total / 7-day / verified counts, recent signups) move from `WaitlistedUsers` reads to `Contacts`/`Lists` (possible now that U2 creates contacts at signup). Per-waitlist cards read `Lists.memberCount` + pending counts. This de-risks U6: the dashboard no longer depends on the retiring collection.
6. **Nav restructure:** side-navbar per-waitlist submenus point at the list hub; the standalone Subscribers nav item is marked deprecated (removed in U6).

### ✅ Manual verification

**Covered by this pass:**
1. `npm run test` green — multi-list resolution (include ∪, exclude minus, send-once dedup, compound-cursor resume, legacy-shape back-compat) and the `contact_disabled` gate matrix.
2. Dev project: open **Audience → Lists → {list}** (row click). Members shows subscribed + pending with the right counts; Broadcasts tab lists only sends targeting this list; Sequence tab lists only campaigns bound to it.
3. Form-fed list → Members has **no "Remove from list"** action and shows the explanatory note; a manual list **does** offer removal.
4. **Disable:** disable a member → status badge reads `disabled`; a broadcast to that list logs `skipReason:'contact_disabled'` for them and does not deliver; re-enable → they receive again. Confirm the dialog warns that verification email is blocked too.
5. "New broadcast to this list" opens the composer with that list already selected; "New sequence for this list" opens the drip drawer with the list preselected.
6. Multi-list (via the hub/API until the picker lands): audience `{include:[waitlist-A, waitlist-B], exclude:[all-customers]}` → a contact on **both** A and B receives **one** email; a customer on A receives none; the preview count equals delivered + skipped-for-consent.

7. **Multi-list picker:** the composer's "Send to lists" is a multi-select; a list chosen there is disabled in "Exclude lists" so it cannot cancel itself out. Preview count with two overlapping lists counts a shared contact once.
8. **Announcements:** choose "By list" → a real list picker appears and Publish stays disabled until one is chosen (previously this silently announced to *all* users). Exclude works on the `all` audience too.
9. Old waitlist **Broadcast tab** → shows "Broadcasts have moved" and lands on the list hub. Past per-waitlist sends still appear in the hub's Broadcasts tab.
10. Main admin dashboard: Total Signups / "+N this week" match `Contacts` (contacts now exist from signup, so unverified people are included — that is the intended meaning). **Zero reads of `WaitlistedUsers`** (verify via the browser network panel).
11. Side-navbar: each form has an **"Audience & emails"** link landing on its list hub; the Subscribers item reads **"Subscribers (legacy)"**.

### What to expect next (U4.5)
The audience is unified and targetable, but a form's **arbitrary fields never reach the
contact** — so no send can personalise beyond name/email. U4.5 introduces the account-level
custom-field layer that makes merge tags and field-based targeting possible, and it must land
before U5 builds drip merge-tag plumbing.

---

## Phase U4.5 — Contact custom fields (form fields become audience data)

**Status:** ✅ built + deployed 2026-07-18 (`feat/audience-unification`). Full suite green
(235 files / 4099 tests). Functions live: `adminUpsertContactField`,
`adminDeleteContactField`, `adminSetContactFields`, `migrateFormDataToContactFields`, plus
redeploys of `onWaitlistUserCreateContact`, `onWaitlistVerifiedContact`, `onEmailLogCreate`
and `processDripQueue` (they carry the new sync + tag-resolver code).

**Implementation notes worth knowing:**
- **Merge tags are `##FIELD:key##`**, not bare `##KEY##`. An explicit prefix avoids
  colliding with built-ins — a field named `company` next to `##COMPANY_NAME##` would
  otherwise be ambiguous. Fallbacks are inline: `##FIELD:company|your company##`.
- **Field values ride on the `EmailLogs` doc.** `queueEmail` already reads the contact for
  the consent/disabled gates, so it returns `fields` from that same read — no extra read per
  recipient on a broadcast — and the log then records exactly what was merged.
- **The registry `defaultValue` is a suggestion for composing**, not a send-time lookup.
  Resolving it at send time would mean reading the registry per email; the inline `|fallback`
  covers the same need with no extra reads.
- **No new security rule was added.** The `Settings/{settingId}` catch-all already grants
  admins read/write on `contact_fields`; a `write:if false` block would have been misleading
  since rules OR together.
- Deleting a field definition **keeps** collected values, so re-adding it restores them.

**Objective:** an arbitrary field collected by any form becomes durable, queryable data on
the **contact**, usable as a merge tag in any send to any list.

### Why this is a phase, not a nice-to-have

Audited 2026-07-17: `formData` lives **only** on the funnel doc
(`Waitlists/{id}/users/{userId}.formData`). `upsertContact` writes just
`email · name · firstName · userId · source · listIds · consent · tags` — there is **no
reference to `formData` anywhere in `email-core` or `email-log`**, and the broadcast engine's
`AudienceContact` shape is `{id, email, name, userId, sources, createdAt, consent}`.

Consequences today:

| Surface | Sees custom form fields? |
|---|---|
| Form's Joined Users page / per-form dashboard | ✅ (reads the funnel doc) |
| Audience → Contacts | ❌ |
| Broadcast — even to that form's own list | ❌ |
| Multi-list broadcast (U4) / Sequence (U5) | ❌ |
| Filter or segment by a field value | ❌ |

U3 sharpens it: two forms can now feed one list with **disjoint** field sets, so a template
using `##COMPANY##` renders blank for half the recipients. The industry model (Kit,
MailerLite) puts custom fields on the **subscriber** and has forms *map into* a shared
account-level schema — which is what makes cross-form merge tags and targeting safe.

### Scope
1. **Field registry — `Settings/contact_fields`:** `{ fields: Record<key, { label, type: 'text'|'number'|'date'|'boolean'|'select', options?, createdAt }> }`. Admin-managed under Audience → Fields. `key` is a slug (same rule as tags); reserved keys (`email`, `name`, `firstName`) rejected.
2. **`Contacts.fields: Record<string, unknown>`** — values on the contact, so they survive across every list and every form.
3. **Form → field mapping:** each form maps its inputs to registry keys (`Waitlists/{id}.fieldMap: Record<formField, contactFieldKey>`). Signup sync copies mapped values onto the contact. **Write policy: fill-if-empty by default**, with an explicit "overwrite on re-submit" per-field option — never silently clobber a value the contact gave earlier through another form.
4. **Merge tags with fallbacks:** `##FIELD:company##` (or registry-driven `##COMPANY##`) resolved from `Contacts.fields` by the tag resolver, with required default syntax so a missing value never renders empty — e.g. `##COMPANY|your company##`. The compiler warns when a marketing template references a field with no default.
5. **Admin surfaces:** field values shown/editable on the contact drawer; a Fields registry page; the Contacts table can add a field as a column.
6. **Backfill `migrateFormDataToContactFields`:** walk every form's members, map `formData` → `Contacts.fields` via each form's `fieldMap`. Idempotent, `dryRun` support, and **logs conflicts** (same key, different values from different forms) rather than silently picking a winner.

### Out of scope (deferred)
Saved segments UI (still post-U7) · field-based drip branching · per-field consent.

### ✅ Manual verification (dev project — functions already deployed)
1. `npm run test` green — 17 registry/write-policy tests + 7 merge-tag fallback tests.
2. **Audience → Fields** → **New field**: create `Company` (text). The drawer shows the merge tag it produces (`##FIELD:company##`). Try label `Email` → rejected as reserved, with the reason.
3. **Map it:** Signup Forms → edit a form → **"Save form answers as"** lists the form's inputs; point `company` at the Company field → Update. (The section only appears in edit mode, once fields exist.)
4. Sign up on that form with a fresh email **and** a company value → Audience → Contacts → open that contact → **Fields** shows Company populated.
5. **Fill policy:** submit the same email again through any form with a *different* company → the original value **survives**. Then set the field to "Overwrite with the newer value", re-submit → it updates.
6. **Merge tag + fallback:** compose a broadcast whose body includes `Hi ##NAME##, how is ##FIELD:company|your company##?` and send to a list where only some contacts have a value → Email Logs shows the real company for those who have one and *your company* for those who don't — never a blank gap.
7. **Admin edit wins:** edit a field value on the contact drawer → saved even for a `fill` field (the policy stops forms clobbering each other, not people).
8. **Backfill:** Audience → Fields → **Import past form data** → reports values written, contacts updated, and any conflicts (same key, different values across forms) or forms with no mapping. Re-run → nothing new (idempotent, because `fill` skips existing values).
9. Delete a field → confirm the dialog explains values are kept; re-create it with the same label → the old values are visible again.

### What to expect next (U5)
With fields on the contact, U5 can unify the *behavior*: welcome becomes the sequence's day-0
step (instant), and the per-form OTP becomes a true server-side double-opt-in email — with
drip templates able to merge both waitlist context (`##POSITION##`) and custom fields. After
U5, the old direct welcome trigger and client-side OTP generation are gone.

---

## Phase U5 — Welcome as day-0 sequence + server-side per-form OTP

**Status:** 🟡 items 1–4 built + deployed 2026-07-18. Full suite green
(237 files / 4121 tests). **Items 5 and 6 deliberately not done — see below.**

Done:
- Day-0 fast path. The per-enrollment send was extracted to `dripSend.ts` so the
  scheduler and the fast path share one set of eligibility rules.
- **The trigger point that matters:** the flush runs both on list join *and* on
  promotion to `subscribed`. At signup a contact is `pending`, so the day-0 step is
  held; nothing re-enrolls at verification, so without a flush there the welcome
  would wait for the next 15-minute tick.
- Per-list merge context (`dripContext.ts`) as a list-kind → resolver registry, so
  a welcome sent as a drip step still resolves `##POSITION##`, `##REFERRAL_LINK##`,
  `##LEADERBOARD_LINK##`, `##WAITLIST##`.
- `migrateWelcomeToSequences` + the per-form `welcomeMigrated` guard. The flag is
  written only after the campaign exists, since it is all that separates one
  welcome from two.
- `requestFormOtp` / `verifyFormOtp`, and the public flow swapped onto them: five
  client generation sites and both plaintext comparisons are gone.

**✅ Item 5 (rules lockdown) is done and verified live.** Two pieces:

- `finalizeFormSignup` — server-authoritative completion of a signup. It writes
  `emailVerified`, `isConfirmed`, `queuePosition` and `verifiedAt`, counts the queue
  position itself, applies the form's default tag, and mirrors onto
  `WaitlistedUsers`. **Authorization is derived, never supplied:** the caller cannot
  claim "no OTP was needed" — the function re-reads `Settings/email` plus the form's
  OTP template to decide, and when a code *is* required it demands a `verified`
  `form_otps` record for that address. Trusting a client flag would have moved the
  hole rather than closed it.
- `firestore.rules` — `emailVerified`, `isConfirmed`, `verificationCode`,
  `verificationExpires`, `verifiedAt`, `queuePosition` and `totalReferrals` are out
  of the unauth-update whitelist on **both** `Waitlists/{id}/users` and
  `WaitlistedUsers`. Still whitelisted: `firstName`, `isSubscribed`,
  `leaderboardLink`, `tags`, `referredBy`, `waitlistId`, `waitlistIds`. Creates are
  untouched — a signup still creates its own doc.

Order mattered and was followed: build the callable → deploy it → switch the client
→ prove a live signup → *then* lock. Locking first returns `permission-denied` on
every signup, which no refresh recovers from.

**How the lockdown was proven** (an unauthenticated Firestore REST `PATCH`, i.e.
exactly what an attacker has — no SDK, no app code in the way):

| | before deploy | after deploy |
|---|---|---|
| `emailVerified := true` | **HTTP 200, accepted** | `PERMISSION_DENIED` |
| `queuePosition := 1` | **HTTP 200, accepted** | `PERMISSION_DENIED` |
| `isConfirmed`, `totalReferrals`, `verificationCode`, `verifiedAt` | — | `PERMISSION_DENIED` |
| `firstName`, `isSubscribed`, `waitlistIds` | accepted | still accepted |

Before the deploy an anonymous request marked itself email-verified and took queue
position 1. That is the vulnerability, reproduced rather than assumed, and then
closed. A post-lockdown signup still creates its member doc, captures its custom
`company` field, and gets its OTP queued (`requestFormOtp`, `auth: MISSING`).

**Not verifiable locally:** the OTP plaintext. It is hashed in `form_otps` and
deliberately never logged, so completing the happy path in a browser needs the
rendered email from the admin UI. The OTP-required *rejection* branch and the
happy-path writes are covered by `finalizeFormSignup.spec.ts` (17 tests) instead.

**Item 6 (unsubscribe via token flow) is not started.**

**Found while verifying — email log statuses were mislabelled.** The logs table
showed a green **"Success"** for messages whose status was `skipped`, i.e. the ones a
`queueEmail` gate deliberately withheld. The detail drawer said "Skipped" and the
health strip counted the skips, so the same page contradicted itself. Two causes:

- `global-table` was the only column type that ignored `transformFn` and read
  `row[col.key]` directly. `'skipped'` is a truthy string, so a boolean badge read it
  as true. Fixed, plus an optional `badgeConfig.textFn` for columns with more than
  two states.
- `status-badge.ts` had no tone for `success`, `retrying`, `deferred`, `suppressed`
  or `skipped`, so they all fell back to neutral. Added — with `skipped` neutral on
  purpose: withheld is neither a success nor a delivery failure.

This matters beyond cosmetics: anyone following the testing guide would have read
"Success" and concluded an email was delivered when a gate had stopped it.

**Objective:** the two built-in waitlist emails converge on the unified system: welcome =
first sequence step; OTP = the form's double-opt-in email, generated server-side.

### Scope
1. **Day-0 fast path:** when `addContactToLists` enrolls a contact and the campaign's step 0 has `delayHours: 0`, send immediately (still via `queueEmail`, `source:'drip'`) instead of waiting for the 15-min scheduler. Idempotent with the scheduler (enrollment doc is the lock).
2. **Tag-context provider:** drip sends resolve per-list context; for form-fed lists, a provider loads the member funnel doc so `##POSITION## ##REFERRAL_LINK## ##LEADERBOARD_LINK## ##WAITLIST##` resolve. Designed as a registry (list-type → context resolver) so future list types (e.g. `##PLAN##` for `all-customers`) plug in.
3. **Welcome migration:** callable `migrateWelcomeToSequences` — for each form-fed list, create a "Welcome sequence" campaign (active, one day-0 step) whose template is that waitlist's existing welcome template (or the global default). Existing direct welcome trigger (`onWaitlistUserUpdate` / `onWaitlistUserCreate` welcome paths) gains a per-list `welcomeMigrated` guard: once the sequence owns the list, the trigger no-ops. Full trigger deletion in U7. Gating per U-D7: sequences run under `features.drips`.
4. **Server-side form OTP:** callable `requestFormOtp` (mirrors `requestSignupOtp`: hashed code + 10-min expiry + max-5 attempts + 60s resend throttle, stored server-side) and `verifyFormOtp`. Public waitlist flow swaps to the callables; client-side `generateOtp` and the `verificationCode` plaintext writes are removed. This **structurally fixes the double-OTP bug** (the two update-triggers that both fired on `verificationCode` changes are deleted). OTP email = the form's per-form template (`${waitlistId}_waitlist_verify_otp_email`, global default fallback) — per-form content/layout preserved (U-D5).
5. **Security-rules lockdown (required, not optional):** with verification server-side, remove `emailVerified`, `verificationCode`, `verificationExpires`, `verifiedAt`, and `totalReferrals` from the `Waitlists/{id}/users` unauth-update whitelist in `firestore.rules` — today any client can self-verify by writing these fields. Verification state becomes functions-only.
6. **Public unsubscribe pages:** `unsubscribe-handling/` currently writes `WaitlistedUsers` + the member subcollection **from the client**; swap to the token-based `handleUnsubscribe` HTTP flow (the routes stay as thin confirmation views), so consent writes are server-only before U6 retires the collection.

### ✅ Manual verification
1. `npm run test` green (fast-path idempotency, tag-context resolution, OTP hash/expiry/attempts/throttle, welcome-guard matrix).
2. Dev project: verify a new signup → welcome EmailLog appears **within seconds** (day-0 fast path), `source:'drip'`; exactly **one** welcome (direct trigger no-ops); scheduler run 15 min later sends nothing extra.
3. Welcome content: `##POSITION##`/`##REFERRAL_LINK##`/`##LEADERBOARD_LINK##` resolved correctly for the specific member.
4. Add a day-3 step to the same sequence → verify a signup → welcome now, enrollment `nextSendAt` = +3 days. Pause the sequence → new verifications get no welcome until resume (expected: welcome is now campaign-governed).
5. OTP: join a form → **one** OTP email; resend within 60s → throttled; wrong code ×5 → locked; correct code → verified. Join the same email from the returning-user path → still exactly one OTP (double-OTP bug gone).
6. Per-form OTP content: customize Form A's OTP template, leave Form B default → each form's OTP email shows its own content/layout.
7. **[live]** Full journey on a real provider: signup → branded OTP arrives → verify → welcome arrives instantly → unsubscribe link in welcome works and exits the sequence.
8. Kill-switch: master email off → OTP skipped-logged, signup does **not** block, verification path still completes (`confirmWithoutOtp` parity).
9. **Rules lockdown:** rules test against the dev project — an unauthenticated client attempting to write `emailVerified`, `verificationCode`, or `totalReferrals` on `Waitlists/{id}/users/{uid}` is **denied**; the legitimate signup create path still succeeds.
10. Unsubscribe: open the public unsubscribe route from an email link → confirmation completes via the `handleUnsubscribe` HTTP function; the Firestore console shows **no client-side writes** to `WaitlistedUsers` or the member subcollection; Contact consent + Suppression doc updated.

### What to expect next (U6)
All email behavior is now unified. U6 is pure data-layer consolidation: retiring the
redundant `WaitlistedUsers` collection. No user-visible change if done right — the
verification for U6 is "everything still works."

---

## Phase U6 — Retire `WaitlistedUsers` (high-risk data migration)

**Objective:** two records per person (Contact + form-member funnel doc), not three.
`Contacts/{emailHash}` takes over cross-form identity/dedup; funnel docs keep
verification/queue/referral state.

### Scope
1. **Read inventory first:** enumerate every reader/writer of `WaitlistedUsers` (join flow cross-waitlist checks, `getOptimizedLeaderboard`, referrals subcollection, `onWaitlistedUsersCreate/Update` triggers, subscriber admin page, unsubscribe path). This inventory gates the phase.
2. **Re-point reads:** cross-form existence checks → `Contacts/{emailHash}`; leaderboard + referrals → keyed on form-member docs (referrals move to `Waitlists/{id}/users/{uid}/referrals` or a flat `Referrals` collection keyed by form+contact — decide from the inventory); subscriber admin page → Contacts filtered by `source:'waitlist'`.
3. **Dual-read window:** one release where new code reads Contacts/funnel docs but falls back to `WaitlistedUsers`; writes go to the new locations only. Migration callable `migrateWaitlistedUsers` copies remaining state (referral aggregates, leaderboard links, multi-waitlist membership) onto Contacts/funnel docs.
4. **Cutover:** remove fallback reads, delete the `WaitlistedUsers` triggers, mark the collection frozen (rules: no writes). Physical deletion is a manual admin step post-verification, not automatic.
5. **Frontend surfaces owned by this phase** (from the impact map): Subscribers page → Contacts view or dropped; joined-users `deleteUser()` referral batch rewritten against the new referral home; public leaderboard/user-details pages follow the callable re-point; per-waitlist dashboard parity check (it reads funnel docs, which stay — verify `totalSignups`/referral metrics still reconcile); remove `WaitlistedUsers` from `(data)/data-constants.ts` export/import.
6. **Rules & indexes:** delete the `WaitlistedUsers` + referrals rule blocks; remove the unauth `totalSignups` increment carve-out on `Waitlists/{id}` (counts move server-side); add the `Contacts` composite index for leaderboard ordering to `firestore.indexes.json`.
7. **Callable contract:** `getOptimizedLeaderboard` keeps its name and accepts (ignores) the legacy `collectionName` param so already-deployed clients keep working; trigger deletions deploy **after** `migrateWaitlistedUsers` has run (runbook ordering).

### ✅ Manual verification
1. `npm run test` green (leaderboard/referral logic against the new source; join-flow matrix: new / returning-verified / returning-unverified / cross-form).
2. Dev project seeded with legacy `WaitlistedUsers` data: run `migrateWaitlistedUsers` → leaderboard identical before/after (snapshot compare), referral counts identical; re-run → idempotent.
3. New signup with a referral link → referrer's count increments, leaderboard order updates — with zero `WaitlistedUsers` writes (verify via the Firestore console / a read-only inspection script).
4. Returning verified user joins a second form → recognized (no OTP re-ask where policy says so), added to the second list — via Contacts lookup only.
5. Unsubscribe an old contact who exists only in legacy data (pre-backfill) → dual-read fallback resolves them; post-cutover: backfilled contact resolves.
6. Subscribers admin page shows the same population as before, sourced from Contacts.
7. Legacy client compatibility: call `getOptimizedLeaderboard` **with** the old `collectionName` param (as a deployed product would) → succeeds, param ignored, results correct.
8. Rules: unauthenticated `totalSignups` increment on `Waitlists/{id}` is now denied; per-waitlist signup counters still update (server-side).
9. Data export page no longer offers `WaitlistedUsers`; per-waitlist dashboard metrics (verification rate, referrers, source breakdown) match their pre-migration snapshot.

### What to expect next (U7)
Data model is done. U7 is the deletion pass — old composer/editor code, duplicated
constants, the dual template taxonomy — plus the final audit and the updated developer
docs (including `docs/email-testing-guide.md` refresh).

---

## Phase U7 — Consolidation, deletion & final audit

**Objective:** one template taxonomy, one editor, no dead code, docs updated. (Pairs with
email-spec Phase 8; do them together.)

### Scope
1. **One template registry:** shared source of truth for template types + categories + merge tags consumed by both `src/` and `functions/` (seeded from `src/shared/constants/email-tags.ts`); delete frontend `DEFAULT_*` HTML constants and the `dodo-payments` type duplicates; fix the `scope?: 'payments'` model mismatch.
2. **One editor:** per-form OTP/welcome template editing uses the block editor; legacy tiptap `EmailTemplateEditorComponent` deleted (legacy HTML docs open read-only with "Upgrade to blocks", per email-spec Phase 4 rules).
3. **Delete:** legacy `broadcast-email-editor/` + store, `processBroadcast` inline-recipients branch, `dedupeEmailTemplates` machinery (id normalization made it obsolete), retired welcome/OTP triggers, `WaitlistedUsers` code remnants.
4. **Source-scan tests extended** (pattern: `noDirectEmailLogWrites.spec.ts`): no `EmailLogs` writes outside `queueEmail`; no inline-recipients `BroadcastEmails` writes; no `WaitlistedUsers` references; list membership only via `addContactToLists`/`removeContactFromLists`.
5. **Docs:** update `docs/email-system.md` (developer guide) + `docs/email-testing-guide.md`; add the admin-facing **existing-deployment migration runbook** (§4 below, finalized with real callable names).

### ✅ Manual verification
1. `npm run test` green, including all new source-scan audits.
2. Grep audit: zero references to deleted components/collections outside migration code.
3. Fresh-project run (a clean Firebase project, no data): onboarding → create a form → signup → OTP → verify → welcome → broadcast from list hub → sequence step 2 — every step works from a clean slate (the boilerplate story).
4. **[live]** One full journey on a real provider as a final smoke test.
5. Run the migration runbook end-to-end on a scratch Firebase project seeded with a **copy of realistic legacy data** — the runbook alone, no tribal knowledge.

---

## 4. Migration plan for existing ArcCMS deployments

For products already running ArcCMS with live users and waitlists. Principles: **additive
first, idempotent always, dual-read before cutover, verify before delete.** All steps are
admin callables runnable from a maintenance page or the Firebase console; each logs a
summary (`processed / created / skipped / errors`).

### Ordered runbook (each step ships with its phase)

| Step | Callable | Ships in | What it does | Rollback |
|------|----------|----------|--------------|----------|
| 1 | `backfillContacts` (existing) | email Phase 3 | Users + verified waitlist members → Contacts | additive; none needed |
| 2 | `backfillFormLists` | U1 | A `Lists` doc per existing waitlist | additive |
| 3 | `normalizeWaitlistTemplateIds` | U1 | Merge dual-id template docs (admin edits win). Supports `{dryRun:true}` — returns the exact keep/remove plan without writing; run it first | pre-run export of `EmailTemplate` |
| 4 | `backfillPendingContacts` | U2 | Unverified signups → `pending` contacts | additive; pending are unmailable by design |
| 5 | `migrateTagsToContacts` | U2 | Per-waitlist `WaitlistUserTags_{id}` → global `ContactTags` (merged by label-slug), member `tags[]` → `Contacts.tags[]`, remaps each form's `defaultTagId`. Supports `{dryRun:true}`. Run **after** step 4 — it skips members with no contact yet and reports them as `membersWithoutContact`; re-run to pick them up | additive + non-destructive (legacy tags untouched) |
| 6 | `stampFormTargetLists` | U3 | `targetListIds:[waitlist-{id}]` on every waitlist doc | additive field |
| 7 | `migrateWelcomeToSequences` | U5 | Welcome sequence per form-fed list from existing templates; flips the per-list `welcomeMigrated` guard | unset the guard ⇒ direct trigger resumes |
| 8 | `migrateWaitlistedUsers` | U6 | Referral/leaderboard/identity state → Contacts + funnel docs | dual-read window is the rollback; collection frozen, not deleted |

### Deployment sequencing per upgrade
1. **Back up** (Firestore export) — mandatory before steps 3 and 8.
2. Deploy the phase's functions + rules + frontend.
3. Run that phase's callable(s); check the logged summary; re-run is always safe.
4. Run the phase's manual verification checklist (§3) against production-like data.
5. Only U5 and U6 change live behavior; both have guards (`welcomeMigrated`, dual-read) that let a deployment hold both old and new behavior per-list during rollout.

### Compatibility guarantees during migration
- Emails never double-send: welcome is either trigger-owned or sequence-owned per list, enforced by the guard flag; OTP paths are replaced atomically per deploy (callable swap).
- Pending contacts can never be marketed to — the existing consent gate enforces this without new code.
- In-flight legacy broadcasts complete under the legacy branch until U7 deletes it.
- `WaitlistedUsers` is frozen, not deleted, until an admin confirms parity (leaderboards, referral counts) and deletes manually.

---

## 5. Open items to confirm during the build

1. U3: may a form's own system list be removed from `targetListIds`, or is it always present? (Proposed: always present in v1 — simplifies history/leaderboard scoping.)
2. U5: policy for returning verified users joining a second form — re-verify or trust prior verification? (Current behavior: trust; keep, but make it a per-form setting later if needed.)
3. U6: referrals home — subcollection under the form-member doc vs flat `Referrals` collection. Decide from the read-pattern inventory at the start of U6.
4. U7: whether the Subscribers admin page survives as a Contacts-filtered view or is dropped in favor of the list hub Members tab.
