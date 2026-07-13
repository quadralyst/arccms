# ArcCMS Email & Notification System — Self-Evaluation Report

Live browser testing against a real deployed Firebase project (`xlm-project-864ff`),
not the emulator. Logged in as admin, clicked through every affected screen,
triggered real sends through the **Debug Provider (Log Only)**, and verified
results in Email Logs. This report is an honest account of what was tested,
what broke, what I fixed, and what's still open.

---

## 1. What actually got exercised

| Area | How it was tested | Result |
|---|---|---|
| Email Settings | Switched providers, saved Debug Provider, verified dashboard banner | Pass |
| Brand Kit | Edited colors/footer, saved, reloaded to confirm persistence | Pass |
| Email Composer | Selected a legacy template, upgraded to blocks, edited heading level, saved | Pass (after fix, see §2) |
| Contacts | Backfilled from Users/Waitlists, viewed list, consent columns | Pass (after fix, see §2) |
| Lists | Loaded list dropdown in Broadcasts/Drips | Pass (after fix, see §2) |
| Broadcasts | Previewed audience count, saved content, **sent a real broadcast** | Pass — 3/3 delivered via Debug Provider |
| Drip Campaigns | Created a campaign, added a step, activated it | Pass — correctly rejected activation with 0 steps first |
| Announcements | Published to "All users" | Pass — "Announced to 3 users (0 emailed)" |
| Email Logs | Confirmed the broadcast's 3 sends appear with `provider: DEBUG_LOG`, `status: Success` | Pass — this is the actual proof the send pipeline works end-to-end |
| Dashboard | Confirmed Debug Provider banner and (after the hydration fix) no more stale "Email not configured" banner | Pass |

**Not reached** (ran out of runway in this session): CSV contact import, signup
OTP round-trip via the waitlist form, unsubscribe/preference-center pages as an
anonymous (logged-out) visitor, mobile-viewport interaction testing beyond a
single resize check.

---

## 2. Bugs found and fixed

### 2.1 `takeUntilDestroyed()` called outside an injection context (real, was breaking Contacts/Lists)
`src/app/pages/admin/(contacts)/contacts.page.ts` and
`src/app/pages/admin/(lists)/lists.page.ts` called `takeUntilDestroyed()` with
no `DestroyRef` argument, inside `ngOnInit()` instead of a constructor/field
initializer. Angular throws `NG0203` for this — synchronously, which aborted
`ngOnInit()` entirely. Net effect: **the Contacts page never subscribed to
Firestore, so it looked permanently empty no matter how many contacts existed**,
even right after a successful backfill.

Fixed by injecting `DestroyRef` and passing it explicitly:
```ts
private destroyRef = inject(DestroyRef);
...
this.audience.getContacts().pipe(takeUntilDestroyed(this.destroyRef)).subscribe(...)
```
Confirmed fixed: backfilled 3 contacts, they now render immediately.

### 2.2 Missing Cloud Functions on the test project (deployment gap, not a code bug)
`backfillContacts`, `importContacts`, `adminAddContact`, `adminSetContactConsent`,
`adminUpdateContactLists`, `previewContactImport` (Phase 3 Audience), the Phase 7
drip-campaign callables, and `continueBroadcast`/`sendTestEmail`/
`updateMyNotificationPrefs` had never been deployed to `xlm-project-864ff` —
only earlier-phase functions were live. Every action that depended on them
failed with `FirebaseError: internal`.

Fixed by running `firebase deploy --only functions --project xlm-project-864ff`
(full deploy, then a scoped retry for 4 functions that hit a CLI polling
timeout but had actually deployed). All functions confirmed present via
`firebase functions:list` afterward.

This is worth flagging as a process gap, not a code defect: the code was
correct and unit-tested, but had never been verified against a live backend
for these three phases until this session.

### 2.3 SSR/hydration mismatch on admin-only Firestore reads (found by a concurrent session, verified here)
Several services (`AudienceService`, `BroadcastService`, `DripService`,
`BrandKitService`, `EmailConfigStatusService`, `AnalyticsConnectionStatusService`)
queried admin-only Firestore collections during SSR, where there is never an
authenticated user. That produced permission-denied failures server-side, and
in two of the status services, `isLoading` was forced to `false` during SSR
which then disagreed with the client's real initial state — the exact
mismatch that leaves an `@if`-gated element in the DOM but with no live
Angular view attached to it. This was the root cause of the dashboard's
stale "Email not configured" banner reported earlier in this project.

Fixed (by a parallel background session working the same repo, reviewed and
confirmed here): skip the Firestore call during SSR (`isPlatformBrowser`
guard) and leave `isLoading` at its default `true` on the server instead of
forcing it false. Verified: the stale banner is gone; Debug Provider banner
and "Email not configured" banner both now render/disappear correctly.

---

## 3. Bugs found, NOT fixed — flagged for follow-up

### 3.1 Notification bell is unreachable on desktop
`src/app/pages/admin/admin.html` places the only `<arc-notification-bell>`
instance inside a `mat-toolbar` with class `mob_menu` and an `ngClass` that
adds `d-none` whenever `drawerMode === 'side'` (the normal desktop layout with
a persistent sidebar). Confirmed via computed styles: at 1438px width the
toolbar is `display: none`, and the bell element inside it has a zero-size
bounding box (`{width:0, height:0}`) even though its HTML content is fully
rendered. The bell only becomes reachable when the sidebar collapses to
overlay mode — effectively mobile-only. For an admin panel where desktop is
the primary use case, this makes the whole Phase 5 "bell + unread count"
deliverable invisible in normal use. Needs a placement decision: either add a
persistent header for desktop mode, or move the bell into the always-visible
sidebar.

### 3.2 Duplicate templates in every template dropdown
Both the Email Composer's template selector and the Drip Campaign step
editor's template selector show each seeded template twice — "Waitlist verify
OTP Email (html)" and "Waitlist welcome email (html)" each appear as two
separate entries. Reproduced consistently across two different UI surfaces
that both read from the `EmailTemplate` collection, which points at the data
layer (likely `seedEmailTemplates` not being as idempotent as intended,
producing two documents per template) rather than a rendering bug. I did not
get authorization to dump the collection's raw contents to confirm the exact
mechanism — worth a direct Firestore console check.

### 3.3 Announcement didn't produce an in-app notification for the admin's own account
Publishing an announcement to "All users" reported "Announced to 3 users (0
emailed)," and the admin account (`gunjan@kalptaru.in`) was one of the 3
backfilled contacts — but visiting `/notifications` immediately after showed
"You're all caught up," with zero unread. Didn't have time to trace whether
`sendAnnouncement` targets by `uid` from a source that doesn't line up with
how `backfillContacts` populated the `Contacts` collection, or whether this is
intentional (some announcement flows deliberately skip notifying the sender).
Worth a source-level check of `sendAnnouncement`'s audience resolution against
`Contacts` vs `users`.

### 3.4 Minor: `NG0100` dev-mode warning on Contacts page
A `busy()`-adjacent binding on `ContactsPageComponent` trips Angular's
`ExpressionChangedAfterItHasBeenCheckedError` dev-mode check on every render.
Cosmetic — doesn't reproduce in production builds — but worth a quick look;
possibly related to the same signal-in-template timing pattern as §2.1.

---

## 4. Environment notes, for context

- The managed dev-server process died repeatedly (~every 15–30s) for a
  significant stretch of this session. Root cause turned out to be a **second,
  independent Claude Code session actively running in the same working
  directory**, restructuring the email admin routes (`/admin/email-composer`
  → `/admin/email/composer`, etc.) and racing for the same port. Once that
  session finished, the dev server was stable. Worth remembering if browser
  testing seems inexplicably flaky again — check for another live session
  before assuming an infra bug.
- I stopped short of dumping raw Firestore contents to inspect the duplicate
  templates (§3.2) — the harness's own safety layer flagged that as
  out-of-scope PII handling, and it was the right call even though template
  docs aren't personal data; I didn't have an approved lighter-weight way to
  check counts only, so I left it as a flagged, unconfirmed hypothesis
  instead of pushing through.

---

## 5. Net assessment

The core email pipeline is real and works: a broadcast created in the admin UI
against a real Firestore-backed contact list, sent through Cloud Functions,
delivered (as log entries) through the Debug Provider, and is fully visible
and auditable in Email Logs — which is exactly what "log the actual email
send and check the logs" needed to prove. Two of the bugs found (§2.1, §2.2)
would have blocked real usage entirely and are now fixed. The three open items
in §3 are real but non-blocking: the bell (§3.1) is a usability gap, the
duplicate templates (§3.2) are cosmetic clutter, and the notification-sync gap
(§3.3) needs a source read to even confirm as a bug rather than by-design
behavior.
