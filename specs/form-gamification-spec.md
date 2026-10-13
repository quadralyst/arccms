# Signup Forms Without Gamification: Spec

**Status:** built 2026-10-13 (G1 to G6) on `feat/form-gamification`, not merged, pushed or deployed. Decided: option B, with the default-language strings file applying to the whole page.
**Branch:** `feat/form-gamification`, cut from `dev` (cd31ca2).
**Scope:** Arc CMS signup forms become plain, generic forms everywhere. Any page can embed
`<form data-waitlist-form data-waitlist-id="...">` and Arc CMS handles join, the emailed code,
confirmation, the contact and its lists, and the welcome email. Queue position, referral codes and
links, the leaderboard and the "Move up faster!" copy either become a strict opt-in (option A) or
leave Arc CMS (option B). The English panel text becomes overridable.

**Inputs from the owner (2026-10-13):** no site uses referrals today. Existing forms need no
protection: they will be updated by hand, so a form with no saved setting may change behaviour.

**Out of scope:** renaming "waitlist" in collections, routes, function names or CSS classes; the
contact, list, tag and OTP flows (unchanged); a rebuilt referral feature for any one app.

---

## 1. Why

The form's **Gamification (referrals & leaderboard)** switch only reaches the form's own page,
`/waitlist/{form}`. On site pages (home page, templates, static pages) the panels drawn by
`public/assets/js/arc-site.js` always show the position, total signups, referral code and link and
the leaderboard button. The default welcome email always carries a Referral link button and a
Leaderboard button. `docs/website/forms.html` documents this. A downstream site (arccms-website)
hides the panels with CSS on `class="plain-signup"` forms as a stopgap.

The panel text ("You're on the list!", "You're already on the waitlist.") can be translated per
language but not reworded in the default language.

---

## 2. Inventory: what gamification touches today

### 2.1 Cloud Functions

| File | What it does for gamification |
|------|-------------------------------|
| `functions/src/waitlists/joinForm.ts` | Every new member gets `referralCode` (generated), `referralLink` (`{site}/?ref=CODE`), `leaderboardLink` (`{site}/leaderboard/{form}/{member}`) and `queuePosition: 0`. All three links are returned to the browser. |
| `functions/src/waitlists/finalizeFormSignup.ts` | Counts confirmed members to set `queuePosition` and the form's `totalSignups`; stores `referredBy`; returns `queuePosition`. |
| `functions/src/waitlists/creditReferral.ts` | Callable: finds the referrer by `referralCode`, writes a `referrals` record under them. Called by `arc-site.js` and `waitlist.service.ts`. |
| `functions/src/waitlists/referral/onReferralCreate.ts`, `onReferralUpdate.ts` | Triggers on `Waitlists/{form}/users/{member}/referrals/{id}`: increment `totalReferrals`. |
| `functions/src/waitlists/waitlist-details/onWaitlistUserDelete.ts` | Trigger whose only job is to decrement the referrer's count and remove the referral record. |
| `functions/src/utils/referralHelper.ts` | `incrementReferralCounts`, `decrementReferralCounts`. |
| `functions/src/waitlists/publicWaitlistViews.ts` | `getPublicLeaderboard` (public leaderboard, masked emails) and `getPublicMemberView` (a member's own page: position, referral history). Also exposes `gamificationEnabled` and `startingPoint` in the public form fields. |
| `functions/src/waitlists/leaderboard/getLeaderBoardData.ts` | `getOptimizedLeaderboard` callable. |
| `functions/src/email-core/migrateWaitlistedUsers.ts` | Admin callable from U6 whose only job is moving old referral records to the new path. |
| `functions/src/waitlists/ensureWaitlistExists.ts` | Creates a form with `startingPoint: 1000` and no `gamificationEnabled`, so it counts as on. |
| `functions/src/waitlists/waitlist-details/onWaitlistUserUpdate.ts` | Legacy welcome send; carries `referralLink`, `leaderboardLink`, `queuePosition` into the email via `createWelcomeEmailLog`. |
| `functions/src/utils/emailTemplateHelper.ts` | `createWelcomeEmailLog` puts `referralLink`, `leaderboardLink`, `position` on the email log. |
| `functions/src/email-core/dripContext.ts`, `dripSend.ts` | The welcome as a day-0 sequence step loads the member doc for `referralLink`, `leaderboardLink`, `position`. |
| `functions/src/mail-config/mailConfig.ts` | Maps `##REFERRAL_LINK##` and `##LEADERBOARD_LINK##`. |
| `functions/src/email-core/defaultTemplates.ts` | The per-form default welcome body: "see your rank on the leaderboard", a Referral link button and a Leaderboard button. Seeded per form by `onWaitlistsCreate` / `ensureWaitlistTemplates`. |
| `functions/src/features/forms.ts` | Exports all of the above under the `forms` feature. |

The `waitlist.joined` event (`contactSync.ts`) carries only `{ waitlistId }`: nothing to change.

### 2.2 The site script

`public/assets/js/arc-site.js`:
- `?ref=` capture into `localStorage` `arc_referral` (30 days), `referralLinkFor`.
- `showVerify`: the "Referral code (optional)" box (`.waitlist-referral-input`) when no stored code.
- After finalize: calls `creditReferral`.
- `showSuccess`: position, total signups, "Move up faster!", referral code and link with copy
  buttons, leaderboard button.
- `showExisting`: position (with a hard-coded English "Your Position"), code, link, leaderboard button.
- It already reads the form doc (`isActive`, `otpEnabled`) but never reads `gamificationEnabled`.

### 2.3 Angular pages

| Area | Files |
|------|-------|
| Form page `/waitlist/{form}` | `pages/waitlist/waitlist.component.{ts,html}` (honours the switch with `!== false`), `waitlist.service.ts` (`creditReferral`, leaderboard, member view), `waitlist.model.ts` |
| Leaderboard `/leaderboard`, `/leaderboard/:form`, `/leaderboard/:form/:member` | `pages/waitlist/leaderboard/*` |
| Member page `/user/:form/:member` | `pages/waitlist/user-details/user-details.component.ts` |
| Routes | `app.routes.ts`, `core/features/feature-routes.ts` (`leaderboard/**` under `forms`) |
| Admin form list | `admin/(waitlists)/waitlists.page.ts`: Leaderboard row action |
| Admin edit drawer | `edit-drawer/*`: the switch, default **on** for new forms |
| Admin form dashboard | `dashboard/waitlist-dashboard.*`: Total Referrals, Referral Rate, Avg Referrals / User, Top Referrers, leaderboard link |
| Admin joined users | `joined-users/*`: Total Referrals stat, Position and Referrals columns, CSV columns; `view-user-detail/*`: position, code, referral history |
| Admin dashboard | `admin/(dashboard)/dashboard.html`: Referrals column on recent signups |
| Data viewer | `admin/(data)/data-constants.ts`: `referrals` subcollection |
| First run | `(onboarding)/onboarding-defaults.ts`: `startingPoint`, welcome text mentioning the leaderboard and its preview |
| Analytics | `shared/services/ga-tracking.service.ts`: `referral_code_used`, `referral_link_copy`, `leaderboard_view`, `queue_position` on signup complete |
| Merge tags | `shared/constants/email-tags.ts`: `##POSITION##`, `##REFERRAL_CODE##`, `##REFERRAL_LINK##` in the welcome autocomplete |

### 2.4 Rules, indexes, strings

- `firestore.rules`: member update allowlist includes `leaderboardLink` and `referredBy`; the
  `referrals` subcollection allows **unauthenticated create** and a limited update.
- `firestore.indexes.json`: two composite indexes on `users` with `totalReferrals`.
- `public/_site/strings/hi.json` and `src/assets/i18n/{en,hi}.json`: `signup_position`,
  `signup_total`, `signup_move_up`, `signup_move_up_body`, `signup_referral_code`,
  `signup_share_link`, `signup_leaderboard`, `signup_referral_placeholder`, `signup_copy`,
  `signup_copied`, `admin.dashboard.col_referrals` and the waitlist admin labels.

### 2.5 Docs and tests

Docs that describe gamification: `features/forms.html`, `website/forms.html`,
`reference/email-tags.html`, `reference/data-model.html`, `reference/cloud-functions.html`,
`reference/feature-ids.html`, `reference/glossary.html`, `operations/security-rules.html`,
`features/overview.html`, `features/analytics.html`, `features/data.html`,
`features/email-marketing.html`, `website/overview.html`, `website/home-page.html`,
`website/plan-content.html`, `app/choose-features.html`, `app/member-languages.html`,
`getting-started/what-is-arc-cms.html`, `concepts/architecture.html`, `index.html`, and the
examples `examples/arc-cms-home{,.hi}.html`.

Tests: `functions/src/__tests__/` `referralAndLeaderboard`, `publicWaitlistViews`,
`migrateWaitlistedUsers`, `joinForm`, `finalizeFormSignup`, `emailTemplateHelper`, `dripContext`,
`mailConfigAndAnalytics`, `callableAuth`, `waitlistedUsersRetired`, `contactSync`, `appAudience`;
`scripts/__tests__/arc-site-js.spec.ts`; Angular `waitlist.component`, `waitlist.service`,
`leaderboard.component`, `joined-users.page`, `view-user-detail.component`, `waitlists.page`,
`ga-tracking.service`, `language-links`.

---

## 3. What plain signup depends on

Checked one by one; nothing outside gamification needs these fields.

| Field | Used outside gamification? |
|-------|----------------------------|
| `referralCode` | No. Only `creditReferral` looks it up (needs the index). |
| `referralLink`, `leaderboardLink` | No. Only the panels and the welcome email. |
| `queuePosition` | No. Shown in panels, admin columns and `##POSITION##`. The confirmed-member **count** in `finalizeFormSignup` also sets the form's `totalSignups`, which plain forms need: the count stays, only the per-member position goes. |
| `totalReferrals`, `referrals/` | No. |
| `startingPoint` | Not read anywhere (dead field). |
| `referredBy` | Only by referral crediting. |
| Legacy default form (`waitlist-form`, `get-early-access-to-arc-cms`, `default`) | Uses the same flow; nothing in the fallback reads gamified fields. |
| Welcome email | Per form (seeded on form create). It degrades on its own: an unmapped tag resolves to an empty string. |
| Contacts, lists, tags, OTP, `waitlist.joined` | No dependency. |

So both options can switch the gamified data off without touching anything else.

---

## 4. The plain panels (both options)

What a plain form shows on any page, from `arc-site.js` and the Angular form page alike:

- **Success:** a tick, "You're on the list!", and one short line: "We'll be in touch at {{email}}."
- **Already signed up:** a tick, "You're already on the list.", the same line. No position.
- **Code step:** unchanged, without the referral box.

Class names stay stable for downstream CSS: `.waitlist-verify-step`, `.waitlist-success-step`,
`.waitlist-existing-step`, `.waitlist-otp-input`, `.waitlist-verify-btn`, `.waitlist-resend-btn`,
`.waitlist-back-btn`, `.waitlist-inline-message`. New, so sites can style the parts:
`.waitlist-success-icon`, `.waitlist-success-title`, `.waitlist-success-text`.
Removed under B (kept under A, shown only for gamified forms): `.waitlist-stat-number`,
`.waitlist-leaderboard-btn`, `.waitlist-copy-input`, `.waitlist-copy-btn`, `.waitlist-referral-input`.
CHANGELOG.md lists both.

Once deployed, arccms-website can drop its `.plain-signup` CSS.

---

## 5. Options

### Option A: gamification strictly opt-in

- **Switch:** `gamificationEnabled` defaults to **off** and a missing value means off, everywhere
  (edit drawer, `ensureWaitlistExists`, first run, the form page's `showGamification`).
- **arc-site.js:** reads `gamificationEnabled` from the form doc it already loads. Off: plain panels,
  no referral box, no `?ref=` capture, no `creditReferral` call. On: today's panels.
- **Server:** `joinForm` and `finalizeFormSignup` write the referral fields and position only when on.
  Referral functions, leaderboard, member view, rules and indexes stay.
- **Welcome email:** the default body is plain. A gamified form is seeded with today's body; a form
  switched on later gets a note in the drawer: "Add ##REFERRAL_LINK## and ##LEADERBOARD_LINK## to the
  welcome email."
- **Admin:** referral metrics, Top Referrers, Position and Referrals columns and the Leaderboard
  action show only for gamified forms.

| | |
|---|---|
| **Effort** | About 2 to 3 days. Touches most files in section 2 with an `if`, deletes nothing. |
| **Kept** | All of section 2. |
| **Deleted** | Nothing. |
| **Risks** | Two paths in every panel, the form page, two functions, the email seed and four admin screens, tested both ways. Public endpoints (`getPublicLeaderboard`, `getPublicMemberView`) and an unauthenticated `create` on `referrals` stay deployed on every install for a feature nobody uses. Off-vision code keeps needing upkeep in every later change to forms. |

### Option B: remove gamification, keep plain signup forms

**Deleted:**
- Functions: `creditReferral`, `getPublicLeaderboard`, `getPublicMemberView`,
  `getOptimizedLeaderboard`, `onReferralCreate`, `onReferralUpdate`, `onWaitlistUserDelete`,
  `migrateWaitlistedUsers`, and `referralHelper.ts`.
- Pages: the leaderboard and member pages, their routes become redirects (below).
- Admin: the switch, referral metrics, Top Referrers, Position and Referrals columns and CSV
  columns, the referral history in the user detail, the Leaderboard row action, the main
  dashboard's Referrals column, the `referrals` entry in the data viewer.
- `arc-site.js`: referral capture, referral box, `creditReferral` call, stats, copy rows, leaderboard
  button.
- Merge tags `##POSITION##`, `##REFERRAL_CODE##`, `##REFERRAL_LINK##`, `##LEADERBOARD_LINK##` from the
  registry and autocomplete. Left unmapped, they resolve to an empty string.
- GA events `referral_code_used`, `referral_link_copy`, `leaderboard_view`, and the position on
  `waitlist_signup_complete`.
- The two `totalReferrals` indexes, the `referrals` rules block (falls to the default deny), and
  `leaderboardLink` and `referredBy` from the member update allowlist.
- `startingPoint` from the defaults; `gamificationEnabled` from the model and public fields.
- The `signup_*` and admin translation keys listed in 2.4.

**Kept:** join, code, finalize (still counting `totalSignups`), contact sync and lists, default tag,
OTP and welcome templates, the `waitlist.joined` event, the legacy default form fallback.

**Migration for existing installs (degrades, never breaks):**

| What is out there | What happens |
|-------------------|--------------|
| `queuePosition`, `referralCode`, `referralLink`, `leaderboardLink`, `totalReferrals`, `referredBy` on member docs | Left in place, never read or written again. No cleanup script: the data is inert and an admin can still see it in the data viewer's raw document. |
| `referrals` subcollections | **Deleted once.** Each record holds someone else's email address (`referredEmail`), and `onWaitlistUserDelete` is the only code that removes it when that person is deleted. Without it, a deleted person's address would stay behind under their referrer. A one-off script, `npm run forms:remove-referrals` (dry run unless `--apply`), deletes every `referrals` record through a collection group query. Until it runs, rules deny client access. |
| `/leaderboard/{form}/{member}` and `/user/{form}/{member}` links in sent emails | Redirect to the form page `/waitlist/{form}`; `/leaderboard` alone redirects to `/`. Someone who enters their email there sees "You're already on the list." |
| `?ref=CODE` links already shared | Land on the page as normal; the parameter is ignored. `arc-site.js` removes a stale `arc_referral` key on load. |
| Per-form welcome templates still holding the old default body | Upgraded to the new plain body by the same "untouched system template" rule the subject upgrade uses, matched on the old body text. Edited templates are left alone, and their referral and leaderboard buttons render with an empty link until an admin edits them; the CHANGELOG and the forms docs say so. |
| Deployed functions that no longer exist | A full functions deploy deletes them. For targeted deploys, the deploy notes list one `firebase functions:delete` command per removed function. |
| Indexes | Removed from the file; Firebase keeps them until `firebase deploy --only firestore:indexes --force`, which the deploy notes mention as optional. |

| | |
|---|---|
| **Effort** | About 3 to 4 days, mostly deletion: roughly 3,400 lines in whole files go, plus edits across the files in section 2. Docs are the largest part. |
| **Risks** | One-time deploy on each install (functions delete, rules). Old emails' buttons point to a redirect. Any install that quietly used referrals would lose them, which the owner has ruled out. Bringing gamification back later means rebuilding it, ideally as an add-on in an app's custom space. |

### Recommendation: B

Earlier the lean was A, on the assumption that someone might rely on referrals. With no site using
them and existing forms needing no protection, B is the better end state:
- **Smaller attack surface.** It removes two public callables that read member data and an
  unauthenticated write path on `referrals`, on every install.
- **One flow, not two.** Every later change to forms is tested one way.
- **It matches the vision.** Plain, generic forms, with nothing to explain or switch off.
- **A costs almost as much.** Its effort is close to B's because it must touch the same files to add
  the conditions.

---

## 6. Overriding the English panel text (both options)

Today `arc-site.js` reads `signup_*` and `contact_*` keys from `data-strings`, filled at publish from
the page's language strings file, but only for languages other than the default
(`deployHomePage`, `deployContentPage`, `deployContentListPage` pass `{}` for the default language;
`deployStaticPage` passes nothing at all).

Proposal, in order of precedence:

1. **Per form, on the page.** Optional attributes on the form element:
   `data-waitlist-success-title`, `data-waitlist-success-text`, `data-waitlist-existing-title`,
   `data-waitlist-existing-text`. For a page with two forms that need different words ("Thanks for
   registering for the webinar"). No admin UI. Placeholders are `{name}` and `{email}`, single
   braces, because a content template empties every `{{ ... }}` its item does not fill when it is
   published (built 2026-10-13); `{{ email }}` also works where it survives.
2. **Per site, per language.** The strings file works for the default language too:
   `src/custom/site/strings/en.json` (named after the default language code), with the same keys as
   the translations. Arc CMS still ships no English file, so nothing changes for a site without one.
3. **Built-in English**, as today.

Strings file texts use `{{ email }}` and `{{ name }}`, which `t()` already supports.

Decided (G-D4): the default-language file applies to the whole page (`data-arc-t` template text and
the legal and contact notices as well as the panels), so a strings file means the same thing in every
language. With no English file shipped, existing sites are unchanged.

`deployStaticPage` also starts passing the page's strings, so static pages (default language only)
take the default-language file like every other page.

The app's previews (home, content, list and static pages) also start giving `arc-site.js` the page's
`signup_*` and `contact_*` strings, as publishing does; before, a preview's panels were always English.

**Deploy order (found in G6).** The old Angular form page reads the member through
`getPublicMemberView`, which this change deletes, and the old `arc-site.js` on published pages
still draws a position and calls `creditReferral`. The new frontend works with the old functions
(it ignores the extra fields), so deploy the website first, then all the functions, then the rules.

---

## 7. Decision log

| # | Decision | Choice |
|---|----------|--------|
| G-D1 | A or B | **B** (decided 2026-10-13): remove gamification, keep plain signup forms. |
| G-D2 | Existing forms | Not protected. A missing setting means plain (A) or the setting is gone (B). The owner updates forms by hand. |
| G-D3 | Old leaderboard and member links | Redirect to the form page; `/leaderboard` alone to `/`. |
| G-D4 | Default-language strings file | **Applies to the whole page** (decided 2026-10-13): template text, legal and contact notices, and the panels, the same as every other language. |
| G-D5 | Plain panel content | Tick, title, one line with the email. No signup count anywhere. |
| G-D6 | Old gamified data | Member fields left in place, inert. `referrals` records deleted once by `npm run forms:remove-referrals`, because they hold other people's email addresses that nothing would clean up any more. |
| G-D7 | Old default welcome bodies | Upgraded when untouched; edited ones left alone and documented. |
| G-D8 | Class names | Kept for shared parts; removed and added ones listed in CHANGELOG.md. |

---

## 8. Build phases (option B)

Each phase ends with the full suite (`npm run test`, `npx vitest run`), the functions build, and the
docs that phase changed (`npm run docs:affected`, `npm run check:docs`).

- **G1 Plain panels and text overrides.** `arc-site.js` plain success, existing and code step; form
  attributes; default-language strings in the four publish paths; Angular form page made plain.
  Tests: `arc-site-js.spec.ts` (no referral markup, attributes and strings win, stable class names),
  publish specs for default-language strings, `waitlist.component.spec.ts`.
- **G2 Server.** `joinForm` and `finalizeFormSignup` stop writing gamified fields (count kept for
  `totalSignups`); delete the functions in section 5; plain default welcome body and the untouched
  upgrade; merge tags out of the registry and mappings; rules; indexes; the
  `forms:remove-referrals` script with a dry run, documented in `app/scripts-and-data.html`
  and the account contract. Tests updated or deleted,
  plus a test that `forms.ts` exports none of the removed functions, and rules tests for the
  `referrals` deny (`npm run test:rules`).
- **G3 Public routes.** Redirects for `/leaderboard/**` and `/user/:form/:member`; delete the
  leaderboard and member pages; trim `waitlist.service.ts`, the model and GA tracking.
- **G4 Admin.** Edit drawer, form list, form dashboard, joined users and user detail, main dashboard,
  data viewer, first-run defaults and preview; translation keys out of `en.json` and `hi.json`
  (`npm run i18n:keys`).
- **G5 Docs.** Every page in 2.5 rewritten for plain forms, the email tags reference and data model
  trimmed, the new overrides documented in `website/forms.html` and `website/languages.html`,
  screenshots of the changed screens retaken, CHANGELOG.md (class names, removed functions and tags,
  deploy notes).
- **G6 Critical review.** Correctness, security (rules and removed endpoints), every touched screen
  on desktop and phone, old links and old templates, docs drift, tests. Fix critical, high and
  medium findings, rerun everything, report. Then the targeted deploy commands (functions delete,
  changed functions, rules, optional indexes) and the `forms:remove-referrals` run for the owner. No push or deploy without asking.

For option A the phases are the same in shape: G1 gates the panels on the switch, G2 gates the
server writes and seeds the welcome by the switch, G3 keeps the pages and gates their links, G4 gates
the admin parts, G5 and G6 as above.
