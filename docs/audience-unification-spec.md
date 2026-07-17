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
| U-D11 | Migration style | Every phase ships with an **idempotent admin callable** for backfill (precedent: `backfillContacts`). Additive first → dual-write/dual-read → cutover → delete. Emulator-verified before running on live data. |

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

### Testing reality: there is no emulator wiring

The app has **no `connectFirestoreEmulator`/`connectFunctionsEmulator` calls** — `npm run dev`
serves the frontend locally but talks to the **real** Firebase project (`xlm-project-864ff`
by default, per `.firebaserc`). Cloud Functions therefore run **only from the last deploy**:
editing `functions/src/**` has no effect on local browser testing until

```
cd functions && npm run build
firebase deploy --project default --only "functions:<name>,..."
```

This caused a false "the fix doesn't work" during U1 (2026-07-17) — new waitlists showed no
list because the *old* `onWaitlistsCreate` was still live in the cloud. **Every phase that
changes functions must deploy before browser testing**, and each phase's manual checklist
assumes a deploy has happened. (Wiring up the emulator suite, so phases can be verified
without touching a shared project, is worth considering as a separate task.)

Useful verification pattern (used in U1): a node script that reuses the Firebase CLI
credentials exactly as `functions/scripts/call-seed.cjs` does, imports the **compiled**
helper from `functions/lib/**`, and asserts Firestore state — this exercises real product
code against the real project without needing an admin browser session.

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

> Conventions: every phase ends with **Manual verification** (run against the Firebase
> emulator suite; steps marked **[live]** need a real provider) and **What to expect
> next**. `npm run test` from repo root (Vitest) must be green at every phase boundary.
> Every backfill is an admin-only callable, idempotent, and logged.
> Every phase consults the **impact map (§2.1)** — surfaces it owns are part of its
> verification. Before refactoring a surface with no existing spec file, write a
> characterization test of current behavior first (same phase).

---

## Phase U1 — Lists become real: eager creation + data hygiene

**Status:** built 2026-07-15 (`feat/audience-unification`) — awaiting the emulator/manual
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

### ✅ Manual verification
1. `npm run test` green.
2. Emulator: create a new waitlist in the admin → **without any signup**, Audience → Lists shows it (memberCount 0, system/form badge). Rename the waitlist → list name follows.
3. Emulator with pre-seeded old-style data: run `backfillFormLists` → every existing waitlist has a list; run it twice → no duplicates, counts unchanged.
4. Run `normalizeWaitlistTemplateIds` on seeded data containing both id schemes for the same waitlist+type → one doc remains per (waitlist, type), content = the admin-edited version; re-run → no-op.
5. Create another new waitlist → exactly 2 template docs seeded, ids `${waitlistId}_${type}`, no duplicates on trigger retry.
6. Delete a waitlist that has verified members → its `waitlist-{id}` list is removed and the listId disappears from every member contact's `listIds` (no orphaned lists or membership).

### What to expect next (U2)
Lists exist but only show **verified** members. U2 makes every signup visible immediately
as a *pending* contact, and moves tags onto the contact — after U2 the Audience section is
the complete, truthful picture of everyone who ever signed up.

---

## Phase U2 — Pending contacts at signup + global tags

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

### ✅ Manual verification
1. `npm run test` green (new consent-matrix and never-downgrade tests).
2. Emulator: join a waitlist, **don't verify** → contact appears instantly (Pending badge), list memberCount includes them, header shows `0 subscribed · 1 pending`.
3. Send a broadcast to that list → summary `0 sent / 1 skipped`, EmailLogs skip doc `skipReason:'unsubscribed'` (pending ⇒ not mailable).
4. Verify the OTP → contact flips to Subscribed; broadcast again → delivered (emulator: `pending` EmailLog created).
5. Returning already-subscribed contact joins a second waitlist → consent stays `subscribed` (no downgrade); they're now on both lists.
6. Run `migrateTagsToContacts` on seeded data → tags visible on contacts, filterable; re-run → idempotent. New signup on a form with `defaultTagId` → contact carries the tag.
7. Run `backfillPendingContacts` → historical unverified signups appear as pending; re-run → no dupes.
8. App-user regression: register a normal app account → its contact is created with the **existing** consent behavior (not `pending`) — the pending rule applies to form signups only.
9. Deploy `firestore.indexes.json` to the emulator → the Contacts consent-filtered queries (list + consent) run without missing-index errors.
10. Data export page lists `Contacts`, `Lists`, `Tags`; export → import round-trip on the emulator preserves consent and list membership.

### What to expect next (U3)
Contacts and lists are truthful, but each form is still hard-wired 1:1 to its own list.
U3 breaks that coupling: forms declare which list(s) they feed, enabling several forms
into one list and setting up the per-list email surfaces of U4.

---

## Phase U3 — Form → List decoupling

**Objective:** a form is a capture surface that feeds configurable list(s); "waitlist" is
just a form with gamification on.

### Scope
1. **Model:** `Waitlists/{id}.targetListIds: string[]` (default `[waitlist-{id}]`, stamped by callable `stampFormTargetLists` for existing docs). All membership writes on signup/verify route through `targetListIds`.
2. **Gamification flag:** `gamificationEnabled: boolean` (default true for existing waitlists) — gates referral link/leaderboard/queue-position UI + tags in emails. A form with it off is a plain signup form.
3. **Admin UI reframe:** nav section becomes **Signup Forms**; form edit drawer gains a "Feeds lists" multi-select (its own system list preselected, non-removable for now) and the gamification toggle. No Firestore rename.
4. **Drip/broadcast interplay:** joining via a form enrolls the contact in sequences of **every** target list (already the semantics of `addContactToLists`).

### ✅ Manual verification
1. `npm run test` green (membership-routing tests).
2. Emulator: create manual list "Beta users"; point Form A and Form B both at it (plus their own lists). Sign up + verify on each → both contacts on "Beta users", memberCount 2; each also on their form's own list.
3. Same person signs up via both forms → one contact, member of the union of lists, no double-count.
4. Toggle gamification off on a form → public page shows no referral/leaderboard step; signup still works; contact/list behavior unchanged.
5. Run `stampFormTargetLists` → every existing waitlist doc has `targetListIds:[waitlist-{id}]`; re-run → no-op.

### What to expect next (U4)
Every list — manual or form-fed — is now a first-class audience. U4 gives each list the
industry-standard workspace: Members / Broadcasts / Sequence tabs, and one shared audience
picker (multi-list include/exclude + filters) across broadcasts and announcements. The
legacy per-waitlist broadcast composer is retired here.

---

## Phase U4 — List hub (Members | Broadcasts | Sequence) + one audience model

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
1. `npm run test` green (multi-list resolution: include ∪, exclude minus, dedup; announcement audience parity).
2. Emulator: list hub for a form-fed list → Members shows subscribed+pending correctly; Broadcasts tab empty; Sequence tab shows existing campaigns.
3. Compose from the Broadcasts tab → audience preselected; preview count matches subscribed members; send → summary sent/skipped correct.
4. Multi-list: broadcast to include [waitlist-A, waitlist-B], exclude [all-customers] → a contact on both A and B gets **one** email; a customer on A gets none.
5. Announcement targeting a list via the shared picker → same preview count as a broadcast to that list.
6. Old waitlist Broadcast tab → lands on the list hub. Attempt to write a legacy inline-recipients broadcast doc (emulator script) → rejected/parked with a clear error, not silently processed.
7. Main admin dashboard: total / 7-day / verified counts and recent signups now match the Contacts data (cross-check against a seeded dataset with known counts); per-waitlist cards show `Lists.memberCount` + pending. **Zero reads of `WaitlistedUsers` from the dashboard** (verify via emulator request log).
8. Side-navbar per-waitlist submenu links land on the list hub; Subscribers item shows its deprecation state.

### What to expect next (U5)
The surfaces are unified; U5 unifies the *behavior*: welcome becomes the sequence's day-0
step (instant), and the per-form OTP becomes a true server-side double-opt-in email. After
U5, the old direct welcome trigger and client-side OTP generation are gone.

---

## Phase U5 — Welcome as day-0 sequence + server-side per-form OTP

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
2. Emulator: verify a new signup → welcome EmailLog appears **within seconds** (day-0 fast path), `source:'drip'`; exactly **one** welcome (direct trigger no-ops); scheduler run 15 min later sends nothing extra.
3. Welcome content: `##POSITION##`/`##REFERRAL_LINK##`/`##LEADERBOARD_LINK##` resolved correctly for the specific member.
4. Add a day-3 step to the same sequence → verify a signup → welcome now, enrollment `nextSendAt` = +3 days. Pause the sequence → new verifications get no welcome until resume (expected: welcome is now campaign-governed).
5. OTP: join a form → **one** OTP email; resend within 60s → throttled; wrong code ×5 → locked; correct code → verified. Join the same email from the returning-user path → still exactly one OTP (double-OTP bug gone).
6. Per-form OTP content: customize Form A's OTP template, leave Form B default → each form's OTP email shows its own content/layout.
7. **[live]** Full journey on a real provider: signup → branded OTP arrives → verify → welcome arrives instantly → unsubscribe link in welcome works and exits the sequence.
8. Kill-switch: master email off → OTP skipped-logged, signup does **not** block, verification path still completes (`confirmWithoutOtp` parity).
9. **Rules lockdown:** emulator rules test — an unauthenticated client attempting to write `emailVerified`, `verificationCode`, or `totalReferrals` on `Waitlists/{id}/users/{uid}` is **denied**; the legitimate signup create path still succeeds.
10. Unsubscribe: open the public unsubscribe route from an email link → confirmation completes via the `handleUnsubscribe` HTTP function; emulator log shows **no client-side writes** to `WaitlistedUsers` or the member subcollection; Contact consent + Suppression doc updated.

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
2. Emulator seeded with legacy `WaitlistedUsers` data: run `migrateWaitlistedUsers` → leaderboard identical before/after (snapshot compare), referral counts identical; re-run → idempotent.
3. New signup with a referral link → referrer's count increments, leaderboard order updates — with zero `WaitlistedUsers` writes (verify via emulator firestore log).
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
3. Fresh-project run (emulator, no data): onboarding → create a form → signup → OTP → verify → welcome → broadcast from list hub → sequence step 2 — every step works from a clean slate (the boilerplate story).
4. **[live]** One full journey on a real provider as a final smoke test.
5. Run the migration runbook end-to-end on an emulator project seeded with a **copy of realistic legacy data** — the runbook alone, no tribal knowledge.

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
| 5 | `migrateTagsToContacts` | U2 | Per-waitlist tags → global tags on contacts | additive |
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
